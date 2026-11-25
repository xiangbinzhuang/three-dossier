/* ══════════════════════════════════════════════════════════════════════
   three-dossier · 应用装配
   ──────────────────────────────────────────────────────────────────────
   这个文件只做「接线」，不含产品知识：把 kit 按依赖顺序装起来，
   把 DOM 按钮连到 kit 的 setter 上。

   换产品 = 换掉 src/products/<name>/ 那一层（config.js + rig.js），本文件不动。
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { one, all, clamp } from '../kit/util.js';
import { createRenderer, createStage } from '../kit/stage.js';
import { createFraming } from '../kit/framing.js';
import { createOrbit } from '../kit/orbit.js';
import { createLook } from '../kit/look.js';
import { createExplode } from '../kit/explode.js';
import { createTheme } from '../kit/theme.js';
import { createCallouts } from '../kit/callouts.js';
import { createHud } from '../kit/hud.js';
import { createLoop } from '../kit/loop.js';
import product from '../products/sample/config.js';

/* ── DOM ─────────────────────────────────────────────────────────────── */
const dom = {
  canvas: one('#gl'),
  mast: one('#mast'),
  controls: one('#controls'),
  views: one('#views'),
  modes: one('#modes'),
  envsw: one('#envsw'),
  btnExplode: one('#btn-explode'),
  btnCallouts: one('#btn-callouts'),
  play: one('#play'),
  status: one('#status'),
  lane: one('#lane'),
  labels: one('#labels'),
  leaders: one('#leaders'),
  waveA: one('#waveA'),
  waveB: one('#waveB'),
  ticks: one('#ticks'),
  stackRow: one('#stackRow'),
  timeText: one('#tn'),
  head: one('#head'),
  headDot: one('#headDot'),
  loading: one('#loading'),
};

/* ── 运行时状态（唯一可变真源）─────────────────────────────────────── */
const rt = {
  t: 0, playing: true, orbit: true, spinA: 0,
  mode: 'shaded', explode: false, labels: true,
};

/* ── 布局开关：JS 判一次，CSS 全挂 body.m ─────────────────────────────
   不要在 CSS 里另写媒体查询。两套判据一定会互相打脸 —— 曾出现 JS 认为是
   手机、CSS 认为是桌面，底部三栏与控制簇同时显示，纵向挤成一团。 */
const layout = { m: false, head: 0, dock: 0, h: 0 };
const isNarrow = () => window.innerWidth < 760 || window.innerHeight < 520;

/* ── 渲染器 → 产品 → 舞台 ──────────────────────────────────────────────
   顺序有讲究：产品 rig 建纹理时要问 renderer 的最大各向异性，而舞台建地面要
   产品的包围盒。所以 renderer 单独先建，产品随后，舞台最后。 */
const renderer = createRenderer(dom.canvas);
const rig = product.createRig({ renderer });
const B = rig.bounds;

const stage = createStage({ renderer, bounds: B });

/* 产品挂到转台上并居中：root 原点是产品自身的原点，包围盒中心才是转台中心。 */
const CY = (B.top + B.bottom) / 2;
rig.root.position.y = -CY;
rig.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
stage.spin.add(rig.root);

/* ── kit 实例 ────────────────────────────────────────────────────────── */
const look = createLook({ root: rig.root });
const framing = createFraming({ bounds: B, camera: stage.camera, layout, cfg: product.framing });

/* orbit 与 explode 互相引用（缩放上限要看拆解进度、拆解要改相机目标），
   用一个延后的 getter 打破循环。 */
let ex;
const orbit = createOrbit({
  camera: stage.camera,
  canvas: dom.canvas,
  framing,
  presets: product.views,
  onFreeze: () => {
    rt.orbit = false;
    dom.modes.querySelector('[data-mode="orbit"]')?.classList.remove('on');
  },
  getExK: () => (ex ? ex.k : 0),
});

