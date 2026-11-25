import * as THREE from 'three';
import { merge } from './util.js';

/**
 * 取景：算出「让产品刚好落在那块空地里」的相机距离。
 *
 * 档案页的调性靠留白，所以不按「塞满视口」取景，而是按「塞满中间那块空地」。
 * 桌面上两侧有面板、手机上上下有标题和 dock，可用区域都不是整个窗口。
 */
export function createFraming({ bounds, camera, layout, cfg = {} }) {
  const F = merge({
    /* 拆解态：零件沿轴向朝两侧铺开，宽度填充比同时从 0.44 放到 0.60 ——
       正常态那点留白是给两侧面板的，拆开之后横向本来就该占满。 */
    exK: 0.68,
    maxPush: 2.0,
    /* BASE_TY = 相机看向的 y。调小等于把镜头往产品下方压，产品在画面里就上浮。
       桌面端底部有仪表栏挡住了一部分，所以把产品整体上抬一点。 */
    baseTY: -0.165,
    fill: {
      mobH: 0.60, mobW: 0.86,
      deskH: 0.52, deskHShort: 0.48, deskW: 0.44, deskWWide: 0.50,
      exH: 0.10, exW: 0.10, exWWide: 0.16, shortH: 720, wideW: 1200,
    },
  }, cfg);

  const halfH = (bounds.top - bounds.bottom) / 2;
  const halfW = bounds.halfW;
  const exPush = F.maxPush * F.exK;

  /** ex = 拆解进度 0..1；返回相机距离 */
  function fitDist(ex = 0) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    /* 手机上两侧没有面板了，产品可以占满宽度（拆开时收一点，零件会往外铺）。
       高度方向不能直接按窗口算：顶部标题和底部 dock 吃掉不少，真正给产品的
       只有中间那条带子，所以 fillH 乘上「带子占全高的比例」。 */
    const f = F.fill;
    const fillH = layout.m
      ? f.mobH * (layout.h > 0 ? (layout.dock - layout.head) / layout.h : 1) * (1 - f.exH * ex)
      : (window.innerHeight < f.shortH ? f.deskHShort : f.deskH) * (1 - f.exH * ex);
    const fillW = layout.m
      ? f.mobW - f.exW * ex
      : (window.innerWidth < f.wideW ? f.deskWWide : f.deskW) + f.exWWide * ex;
    const dv = halfH / (Math.tan(vFov / 2) * fillH);
    const dh = (halfW + exPush * ex) / (Math.tan(hFov / 2) * fillW);
    return Math.max(dv, dh);
  }

  return { fitDist, halfH, halfW, exK: F.exK, baseTY: F.baseTY, opts: F };
}
