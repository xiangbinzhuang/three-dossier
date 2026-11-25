import * as THREE from 'three';
import { merge } from './util.js';

/**
 * 舞台：渲染器 + 影棚环境 + 四灯 + 接影地面 + 转台刻度盘 + 转台组。
 *
 * 这里只放**跟具体产品无关**的东西。产品的几何、比例、锚点都不进来。
 * 唯一的产品输入是 `bounds`（包围盒），用来算地面高度和刻度盘半径。
 *
 * 默认值是一套调过的「工业产品影棚」：素纸底、六道 strip 高光、暖白 key。
 * 产品可以覆盖 `stage.env` / `lights` / `dial`（见 createStage 的 opts），
 * 但通常不需要。
 */

const DEFAULT_ENV = {
  paper: [['0.00', '#fbfaf7'], ['0.42', '#e6e2da'], ['0.62', '#c8c2b8'], ['1.00', '#9a948a']],
  dark: [['0.00', '#232b36'], ['0.42', '#161c24'], ['0.62', '#0e131a'], ['1.00', '#05070b']],
};

export function createRenderer(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  /* r186 已移除 PCFSoftShadowMap（写它只会刷一条 warning 并静默退回 PCFShadowMap）。
     这里直接写 PCFShadowMap —— 阴影本来就是一层很淡的落影，软硬差看不出。 */
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearAlpha(0);
  return renderer;
}