ex = createExplode({
  product: rig,
  framing,
  orbit,
  cfg: product.explode,
  getSpinA: () => rt.spinA,
  onState: (on) => {
    rt.explode = on;
    dom.btnExplode.classList.toggle('on', on);
    /* 拆解必须冻结转台：镜头刚才转到「正对产品」，转盘再自己转起来，
       说好的层序视角几秒后就走样了。收拢时不动 —— 由用户自己决定。 */
    if (on) {
      rt.orbit = false;
      dom.modes.querySelector('[data-mode="orbit"]')?.classList.remove('on');
    }
  },
});

const theme = createTheme({
  stage, look,
  onApply: (kind) => {
    all('[data-env]', dom.envsw).forEach((b) => b.classList.toggle('on', b.dataset.env === kind));
  },
});

const callouts = createCallouts({
  product: rig,
  spin: stage.spin,
  camera: stage.camera,
  layout,
  cfg: product.callouts,
  dom: { labelHost: dom.labels, leaderSvg: dom.leaders },
  getSpinA: () => rt.spinA,
  getExK: () => ex.k,
  getKind: () => theme.kind,
});

const hud = createHud({ cfg: product.hud, dom });

/* 产品专属运行时（面罩波纹这类）。返回 { tick(dt) }，可以不实现。 */
const extra = product.init?.({ product: rig, stage, THREE });

const loop = createLoop({
  stage, orbit, explode: ex, callouts, hud,
  clock: product.clock,
  runtime: rt,
  onTick: (dt) => extra?.tick?.(dt),
});

/* ── 动作 ────────────────────────────────────────────────────────────── */
function setMode(m) {
  rt.mode = look.setMode(m);
  all('[data-mode]', dom.modes).forEach((b) => {
    if (b.dataset.mode === 'orbit') return;
    b.classList.toggle('on', b.dataset.mode === m);
  });
  return m;
}

function setPlaying(v) {
  rt.playing = v;
  dom.play.classList.toggle('paused', !v);
  const b = dom.status?.querySelector('b');
  if (b) b.textContent = v ? 'STAND-BY · IDLE ROTATE' : 'STAND-BY · HOLD';
}

function setLabels(on) {
  rt.labels = !!on;
  callouts.setVisible(rt.labels);
  dom.btnCallouts.classList.toggle('on', rt.labels);
}

function setEnv(k) { return theme.set(k); }

/* ── 尺寸 ────────────────────────────────────────────────────────────── */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  /* 先切类再量尺寸：dock 只在 body.m 下才存在，类没切之前量到的是桌面版控件块 */
  layout.m = isNarrow();
  document.body.classList.toggle('m', layout.m);
  layout.h = h;
  callouts.invalidate();          // 字号随 body.m 变了，标签宽度缓存必须作废

  renderer.setSize(w, h, false);
  stage.camera.aspect = w / h;

  let ox = w * 0.012, oy = 0;
  if (layout.m) {
    /* 手机：顶部标题块的下沿 ↔ 底部 dock 的上沿，中间那条才是产品能用的空地。
       把取景窗整体上移，产品才会落在带子里而不是被 dock 压住下半截。
       setViewOffset 的 y 传 −oy ⇒ 画面内容位移 +oy（向下）。 */
    const mast = dom.mast.getBoundingClientRect();
    const dock = dom.controls.getBoundingClientRect();
    layout.head = mast.bottom + 12;
    layout.dock = dock.top - 8;
    oy = (layout.head + layout.dock) / 2 - h / 2;
    ox = 0;                       // 窄屏没有左栏要让位，水平居中
  } else {
    layout.head = 0;
    layout.dock = h;
  }
  // 产品居中偏右一点点：左侧留给标题块（桌面）
  stage.camera.setViewOffset(w, h, -ox, -oy, w, h);
  stage.camera.updateProjectionMatrix();

  orbit.goal.dist = framing.fitDist(ex.k) * 1.02;
  if (!orbit.dragging) orbit.view.dist = orbit.goal.dist;
  loop.renderFrame();
}
window.addEventListener('resize', resize);

