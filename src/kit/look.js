import * as THREE from 'three';
import { merge } from './util.js';

/**
 * 显示模式：SHADED / CLAY / X-RAY。
 *
 * X-RAY 不做 wireframe：蛋形壳是 144 段 × 二十几点的网格，线一叠上去就是一坨实心黑
 * （线宽改不了，只能靠不透明度硬压，压到 0.2 还是糊）。改成**技术制图的做法**：
 * 只画硬边轮廓（EdgesGeometry，折角 > 26° 才留），实体全部关掉。
 */
export function createLook({ root, opts = {} }) {
  const O = merge({
    edge: { color: 0x2e2d29, opacity: 0.62, threshold: 26 },
    clay: { color: 0xe7e2d9, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.75 },
  }, opts);

  const EDGE_MAT = new THREE.LineBasicMaterial({
    color: O.edge.color, transparent: true, opacity: O.edge.opacity,
  });
  let edgeLines = null;

  function buildEdges() {
    if (edgeLines) return edgeLines;
    edgeLines = [];
    /* 边线必须是**那个 mesh 的子对象**，不能把 matrixWorld 预烘成静态几何挂到
       转台下：那套做法一拆解就露馅 —— 实体在飞、线不动，画面里出现两套错位的轮廓；
       收拢之后拆解位置的「幽灵零件」还留在原处。挂成子对象就天然跟随旋转与拆解。 */
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });   // 先收集再挂子对象
    for (const o of meshes) {
      let eg;
      try { eg = new THREE.EdgesGeometry(o.geometry, O.edge.threshold); } catch (e) { continue; }
      if (!eg.attributes.position || eg.attributes.position.count === 0) { eg.dispose(); continue; }
      const ls = new THREE.LineSegments(eg, EDGE_MAT);
      ls.layers.set(0);
      ls.visible = false;
      o.add(ls);
      edgeLines.push(ls);
    }
    return edgeLines;
  }
  function setEdges(v) { if (edgeLines) for (const l of edgeLines) l.visible = v; }

  const CLAY = new THREE.MeshStandardMaterial({ ...O.clay });
  const orig = new Map();
  root.traverse((o) => { if (o.isMesh) orig.set(o, o.material); });

  /** @param {'shaded'|'clay'|'xray'} m */
  function setMode(m) {
    const xray = m === 'xray';
    if (xray) { buildEdges(); setEdges(true); } else setEdges(false);
    root.traverse((o) => {
      if (!o.isMesh) return;
      /* 关实体不能用 `visible = false`：three 的 projectObject 遇到 visible=false
         直接 return，整棵子树（含刚挂上去的边线）一起消失。改用 layers：
         实体扔到 layer 1（相机只看 0），边线留 0。 */
      o.layers.set(xray ? 1 : 0);
      if (!xray) o.material = m === 'clay' ? CLAY : orig.get(o);
    });
    return m;
  }

  return { setMode, setEdges, EDGE_MAT, CLAY, orig, get edgeLines() { return edgeLines; } };
}
