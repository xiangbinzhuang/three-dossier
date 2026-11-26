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
 * 把模型摆正并缩放到目标尺寸。
 *
 * 归一化分三步，顺序不能换：
 *   ① 绕 X 轴转 −90°（默认 up = 'z' 时）把模型的 z 轴换成世界 y 轴
 *   ② 平移使包围盒中心落在原点
 *   ③ 均匀缩放到目标高度
 *
 * 先摆正再量包围盒，否则量的是旋转前的盒子，中心对不准。
 *
 * ⚠️ 必须在**装配结构搭好之后**对最终 root 调用。归一化写的是 root 的
 * position / scale —— 如果先在一个临时的 wrapper 上做，再把 wrapper 的子节点
 * 重新挂到别的 group 里，wrapper 会被移出场景树，缩放和位移就全丢了
 * （表现为模型没被缩放，取景算出来的相机距离不对）。
 */
function normalize(root, { height = 2.0, up = 'y' } = {}) {
  if (up === 'z') {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const tallest = Math.max(size.y, size.x, size.z) || 1;
  const s = height / tallest;

  /* 顺序：先缩放，再平移。
     缩放是**绕 root 原点**做的，所以缩放后包围盒中心也跟着放大。
     若先平移再缩放，平移量会被一起放大，中心就偏了 s − 1 倍
     （s=2 时偏一半高度 —— 模型在取景里明显偏上或偏下）。
     先缩放后平移，平移量是缩放后世界坐标里的量，一次到位。 */
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  const center2 = box2.getCenter(new THREE.Vector3());
  root.position.x -= center2.x;
  root.position.y -= center2.y;
  root.position.z -= center2.z;
  root.updateMatrixWorld(true);

  const box3 = new THREE.Box3().setFromObject(root);
  return { box: box3, size: box3.getSize(new THREE.Vector3()), scale: s };
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
 * @param {number} [opts.height=2.0]   归一化后的目标高度
 * @param {'y'|'z'} [opts.up='y']      模型原本的「上」方向
 * @param {string[]} [opts.layers]     参与拆解的装配名（按拆解顺序）
 * @param {object} [opts.explode]      每个层的拆解位移 `{ 层名: [x,y,z] }`
 * @param {object} [opts.materials]    材质覆写 `{ 层名: {color, roughness, metalness} }`
 * @param {string} [opts.format='obj']
 * @returns {{root, bounds, parts, joints, mat}}
 */
export function buildObjRig(data, opts = {}) {
  const {
    height = 2.0,
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

  /* ── 拆解层 ─────────────────────────────────────────────────────────
     只有 layers 里点名的装配才是可动层。没给 layers 就全部当可动层 ——
     一个整体模型拆不开，不如让调用方自己决定。 */
  const wanted = layers ?? assemblies.map((a) => a.name);
  const parts = [];

  for (const name of wanted) {
    const found = assemblies.find((a) => a.name === name);
    if (!found) continue;

    /* kit 的约定：每个可动层是一个 Group，mesh 装在里面，Group 整体平移。
       所以要把 loader 给的装配**再包一层** —— 直接拿 loader 的 group 当层，
       平移它会连带改动它的局部坐标，锚点位置就全错了。 */
    const layer = new THREE.Group();
    layer.name = name;
    root.add(layer);
    layer.add(found.obj);

    const off = explode[name] ?? [0, 0, 0];
    parts.push({ name, g: layer, off: new THREE.Vector3(...off) });
  }

  /* 不参与拆解的装配直接挂 root。 */
  for (const a of assemblies) {
    if (wanted.includes(a.name)) continue;
    root.add(a.obj);
  }

  /* ── 归一化 ─────────────────────────────────────────────────────────
     必须放在结构搭好之后：归一化改的是 root 的 position / scale，
     而拆解层是从 root 里「搬」装配出来的 —— 先归一化再搬，
     被搬走的装配就脱离了被缩放的 root，缩放会丢。 */
  const norm = normalize(root, { height, up });

  /* ── 包围盒 ─────────────────────────────────────────────────────────
     kit 要的是「世界坐标里的竖直极值」和「横向半宽」，用来算地面高度与
     取景距离。这里量的是归一化之后的整机。 */
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
    meta: { assemblies: assemblies.map((a) => a.name), scale: norm.scale, size: norm.size },
  };
}