/* ── 交互绑定 ────────────────────────────────────────────────────────── */
dom.play.addEventListener('click', () => setPlaying(!rt.playing));

dom.views.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  all('[data-view]', dom.views).forEach((x) => x.classList.toggle('on', x === b));
  orbit.setPreset(b.dataset.view, rt.spinA);
});

dom.modes.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  const m = b.dataset.mode;
  if (m === 'orbit') {
    rt.orbit = !rt.orbit;
    b.classList.toggle('on', rt.orbit);
    return;
  }
  setMode(m);
});

dom.btnExplode.addEventListener('click', () => ex.set(!rt.explode));
dom.btnCallouts.addEventListener('click', () => setLabels(!rt.labels));
dom.envsw.addEventListener('click', (e) => {
  const b = e.target.closest('[data-env]');
  if (b) setEnv(b.dataset.env);
});

/* 时间轴拖拽 */
let scrub = false;
function scrubTo(clientX) {
  const r = dom.lane.getBoundingClientRect();
  loop.seek(clamp((clientX - r.left) / r.width, 0, 1) * loop.DUR);
}
dom.lane.addEventListener('pointerdown', (e) => {
  scrub = true; dom.lane.setPointerCapture(e.pointerId); scrubTo(e.clientX);
});
dom.lane.addEventListener('pointermove', (e) => { if (scrub) scrubTo(e.clientX); });
dom.lane.addEventListener('pointerup', () => { scrub = false; });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!rt.playing); }
  const n = { 1: 'hero', 2: 'front', 3: 'side', 4: 'top' }[e.key];
  if (n) dom.views.querySelector(`[data-view="${n}"]`)?.click();
  if (e.key === 'e' || e.key === 'E') ex.set(!rt.explode);
  if (e.key === 'l' || e.key === 'L') setLabels(!rt.labels);
  if (e.key === 'd' || e.key === 'D') setEnv(theme.kind === 'dark' ? 'paper' : 'dark');
});

/* ── 启动 ────────────────────────────────────────────────────────────── */
hud.mount();
callouts.build();
callouts.buildLabels();
setMode('shaded');
resize();
setPlaying(true);
loop.start();
setTimeout(() => dom.loading.classList.add('gone'), 260);
/* 初始化环境：灯光常量的默认值已经是纸面那套，这里再走一遍 setEnv 只是为了让
   body[data-env] 从一开始就有值（否则 QA 读到 None）。 */
setEnv('paper');

/* ── QA 钩子 ───────────────────────────────────────────────────────────
   外部测试与截图脚本靠它把状态贴到确定值。 */
const QA = {
  ready: true,
  seek: (t) => loop.seek(t),
  pause: () => setPlaying(false),
  play: () => setPlaying(true),
  setMode,
  setLabels,
  setEnv,
  get env() { return theme.kind; },
  setExplode: (on) => {
    ex.set(!!on);
    orbit.flushTween();
    ex.settle();
    orbit.settle();
    loop.renderFrame();
  },
  /* 把相机 / 拆解缓动一次性贴到目标 —— 软渲染只有十几帧，
     靠 lerp 到位要等好几秒，截图才是确定性的。 */
  settle: () => {
    orbit.flushTween();
    orbit.settle();
    ex.settle();
    loop.renderFrame();
  },
  get exK() { return ex.k; },
  setView: (name) => {
    const p = product.views[name];
    if (!p) return;
    orbit.jumpTo(p.yaw, p.pitch, rt.spinA);
    rt.orbit = false;
    loop.renderFrame();
  },
  /* 调试 */
  THREE, scene: stage.scene, camera: stage.camera, renderer,
  product: rig, anchors: callouts.anchors, camDir: callouts.camDir,
  layout, orbit, explode: ex, theme, look, hud,
};
window[product.qaGlobal || 'DOSSIER'] = QA;
window.DOSSIER = QA;
