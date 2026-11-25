import { lerp, wrapYaw, merge } from './util.js';

/**
 * 拆解（EXPLODE）：每层沿自己的装配偏移方向推开，收拢时原路回位。
 *
 * 层序来自产品 rig 里 `part(name, off)` 的 off —— 一般是沿装配轴的一个位移，
 * 比如 `off = [0, 0, 层序 × 0.24]`。rig 里把某一层的 group 预转过角度的话，
 * 局部 +z 就对应世界上的另一个方向，拆开等于沿那个方向朝两侧铺开，
 * 正是爆炸图的读法。
 *
 * 少数层不适合整体外推（套在立柱上、只能顺着轴滑出来的那种），
 * 用 `slideOffsets` 单独给一个纯 y 的位移。
 */
export function createExplode({ product, framing, orbit, cfg = {}, onState, getSpinA }) {
  const E = merge({
    k: framing.exK,          // 最大外扩倍率
    /* 少数层只做「小拆解」：不整体平移，只沿装配轴滑出一小段，
       把内里的结构露出来，中间留一副完整骨架，比整机碎成一堆好读得多。
       键是零件名，值是该层沿 y 的位移（乘以拆解进度）。 */
    slideOffsets: {},
    tyPush: -0.115,          // 拆开时注视点上抬（＝产品往画面里推）
    facePitch: 0.04,         // 拆开时顺手把镜头转正
  }, cfg);

  let exT = 0;               // 目标进度
  let exK = 0;               // 当前进度（缓动值）
  const TILT_S = Math.sin(product.tilt || 0);

  /* 产品 rig 里带内倾（pivot 绕 Z 转 ±tilt）时，层沿局部 +z 推出去会被这个
     旋转投影出一个向下的分量 —— 最大一层沉 off.z·EX_K·sin(tilt)。
     不补偿的话整张爆炸图是一条向下的斜线，最外侧那两层还会戳进地面。 */
  function apply(k) {
    for (const p of product.parts) {
      const by = E.slideOffsets[p.name];
      if (by !== undefined) { p.g.position.set(0, by * k, 0); continue; }
      p.g.position.copy(p.off).multiplyScalar(E.k * k);
      p.g.position.y += p.off.z * E.k * k * TILT_S;
    }
  }

  function set(on) {
    exT = on ? 1 : 0;
    orbit.goal.dist = framing.fitDist(exT) * 1.02;
    orbit.goal.ty = framing.baseTY + (on ? E.tyPush : 0);
    /* 爆炸图必须正着看才读得出层序：3/4 视角下右侧那一摞会伸到面板底下。
       所以点开拆解就顺手把镜头转正、并冻结转台 —— 收拢时不动镜头。 */
    if (on) {
      /* 目标 yaw = 转台当前角 ⇒ 转盘正对镜头，走最短路径 */
      orbit.setTween({ yaw: wrapYaw(orbit.view.yaw, getSpinA?.() ?? 0), pitch: E.facePitch });
      onState?.(true);
    }
    return !!on;
  }

  /** 每帧推进。帧率无关的指数逼近，收到 0.002 以内直接贴住目标。 */
  function update(dt) {
    if (exK !== exT) {
      exK = lerp(exK, exT, 1 - Math.pow(0.0004, dt));
      if (Math.abs(exK - exT) < 0.002) exK = exT;
      apply(exK);
    }
  }

  /** 一次性贴到目标（截图 / QA）。 */
  function settle() { exK = exT; apply(exK); }

  return {
    apply, update, set, settle,
    get k() { return exK; },
    get target() { return exT; },
    set k(v) { exK = v; },
    opts: E,
  };
}
