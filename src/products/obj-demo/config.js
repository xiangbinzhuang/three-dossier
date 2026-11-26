/**
 * OBJ-DEMO —— 产品槽。
 *
 * 与 sample 插槽的唯一区别：几何来自外部 OBJ 文件，而不是代码里搭的基本体。
 * 行为数据（机位、标注、拆解分层、仪表层名）在这里，和 sample 完全同构。
 *
 * 换成你自己的产品时，这个文件和 rig.js 都要按模型重写。
 */
import { createRig } from './rig.js';

export default {
  name: 'OBJ-DEMO',

  clock: { duration: 12, omega: 0.35 },   // 转台一圈 12 s，角速度 rad/s

  views: {
    hero: { yaw: 0.46, pitch: 0.11 },
    front: { yaw: 0.00, pitch: 0.02 },
    side: { yaw: Math.PI / 2, pitch: 0.05 },
    top: { yaw: 0.40, pitch: 1.02 },
  },

  /* 取景预留的爆炸行程 —— 必须等于 rig 里最大的 off。
     上面 rig.js 里最大的是 cap 的 1.35，所以这里也写 1.35。
     留少了零件会飞出画面，留多了产品缩得太小。 */
  framing: {
    maxPush: 1.35,
  },

  /* ── 标注 ──────────────────────────────────────────────────────────────
     anchor.kind 的四种：
       root   root 局部坐标里的一个点（适合底座这种整体件）
       part   挂在某个零件层上，拆解时跟着层飞
       parts  左右各一层，按层法线挑朝向观众的那只
       joints 多颗球，挑离相机最近的
     纯 OBJ 模型没有「对称小件」的概念，一般用 root / part 就够。 */
  callouts: [
    {
      no: '01', label: 'BASE', zh: '底座', side: 'left', dy: -100,
      anchor: { kind: 'root', at: [0, 0.10, 0] },
    },
    {
      no: '02', label: 'OUTER HOUSING', zh: '外壳', side: 'left', dy: -20,
      anchor: { kind: 'part', name: 'housing' },
    },
    {
      no: '03', label: 'CORE MODULE', zh: '内核模块', side: 'right', dy: 30,
      anchor: { kind: 'part', name: 'core' },
      hidden: true,                    // 内部件：引线走虚线
    },
    {
      no: '04', label: 'TOP CAP', zh: '顶盖', side: 'right', dy: 100,
      anchor: { kind: 'part', name: 'cap' },
    },
  ],

  hud: {
    lane: { samples: 300, width: 600, base: 18 },
    layers: ['BASE', 'HOUSING', 'CORE', 'CAP'],
  },

  createRig,
};