export function createStage({ renderer, bounds, opts = {} }) {
  const S = merge({
    fov: 22,
    exposure: 1.02,
    /* 地面高度 = 包围盒底 - groundGap。0.035 时拆解一开，倾斜的零件会戳进地面；
       0.34 时地面整个沉到底栏后面，产品彻底失去着陆感。0.20 是「看得出悬浮、
       刻度盘还留在画面里」的那个点。 */
    groundGap: 0.20,
    shadow: { color: 0x6d6558, opacity: 0.17 },
    dial: {
      color: 0x8d8a83,
      /* 线宽要按屏幕像素反推：这个视角下环半径 1.21 大约占 145 px，所以
         0.001 单位 ≈ 0.12 px。第一版外环 0.016 只有 1.9 px、细环 0.0035 只有 0.4 px
         —— 全部糊成背景噪点。 */
      rings: [
        { r0: 1.176, r1: 1.218, op: 0.86, k: 0.34 },   // 外环（粗 ≈4.5 px，兑白 34%）
        { r0: 1.256, r1: 1.263, op: 0.40, k: 0.14 },   // 外套细环（≈0.9 px）
        { r0: 0.878, r1: 0.886, op: 0.34, k: 0 },      // 内环
      ],
      cross: { len: 0.18, w: 0.0062, op: 0.36 },
    },
    lights: {
      hemi: { sky: 0xfffdf8, ground: 0x8e8880, intensity: 0.55 },
      key: { color: 0xfff8ee, intensity: 2.35, pos: [-2.8, 4.0, 2.6],
             shadow: { size: 2048, left: -1.9, right: 1.9, top: 2.2, bottom: -2.2,
                       near: 0.6, far: 12, bias: -0.0006, normalBias: 0.02, radius: 3 } },
      fill: { color: 0xe9eef6, intensity: 0.85, pos: [3.4, 1.6, 2.2] },
      rim: { color: 0xffffff, intensity: 1.25, pos: [0.8, 1.4, -3.4] },
      bottom: { color: 0xffffff, intensity: 0.35, pos: [0, -2.6, 1.2] },
    },
    env: DEFAULT_ENV,
  }, opts);

  renderer.toneMappingExposure = S.exposure;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.2, 60);

  /* ── 影棚环境（等距图 → PMREM）──────────────────────────────────────
     暗场不是「把纸面调暗」——那是换背景而已，产品会跟着一起黑掉。
     真正的暗场做法是**压低环境底色、抬高 strip 的对比**：底色深蓝黑 ⇒ 反射面
     大部分变暗，而 6 道 strip 保持纯白 ⇒ 高光反而更硬更亮。 */
  function studioEnv(dark = false) {
    const W = 1024, H = 512;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, H);
    (dark ? S.env.dark : S.env.paper).forEach(([p, c2]) => grd.addColorStop(+p, c2));
    g.fillStyle = grd; g.fillRect(0, 0, W, H);

    const box = (x, y, w, h, a) => {
      const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.62);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    };
    if (dark) { box(80, 20, 340, 170, 1.0); box(640, 50, 260, 140, 0.72); box(390, 140, 210, 70, 0.45); }
    else { box(60, 30, 420, 210, 0.95); box(620, 60, 320, 170, 0.55); box(380, 150, 260, 90, 0.35); }

    /* 关键在于「无论转到哪个角度都有一条高光」。只放几块大柔光箱，产品转到背光
       方位时金属和玻璃就整片死灰。所以再加 6 道竖向窄光条绕一圈 —— 这是影棚里最
       常见的 strip light 阵列，也是工业渲染显贵的核心。 */
    const strip = (cx, w, y0, y1, a) => {
      const gr = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(cx - w / 2, y0, w, y1 - y0);
    };
    for (let i = 0; i < 6; i++) {
      const cx = (i / 6) * W + 40;
      if (dark) { strip(cx, 40, 45, 320, 1.0); strip(cx + 22, 12, 80, 300, 0.7); }
      else { strip(cx, 54, 60, 330, 0.85); strip(cx + 24, 16, 90, 300, 0.55); }
    }
    const fl = g.createLinearGradient(0, H * 0.72, 0, H);
    if (dark) { fl.addColorStop(0, 'rgba(64,120,180,0)'); fl.addColorStop(1, 'rgba(64,120,180,0.22)'); }
    else { fl.addColorStop(0, 'rgba(255,252,246,0)'); fl.addColorStop(1, 'rgba(255,252,246,0.5)'); }
    g.fillStyle = fl; g.fillRect(0, H * 0.72, W, H * 0.28);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose(); pmrem.dispose();
    return env;
  }
  const envPaper = studioEnv(false);
  const envDark = studioEnv(true);
  scene.environment = envPaper;

  /* ── 灯光：主 / 辅 / 轮廓 / 天光 ──────────────────────────────────── */
  const L = S.lights;
  const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  key.position.set(...L.key.pos);
  key.castShadow = true;
  key.shadow.mapSize.set(L.key.shadow.size, L.key.shadow.size);
  const sc = key.shadow.camera;
  sc.left = L.key.shadow.left; sc.right = L.key.shadow.right;
  sc.top = L.key.shadow.top; sc.bottom = L.key.shadow.bottom;
  sc.near = L.key.shadow.near; sc.far = L.key.shadow.far;
  key.shadow.bias = L.key.shadow.bias;
  key.shadow.normalBias = L.key.shadow.normalBias;
  key.shadow.radius = L.key.shadow.radius;
  scene.add(key);

  const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
  fill.position.set(...L.fill.pos); scene.add(fill);

  const rim = new THREE.DirectionalLight(L.rim.color, L.rim.intensity);
  rim.position.set(...L.rim.pos); scene.add(rim);

  const bottom = new THREE.DirectionalLight(L.bottom.color, L.bottom.intensity);
  bottom.position.set(...L.bottom.pos); scene.add(bottom);

  /* ── 接影地面：只画影子，不画地面本身，纸面透上来 ────────────────── */
  const halfH = (bounds.top - bounds.bottom) / 2;
  const groundY = -halfH - S.groundGap;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ color: S.shadow.color, opacity: S.shadow.opacity })
  );
  ground.position.y = groundY;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ── 转台刻度盘 ──────────────────────────────────────────────────────
     双层线（粗环 + 细环 + 内环）才是工程基准线的感觉；60 道径向刻度会让底盘
     读成钟表盘，抢产品。
     每片环记下自己的基准透明度 —— 切主题时按比例整体缩放。
     如果 clone 了材质却不登记，暗场改 dialColor 完全不生效。 */
  const dial = new THREE.Group();
  dial.position.y = groundY + 0.004;
  scene.add(dial);
  const dialBase = new THREE.MeshBasicMaterial({
    color: S.dial.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const dialMats = [];
  for (const r of S.dial.rings) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r.r0, r.r1, 512).rotateX(-Math.PI / 2), dialBase.clone());
    m.material.opacity = r.op;
    dial.add(m); dialMats.push({ mat: m.material, base: r.op, k: r.k });
  }
  /* 中心十字：**必须平躺在地面里**（rotateX(-π/2) + rotation.y 转 90°）。
     跟着相机转（billboard）会读成「插在转台上的一根针」，不是画在地上的十字。
     平躺后在 4–6° 俯角下透视压扁（竖臂只剩 2 px），但那是物理正确的 ——
     工程图里画在地面上的中心标记，斜看就是这个样子。 */
  const crossG = new THREE.Group();
  crossG.position.y = 0.0015;
  dial.add(crossG);
  for (const rot of [0, Math.PI / 2]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(S.dial.cross.len, S.dial.cross.w).rotateX(-Math.PI / 2),
      dialBase.clone()
    );
    m.material.opacity = S.dial.cross.op;
    m.rotation.y = rot;
    crossG.add(m);
    dialMats.push({ mat: m.material, base: S.dial.cross.op, k: 0 });
  }

  /** 转台组：产品挂这里，只转这一层。 */
  const spin = new THREE.Group();
  scene.add(spin);

  return {
    renderer, scene, camera, spin,
    lights: { hemi, key, fill, rim, bottom },
    ground, dial, dialMats, dialBase,
    env: { paper: envPaper, dark: envDark },
    groundY, halfH,
    opts: S,
  };
}
