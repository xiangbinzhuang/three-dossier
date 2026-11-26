import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/**
 * 把一个 OBJ / GLB 装配成 kit 认识的产品插槽。
 *
 * 为什么要这一层：kit 只认识 `{ root, bounds, parts, joints, mat }` 这个结构，
 * 而 loader 给的是「一堆 Group 和 Mesh」。中间这层做三件事：
 *
 *   ① 把模型**归一化** —— 缩放到给定尺寸、摆到原点、Y 轴朝上。
 *      CAD 导出的 OBJ 单位五花八门（毫米、厘米、英寸都有），不归一化的话
 *      取景算出来的相机距离会离谱到模型在画面外或者缩成一个点。
 *   ② 把每个可动的子装配变成一个 **parts 层**（kit 的拆解与标注都靠它）。
 *   ③ 统一材质 —— loader 给的是 MeshPhongMaterial，而 kit 的环境光照是按
 *      MeshStandardMaterial 调的（金属度/粗糙度），Phong 没有这些参数，
 *      换过去不调的话产品在影棚里会显得很平。
 *
 * 分组规则：OBJ 里的 `o` / `g` 语句各自成为一个装配层。导出的模型通常
 * 已经按部件分组（外壳、内核、盖子……），正好对上爆炸图的层。
 *
 * 用法：
 *
 *   import objText from './model.obj';        // 构建期内联，产物零网络请求
 *   import { buildObjRig } from '../../kit/objrig.js';
 *
 *   const rig = buildObjRig(objText, {
 *     height: 2.0,            // 归一化后的目标高度（世界单位）
 *     up: 'y',                // 模型原本的「上」方向
 *     layers: ['shell', 'core'],  // 参与拆解的层名，按拆解顺序
 *     explode: { shell: [0.8, 0, 0], core: [0, 0, 0] },
 *   });
 */

/** OBJ / STL / GLTF 的通用入口：接受文本或 ArrayBuffer。 */
function parseModel(data, format = 'obj') {
  if (format === 'gltf' || format === 'glb') {
    throw new Error(
      'GLTF/GLB 需要异步解析（要等 JSON 块与二进制块都到齐），'
      + '而产品 rig 必须在同步的 createRig() 里建好。'
      + '请改用 OBJ，或把 GLB 在构建期转成 OBJ。'
    );
  }
  if (format === 'obj') return new OBJLoader().parse(data);
  throw new Error(`暂不支持的格式：${format}`);
}

/**
 * 计算把模型归一化到目标尺寸所需的变换。
 *
 * 返回的是一个**统一变换**（rotate → scale → translate），由调用方逐个装配地
 * 烘焙进 geometry。这样做的理由是 kit 的两条硬约束：
 *
 *   ① `root.position` 必须是 0。app 层（main.js）会按 bounds 把产品
 *      居中到转台中心：`root.position.y = -(top + bottom) / 2`。
 *      若这里也平移 root，两处互相覆盖 —— 内容实际落在 root 局部坐标的
 *      [0, h] 而不是 [-h/2, h/2]，与 bounds 差整整一个高度，
 *      取景按 bounds 算，模型就撑出画面。
 *   ② `root.scale` 必须是 1。拆解位移 `off` 是**世界单位**（`config.framing.maxPush`
 *      按它来预留取景行程）。层若挂在带缩放的祖先下，平移量会被缩放，
 *      `maxPush` 与实际位移对不上。
 *
 * 于是缩放不能靠 Group 的 scale 实现 —— 只能烘焙进 geometry。
 * 逐个装配用**同一个**变换，装配之间的相对位置就保住了。
 *
 * OBJLoader 给的 mesh 原点都是零、绝对坐标写在 geometry 里，
 * 所以「绕 mesh 原点变换」等于「绕模型原点变换」—— 逐装配烘焙是安全的。
 *
 * 尺寸语义：`size` 是**最长边**的目标长度，不是高度。
 * 取景是按包围盒算的 —— 一个又宽又扁的产品若按高度归一化，
 * 宽度会远超取景框，模型照样出画。按最长边归一化才保证装得下。
 * 想要「高度固定」时传 `fit: 'height'`。
 */
