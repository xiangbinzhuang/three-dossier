/** 数值 / 颜色 / 选择器小工具。kit 内部共用，产品层也可以直接用。 */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** 拖拽专用缓动：smoothstep，峰值速度只有均值的 1.5 倍。
 *  不能用 easeIO（easeInOutCubic）走拖拽路径 —— 它峰值是均值 3 倍，1.5 s 的摆动
 *  会被放大成「甩鞭子」（实测峰值 890°/s，画面直接糊）。光标位移用它没问题，因为单段很短。 */
export const easeSmooth = (w) => {
  w = clamp(w, 0, 1);
  return w * w * (3 - 2 * w);
};

export const TAU = Math.PI * 2;

/** 把 from 转到 to 的**最短路径**，返回值可以超出 [0, 2π)。
 *  转台角度必须取模：早先它无限累加（自转 10 分钟就是 200 rad），
 *  而「切视图」是拿它当目标角度的 —— 相机于是要沿螺旋转好几圈才落到位。 */
export const wrapYaw = (from, to) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return from + d;
};

/** 「浅」要改颜色，不要只压不透明度：纸面有纹理，半透明粗线会被吃成光晕。 */
export const lighten = (hex, k) => {
  const f = (v) => Math.round(v + (255 - v) * k);
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
};
export const darken = (hex, k) => {
  const f = (v) => Math.round(v * (1 - k));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
};

export const one = (sel, root = document) => root.querySelector(sel);
export const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 深浅合并配置（只合并普通对象，数组整体替换） */
export function merge(base, over) {
  if (!over) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)) {
      out[k] = merge(b, v);
    } else out[k] = v;
  }
  return out;
}
