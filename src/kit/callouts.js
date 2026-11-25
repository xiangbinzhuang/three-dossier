import * as THREE from 'three';
import { clamp } from './util.js';

/**
 * 标注（callout）：3D 锚点 → 屏幕坐标 → DOM 标签 + 引线。
 *
 * 三件必须做对的事：
 *   ① 锚点挂在**零件层**上，不挂在转台的固定点 —— 拆解时层沿轴向飞出去，
 *      挂在层上的锚点自然跟着走，标注才不会指着一片空气。
 *   ② 左右各有一层同名零件时，按**层法线**挑朝向观众的那只，
 *      不能按距离挑（两边到相机距离几乎一样，会五五开乱跳）。
 *   ③ 同栏标签按期望 y 排序后依次下推，溢出底栏再整栏上抬。
 */

const CELL = { no: 'no', lb: 'lb', zh: 'zh' };

export function createCallouts({
  product, spin, camera, layout, cfg, dom,
  getSpinA = () => 0, getExK = () => 0, getKind = () => 'paper',
}) {
  const anchors = [];
  const root = product.root;
  const parts = product.parts;

  /* ── 锚点工厂 ──────────────────────────────────────────────────────── */
  /* 挂在「零件层」自己的 group 上：局部位置 = 该层包围盒中心 → worldToLocal，
     层一动就自动跟随。 */
  function anchorOnPart(name, dy = 0) {
    const pt = parts.find((p) => p.name === name);
    if (!pt) return null;
    const b = new THREE.Box3().setFromObject(pt.g);
    if (b.isEmpty()) return null;
    const c = b.getCenter(new THREE.Vector3());
    pt.g.worldToLocal(c);
    c.y += dy;
    const o = new THREE.Object3D();
    o.position.copy(c);
    pt.g.add(o);
    return o;
  }

  function anchorWorld(localVec, spinGroup) {
    const a = new THREE.Object3D();
    a.position.copy(spinGroup.worldToLocal(localVec.clone()));
    spinGroup.add(a);
    return a;
  }

  /* root 本地坐标（root 原点 = 产品自身原点）→ 世界 → spin 下 */
  function anchorFromRoot(local) {
    root.updateMatrixWorld(true);
    spin.updateMatrixWorld(true);
    const w = root.localToWorld(local.clone());
    const a = new THREE.Object3D();
    a.position.copy(spin.worldToLocal(w));
    spin.add(a);
    return a;
  }

  /* ── 建锚点 ────────────────────────────────────────────────────────── */
  function build() {
    /* 必须先刷新世界矩阵再取包围盒：否则 setFromObject 读到的是尚未乘父级变换
       的局部坐标，锚点会全部塌到原点（屏幕上就是几个橙点挤在正中）。 */
    spin.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    spin.parent?.updateMatrixWorld(true);

    for (const c of cfg) {
      const a = {
        no: c.no, label: c.label, zh: c.zh, side: c.side || 'left',
        dy: c.dy || 0, hidden: !!c.hidden,
        p: new THREE.Vector3(), el: null, el2: null, dot: null,
        obj: null, alts: null, prox: null, pick: null,
      };
      const A = c.anchor || {};

      if (A.kind === 'root') {
        a.obj = anchorFromRoot(new THREE.Vector3(...A.at));
      } else if (A.kind === 'part') {
        a.obj = anchorOnPart(A.name, A.lift || 0);
      } else if (A.kind === 'parts') {
        /* 03 / 04：左右各有一层同名零件，按**层法线**挑朝向观众的那只。
           内层朝中轴、外壳朝外，可见侧正好相反 —— 用 ±x 点乘相机方向才不会指错面。 */
        a.alts = A.names.map((n, i) => ({
          n: anchorOnPart(n, A.lift || 0),
          s: A.normals[i],
          f: A.facing,
        })).filter((o) => o.n);
      } else if (A.kind === 'joints') {
        /* 球没有固定法线：左右各一颗，每帧挑离相机近的那颗 */
        a.prox = A.joints.map((oi) => {
          const v = new THREE.Vector3();
          product.joints[oi].getWorldPosition(v);
          return anchorWorld(v, spin);
        });
      }
      anchors.push(a);
    }
  }

  /* ── 标签 DOM ──────────────────────────────────────────────────────── */
  function buildLabels() {
    for (const a of anchors) {
      const d = document.createElement('div');
      d.className = 'callout ' + a.side;
      d.innerHTML = `<span class="${CELL.no}">${a.no}</span>`
                  + `<span class="${CELL.lb}">${a.label}</span>`
                  + `<span class="${CELL.zh}">${a.zh || ''}</span>`;
      dom.labelHost.appendChild(d);
      a.el = d;

      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ln.setAttribute('fill', 'none');
      ln.setAttribute('stroke', '#a9a49b');
      ln.setAttribute('stroke-width', '0.9');
      /* 引线用虚线 = 隐藏件的制图惯例（内部零件不在视野里） */
      if (a.hidden) ln.setAttribute('stroke-dasharray', '3 2.6');
      dom.leaderSvg.appendChild(ln);
      a.el2 = ln;

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2.2');
      dot.setAttribute('fill', '#df5a1e');
      dom.leaderSvg.appendChild(dot);
      a.dot = dot;
    }
  }

  /* ── 每帧更新 ──────────────────────────────────────────────────────── */
  const tmpV = new THREE.Vector3();
  const tmpR = new THREE.Vector3();
  const cenW = new THREE.Vector3(0, 0, 0);   // 转台原点就是产品中心
  const camDir = new THREE.Vector3();

  function update(labelsOn = true) {
    if (!labelsOn) return;
    const W = window.innerWidth, H = window.innerHeight;
    const mob = layout.m;
    const exK = getExK();
    const kind = getKind();
    const spinA = getSpinA();

    /* 竖屏手机：产品几乎占满宽度，标签只能贴到两侧边（左 10 / 右 10），字号也小一号。
       横屏手机 / 平板宽度够，仍按比例分栏 —— 贴边会让引线横穿半个屏幕。
       左栏随拆解外移：拆开后零件铺到画面左半边，标签停在 0.245 会压在黑色零件上，
       纸色描边也救不回来。往左让 10%，给标签留一条干净的空地。 */
    const pcol = mob && W < 760;
    const colL = pcol ? 10 : W * (0.245 - 0.100 * exK);
    const colR = pcol ? W - 10 : W * 0.757;
    /* 竖直可落位区间：桌面躲开底部三栏，手机躲开顶部标题与底部 dock */
    const topL = mob ? layout.head : 96;
    const botL = mob ? layout.dock : H - 176;
    const GAP = mob ? 30 : 42;   // 两行标签 ~29px，留呼吸（手机字号小，间距同步收紧）

    /* 层次：拿「锚点相对产品中心的方向」和「相机方向」做点积。朝观众的一侧实色
       实线，转到背面的压到 0.26 —— 转台一直在转，五个标注永远有前后之分，
       一刀切隐藏反而会让人以为某层消失了。 */
    camDir.copy(camera.position).sub(cenW).normalize();
    const cc = Math.cos(spinA), sn = Math.sin(spinA);

    const rows = [];
    for (const a of anchors) {
      // 有 alts 的（03/04）：挑朝向相机的那一层
      if (a.alts && a.alts.length) {
        let best = a.alts[0], bs = -Infinity;
        for (const o of a.alts) {
          /* 法线 (±x) 要先跟着转台转，再和相机方向点积 ——
             层法线的世界分量是 (s·cos(spinA), 0, −s·sin(spinA))。
             直接拿未旋转的 s 去点积，等于假设转台没转过：非零 spin 时
             会挑中背对相机的那一层，标注指着看不见的零件自己先灰掉。 */
          const n = o.s * o.f;
          const s = n * (cc * camDir.x - sn * camDir.z);
          if (s > bs) { bs = s; best = o; }
        }
        a.obj = best.n; a.pick = best;
      }
      // joints：挑离相机近的那颗
      if (a.prox) {
        let best = a.prox[0], bd = Infinity;
        for (const o of a.prox) {
          o.getWorldPosition(tmpR);
          const d = tmpR.distanceToSquared(camera.position);
          if (d < bd) { bd = d; best = o; }
        }
        a.obj = best; a.pick = null;
      }
      if (!a.obj) continue;

      a.obj.getWorldPosition(a.p);
      const v = tmpV.copy(a.p).project(camera);
      const x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      const inFront = v.z < 1;

      /* 03/04 必须用「层法线」判前后，不能用「锚点相对产品中心的方向」：
         内层零件长在外壳朝中轴的那一面，人站在 +x 侧看它，而它的位置在 −x 侧 ——
         用位置方向会把唯一可见的内层判成背面，标注直接灰掉。
         其余（横梁顶 / 关节 / 内部件）用位置方向就够了。 */
      let facing;
      if (a.pick) {
        const n = a.pick.s * a.pick.f;
        facing = n * (cc * camDir.x - sn * camDir.z);   // 法线 (±x) 随转台旋转后的 x/z 分量
      } else {
        const rel = tmpR.copy(a.p).sub(cenW);
        const len = rel.length();
        facing = len > 1e-5 ? rel.divideScalar(len).dot(camDir) : 1;
      }
      const back = facing < -0.16;
      /* 背面标注淡出：纸面 0.26 刚好「退到后景但仍可读」，深底上同样 0.26 会直接
         消失（底色吃掉对比），所以暗场抬到 0.45。 */
      const op = inFront ? (back ? (kind === 'dark' ? 0.45 : 0.26) : 1) : 0;

      rows.push({
        a, x, y, op, back,
        left: x < W * 0.5,
        want: clamp(y + a.dy * (mob ? 0.55 : 1), topL, botL),
      });
    }

    /* 同栏防重叠：按期望 y 排序后依次下推 —— 最容易撞的是 02/04，
       它们本来就指着同一侧的上沿和下沿。推完若溢出底栏，再整栏上抬。 */
    for (const side of [true, false]) {
      const arr = rows.filter((r) => r.left === side).sort((p, q) => p.want - q.want);
      let prev = -1e9;
      for (const r of arr) { r.ly = Math.max(r.want, prev + GAP); prev = r.ly; }
      if (arr.length) {
        const over = arr[arr.length - 1].ly - botL;
        if (over > 0) for (const r of arr) r.ly = Math.max(topL, r.ly - over);
      }
    }

    for (const r of rows) {
      const a = r.a, left = r.left;
      if (a._left !== left) {
        a._left = left;
        a.el.classList.toggle('left', left);
        a.el.classList.toggle('right', !left);
      }
      const ly = clamp(r.ly, topL, botL);

      if (pcol) {
        /* 竖屏：两栏各自贴边。右栏用 right 定位，盒子右边缘才对齐 ——
           用 left:W-10 会因为不知道文字宽度而整列溢出屏幕。 */
        if (left) { a.el.style.left = colL + 'px'; a.el.style.right = 'auto'; }
        else { a.el.style.left = 'auto'; a.el.style.right = '10px'; }
        if (!a._w) a._w = a.el.offsetWidth || 80;
      } else {
        a.el.style.left = (left ? colL : colR) + 'px';
        a.el.style.right = 'auto';
      }
      a.el.style.top = ly + 'px';
      a.dot.setAttribute('cx', r.x.toFixed(1));
      a.dot.setAttribute('cy', r.y.toFixed(1));

      /* 只在数值真的变了才写 opacity，否则每帧赋值会打断 CSS 过渡 */
      const key = r.op + (r.back ? 0.05 : 0);
      if (a._k !== key) {
        a._k = key;
        a.el.style.opacity = r.op;
        a.dot.style.opacity = r.op;
        a.el2.style.opacity = r.op * (r.back ? 0.62 : 1);
      }

      /* 引线落在盒子的「内侧边缘」：手机右栏要让开文字宽度，否则线会穿过字 */
      const edge = left ? colL + 6 : (pcol ? colR - a._w - 6 : colR - 6);
      const mx = r.x + (edge - r.x) * 0.58;
      const my = r.y + (ly - r.y) * 0.82;
      a.el2.setAttribute('d',
        `M${r.x.toFixed(1)} ${r.y.toFixed(1)} L${mx.toFixed(1)} ${my.toFixed(1)} L${edge.toFixed(1)} ${ly.toFixed(1)}`);
    }
  }

  /** 显隐：DOM 层和引线 SVG 一起收，3D 本身不动 */
  function setVisible(on) {
    dom.labelHost.style.display = on ? '' : 'none';
    dom.leaderSvg.style.display = on ? '' : 'none';
    /* 隐藏期间 offsetWidth 是 0，回来时要重量 */
    if (on) for (const a of anchors) a._w = 0;
  }

  /** 字号 / 分栏变了 → 标签宽度缓存作废 */
  function invalidate() { for (const a of anchors) a._w = 0; }

  return { anchors, build, buildLabels, update, setVisible, invalidate, camDir };
}