function normalizeTransform(src, { size: targetSize = 2.0, up = 'y', fit = 'longest' } = {}) {
  const rotation = up === 'z' ? -Math.PI / 2 : 0;

  /* 旋转后的包围盒：先把 src 整体转一下量。 */
  let probe = src;
  if (rotation) {
    probe = new THREE.Group();
    probe.add(src);
    probe.rotation.x = rotation;
  }
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(probe);
  const dims = box.getSize(new THREE.Vector3());

  /* 缩放依据：最长边，或高度。
     取「装得下」而不是「看起来大」—— 出画的模型再漂亮也没用。 */
  const basis = fit === 'height'
    ? (dims.y || 1)
    : Math.max(dims.x, dims.y, dims.z) || 1;
  const s = targetSize / basis;

  /* 缩放后的中心（世界坐标）。
     先缩放再量中心 —— 若先量再缩放，平移量会被一起放大，
     中心就偏了 s − 1 倍（s=2 时偏一半高度）。 */
  const center = box.getCenter(new THREE.Vector3());
  const scaledCenter = center.clone().multiplyScalar(s);

  return {
    scale: s,
    rotation,
    translate: scaledCenter.negate(),
    size: dims.clone().multiplyScalar(s),
  };
}

/**
 * 把归一化变换烘焙进一个装配的所有 geometry。
 *
 * geometry.scale() 是均匀缩放，法线方向不受影响（法线只管方向，
 * 均匀缩放不改变方向），所以不用重算法线。
 * 旋转则必须同时作用于顶点与法线，否则 up='z' 的模型法线还指着旧方向，
 * 光照会算错。
 */
function applyTransform(assembly, t) {
  assembly.obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (t.rotation) {
      g.rotateX(t.rotation);
      if (g.attributes.normal) g.rotateX(t.rotation);
    }
    g.scale(t.scale, t.scale, t.scale);
    g.translate(t.translate.x, t.translate.y, t.translate.z);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
}

/**
 * 造一份 kit 能用的材质。
 *
 * loader 给的 Phong 材质没有 metalness / roughness，而影棚的光是按标准材质
 * 调的。直接沿用 Phong 会让金属件在环境光下完全没有反射层次。
 * 所以这里读 Phong 的 shininess 换算成 roughness，再统一成 Standard。
 */
function toStandard(material, fallback) {
  const std = new THREE.MeshStandardMaterial({
    color: material?.color?.clone() ?? fallback.color.clone(),
    roughness: material?.shininess != null
      ? Math.min(1, Math.max(0.04, 1 - material.shininess / 200))
      : fallback.roughness,
    metalness: material?.specular
      ? Math.min(1, Math.max(0, (material.specular.r + material.specular.g + material.specular.b) / 3))
      : fallback.metalness,
    side: material?.side ?? THREE.FrontSide,
    transparent: !!material?.transparent,
    opacity: material?.opacity ?? 1,
    map: material?.map ?? null,
  });
  std.name = material?.name || 'model';
  return std;
}

/**
 * 建立产品 rig。
 *
 * @param {string|ArrayBuffer} data    模型内容（构建期内联的字符串）
 * @param {object} opts
 * @param {number} [opts.size=2.0]      归一化后的最长边目标长度（世界单位）
 * @param {'longest'|'height'} [opts.fit='longest']  按哪条边归一化
 * @param {'y'|'z'} [opts.up='y']       模型原本的「上」方向
 * @param {string[]} [opts.layers]      参与拆解的装配名（按拆解顺序）
 * @param {object} [opts.explode]       每个层的拆解位移 `{ 层名: [x,y,z] }`
 * @param {object} [opts.materials]     材质覆写 `{ 层名: {color, roughness, metalness} }`
 * @param {string} [opts.format='obj']
 * @returns {{root, bounds, parts, joints, mat}}
 */
