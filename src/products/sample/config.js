/**
 * Sample —— 产品插槽。
 * ============================================================================
 * 这是「换产品时唯一需要动的地方」再加一个 rig.js。
 * kit 不认识任何具体产品，只认识这里导出的对象。
 *
 * 分两类东西，别混：
 *   · 行为数据（本文件）—— 视图预设、标注锚点、拆解分层、仪表层名
 *   · 文案与版式（src/app/index.html + dossier.css）—— 型号、规格、标题、面板
 *     一个产品页的文案是设计出来的，不适合塞进 JS 里拼字符串。
 * ============================================================================ */
import { createRig } from './rig.js';

export default {
  name: 'SAMPLE',

  clock: { duration: 12, omega: 0.35 },   // 转台一圈 12 s，角速度 rad/s

  views: {
    hero: { yaw: 0.46, pitch: 0.11 },
    front: { yaw: 0.00, pitch: 0.02 },
    side: { yaw: Math.PI / 2, pitch: 0.05 },
    top: { yaw: 0.40, pitch: 1.02 },
  },

  /* 滑环不整体外推，只沿 −y 滑开一点，把里面的立柱露出来。
     其余层走 rig 里的 off（沿 x 铺开）。 */
  explode: {
    slideOffsets: { sleeve_1: -0.55 },
  },

  /* 取景预留的爆炸行程（乘 exK 0.68 才是实际位移）。
     这必须等于 rig 里最大的 off —— 留少了零件会飞出画面，留多了产品缩得太小。 */
  framing: {
    maxPush: 1.35,
  },

  /* ── 标注 ──────────────────────────────────────────────────────────────
     anchor.kind:
       root   在 root 局部坐标里给一个点（适合横梁这种整体件）
       part   挂在某个零件层上（拆解时跟着层飞）
       parts  左右各一层，按层法线挑朝向观众的那只
       joints 多颗球，挑离相机最近的
     dy 是屏幕上的竖直偏移（像素）。
     hidden 的实际语义只有一条：引线画成虚线（隐藏件的制图惯例），
     标签本身照常显示 —— 它不负责淡出。 */
  callouts: [
    {
      no: '01', label: 'CROSS RAIL', zh: '横梁', side: 'left', dy: -118,
      anchor: { kind: 'root', at: [0, 0.56, 0] },
    },
    {
      no: '02', label: 'PIVOT JOINT', zh: '枢轴球', side: 'left', dy: -34,
      anchor: { kind: 'joints', joints: [0, 1] },
    },
    {
      no: '03', label: 'OUTER SHELL', zh: '外壳', side: 'right', dy: 26,
      anchor: { kind: 'parts', names: ['housing_-1', 'housing_1'], normals: [-1, 1], facing: 1 },
    },
    {
      no: '04', label: 'END CAP', zh: '端盖', side: 'right', dy: 96,
      anchor: { kind: 'part', name: 'cap_1' },
    },
    {
      no: '05', label: 'CORE MODULE', zh: '内核模块', side: 'right', dy: 150,
      anchor: { kind: 'part', name: 'core_1' },
      hidden: true,                    // 内部件：引线走虚线
    },
  ],

  hud: {
    lane: { samples: 300, width: 600, base: 18 },
    layers: ['BASE', 'SHAFT', 'HOUSING', 'CORE', 'CAP'],
  },

  createRig,
};
