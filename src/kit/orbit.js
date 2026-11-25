import * as THREE from 'three';
import { clamp, lerp, easeIO, wrapYaw } from './util.js';

/**
 * 相机：球坐标环视 + 视图预设补间 + 拖拽 / 滚轮。
 *
 * 状态分两层：
 *   view —— 当前实际值，每帧向 goal 指数逼近
 *   goal —— 目标值，拖拽 / 滚轮 / 预设直接改这一层
 * 分两层是为了「松手后有惯性收敛」而不是硬跟手。
 */
export function createOrbit({ camera, canvas, framing, presets, initial, onFreeze, getExK }) {
  const view = {
    yaw: initial?.yaw ?? 0.46,
    pitch: initial?.pitch ?? 0.10,
    dist: framing.fitDist(0),
    tx: 0,
    ty: framing.baseTY,
  };
  const goal = { ...view };

  /** 预设是「相对产品的固定视角」，用的时候要加上当前转台角（见 setPreset）。 */
  function apply() {
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    camera.position.set(
      view.tx + view.dist * Math.sin(view.yaw) * cp,
      view.ty + view.dist * sp,
      view.dist * Math.cos(view.yaw) * cp
    );
    camera.lookAt(view.tx, view.ty, 0);
    camera.updateMatrixWorld();
  }

  /* ── 拖拽环视 + 双指捏合缩放 ───────────────────────────────────────────
     指针用 Map 记，而不是只存「一个 drag」：
       1 根手指 → 环视
       2 根手指 → 捏合缩放（手机上没有滚轮，这是唯一的缩放入口）
     只存一个 drag 的话，第二根手指按下会把基准覆盖成那根手指的位置，
     画面猛跳一下，而且完全没有缩放路径 —— 手机上等于废掉了 zoom。
     从双指松回单指时必须**用剩下那根手指的当前位置重建基准**，
     否则相机被旧基准拽一下（跳帧）。 */
  const pointers = new Map();          // pointerId -> { x, y }
  let drag = null;                     // { id, x, y, yaw, pitch }
  let pinch = null;                    // { span, dist }

  const spanOf = () => {
    const [a, b] = Array.from(pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    tween = null;
    /* 基准取 `view`（当前实际值），不能取 `goal`：preset tween 还没跑完时
       goal 已经跳到终点，以它为基准会把相机猛拽一下。 */
    if (pointers.size === 1) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
    } else if (pointers.size === 2) {
      drag = null;
      /* 基准距离取 `goal.dist`，不是 `view.dist`：view 是还在收敛的显示值，
         拿它当基准会把上一段缩放没走完的零头「退回」——手指没动，产品先退一点。
         goal 本身就是目标值，从这里按比例算，既不跳也不退。 */
      pinch = { span: spanOf(), dist: goal.dist };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const [lo, hi] = zoomLimit();
      // 张开（span 变大）⇒ 距离变小 ⇒ 放大
      goal.dist = clamp(pinch.dist * (pinch.span / spanOf()), lo, hi);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    goal.yaw = drag.yaw - (e.clientX - drag.x) * 0.0072;
    goal.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.0052, -0.42, 1.24);
  });

  const liftPointer = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 1) {
      const [id, p] = Array.from(pointers.entries())[0];
      /* 这里基准取 `goal` 而不是 `view`：从双指松回单指时 tween 一定是空的
         （按下那一刻就清了），goal 就是「用户正看到的那个方向」的落点。
         取 view 会把还没走完的那一点点差距算成基准误差 —— 手指一动，
         goal 先往回退一格，画面像被拽了一下。 */
      drag = { id, x: p.x, y: p.y, yaw: goal.yaw, pitch: goal.pitch };
      pinch = null;
      tween = null;
    } else if (pointers.size === 0) {
      drag = null; pinch = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', liftPointer);
  canvas.addEventListener('pointercancel', liftPointer);

  /* 滚轮缩放。上下限收紧到 0.85–1.30 × 基准取景：原来 0.55–1.70 能推到贴脸
     （产品糊满屏、标注字显得太小）或缩成一小坨。这两个值对应「产品占画面
     61% ~ 40%」，都在档案页该有的尺度里。 */
  const zoomLimit = () => {
    const base = framing.fitDist(getExK ? getExK() : 0);
    return [base * 0.85, base * 1.30];
  };
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [lo, hi] = zoomLimit();
    goal.dist = clamp(goal.dist * (1 + Math.sign(e.deltaY) * 0.07), lo, hi);
  }, { passive: false });

  /* ── 预设补间 ──────────────────────────────────────────────────────── */
  let tween = null;

  /** 切到某个预设。把当前转台角加进去 —— 转盘转到哪儿都能立刻对上；
   *  同时冻结转台：规格页要的是能停住看清楚，不是一直转。 */
  function setPreset(name, spinA) {
    const p = presets[name];
    if (!p) return;
    const target = { yaw: wrapYaw(view.yaw, spinA + p.yaw), pitch: p.pitch };
    tween = { t: 0, from: { yaw: view.yaw, pitch: view.pitch }, to: target };
    onFreeze?.();
  }

  /** 把相机一次性贴到目标（截图 / QA 用）。 */
  function settle() {
    if (tween) { goal.yaw = tween.to.yaw; goal.pitch = tween.to.pitch; tween = null; }
    view.yaw = goal.yaw; view.pitch = goal.pitch;
    view.dist = goal.dist; view.ty = goal.ty;
  }

  /** 立即对准某个角度，不走补间（QA 的 setView 用）。 */
  function jumpTo(yaw, pitch, spinA) {
    view.yaw = wrapYaw(view.yaw, spinA + yaw);
    view.pitch = pitch;
    goal.yaw = view.yaw; goal.pitch = pitch;
    tween = null;
  }

  /** 让 tween 直接结束到终点（当外部要立刻改 goal 时避免打架）。 */
  function flushTween() {
    if (!tween) return;
    goal.yaw = tween.to.yaw; goal.pitch = tween.to.pitch; tween = null;
  }

  function setTween(to) {
    tween = { t: 0, from: { yaw: view.yaw, pitch: view.pitch }, to };
  }

  function update(dt) {
    // 相机补间
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.85);
      const k = easeIO(tween.t);
      goal.yaw = lerp(tween.from.yaw, tween.to.yaw, k);
      goal.pitch = lerp(tween.from.pitch, tween.to.pitch, k);
      if (tween.t >= 1) tween = null;
    }
    /* 指数逼近：每秒收敛到剩下的 0.15% / 0.4%。帧率无关 —— 用固定 dt 驱动
       和实时驱动得到同一条曲线，录制才拍得对。 */
    view.yaw = lerp(view.yaw, goal.yaw, 1 - Math.pow(0.0015, dt));
    view.pitch = lerp(view.pitch, goal.pitch, 1 - Math.pow(0.0015, dt));
    view.dist = lerp(view.dist, goal.dist, 1 - Math.pow(0.004, dt));
    view.ty = lerp(view.ty, goal.ty, 1 - Math.pow(0.004, dt));
  }

  return {
    view, goal,
    apply, update, setPreset, settle, jumpTo, setTween, flushTween, zoomLimit,
    get dragging() { return pointers.size > 0; },
    get tweening() { return !!tween; },
  };
}