export function buildObjRig(data, opts = {}) {
  const {
    size: targetSize = 2.0,
    fit = 'longest',
    up = 'y',
    layers = null,
    explode = {},
    materials = {},
    format = 'obj',
  } = opts;

  const src = parseModel(data, format);

  const root = new THREE.Group();
  root.name = 'product';

  /* ── 材质统一 + 收集装配 ───────────────────────────────────────────── */
  const FALLBACK = { color: new THREE.Color(0xd7d3cb), roughness: 0.46, metalness: 0.32 };
  const mat = {};
  const assemblies = [];

  src.children.forEach((child, i) => {
    const name = child.name || `assembly_${i + 1}`;

    /* 收集这个装配下的所有网格，换材质，并记下各 mesh 的原始材质
       （CLAY 模式要还原，X-RAY 要单独处理）。 */
    child.traverse((o) => {
      if (!o.isMesh) return;
      const override = materials[name];
      const base = override
        ? new THREE.MeshStandardMaterial({
            color: new THREE.Color(override.color ?? FALLBACK.color.getHex()),
            roughness: override.roughness ?? FALLBACK.roughness,
            metalness: override.metalness ?? FALLBACK.metalness,
            side: override.side ?? THREE.FrontSide,
          })
        : toStandard(o.material, FALLBACK);
      mat[name] = base;
      o.material = base;
      o.castShadow = true;
    });

    assemblies.push({ name, obj: child });
  });

  /* ── 归一化：先量，后搬 ─────────────────────────────────────────────
     顺序不能反：量包围盒需要所有装配都还在 src 里。一旦把装配挂到
     layer / root 下，src 就空了，量出来的是零尺寸。
     所以先算变换，再重挂，最后把变换烘焙进去。 */
  const t = normalizeTransform(src, { size: targetSize, up, fit });

  /* ── 拆解层 ─────────────────────────────────────────────────────────
     只有 layers 里点名的装配才是可动层。没给 layers 就全部当可动层 ——
     一个整体模型拆不开，不如让调用方自己决定。 */
  const wanted = layers ?? assemblies.map((a) => a.name);
  const parts = [];

  for (const { name, obj } of assemblies) {
    if (!wanted.includes(name)) {
      /* 不参与拆解的装配直接挂 root。 */
      root.add(obj);
      continue;
    }

    /* kit 的约定：每个可动层是一个 Group，mesh 装在里面，Group 整体平移。
       所以要把 loader 给的装配**再包一层** —— 直接拿 loader 的 group 当层，
       平移它会连带改动它的局部坐标，锚点位置就全错了。 */
    const layer = new THREE.Group();
    layer.name = name;
    layer.add(obj);
    root.add(layer);

    const off = explode[name] ?? [0, 0, 0];
    parts.push({ name, g: layer, off: new THREE.Vector3(...off) });
  }

  /* 逐个装配烘焙**同一个**变换（见 normalizeTransform 的说明）。
     root 的 position / scale 保持不动 —— app 层负责居中，拆解位移是世界单位。 */
  for (const a of assemblies) applyTransform(a, t);

  /* ── 包围盒 ─────────────────────────────────────────────────────────
     kit 要的是「世界坐标里的竖直极值」和「横向半宽」，用来算地面高度与
     取景距离。这里量的是归一化之后的整机。
     注意：root 此刻还没有被 app 层居中，量到的就是它自己的局部坐标 ——
     与 app 层将要施加的居中无关，两者必须自洽。 */
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const bounds = {
    halfW: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    top: box.max.y,
    bottom: box.min.y,
  };

  return {
    root,
    mat,
    parts,
    joints: [],          // OBJ 没有「对称小件」的概念，用 kind:'part' 即可
    bounds,
    /* 附带的元信息，方便调用方写 config */
    meta: { assemblies: assemblies.map((a) => a.name), scale: t.scale, size: t.size },
  };
}
