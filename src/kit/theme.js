import { lighten, darken, merge } from './util.js';

/**
 * 双主题：PAPER / DARK FIELD。
 *
 * 暗场不是「把背景调暗」—— 那只让产品跟着一起黑掉，正是要避免的。
 * 这里同时改六样：环境贴图（深底 + 高对比 strip，在 stage 里）、直射光配比、
 * 曝光、地面接影、刻度盘、X-RAY 边线。
 */
export function createTheme({ stage, look, opts = {}, onApply }) {
  const LIGHT_SET = merge({
    paper: {
      key: 2.35, fill: 0.85, rim: 1.25, bottom: 0.35, hemi: 0.55,
      hemiSky: 0xfffdf8, hemiGnd: 0x8e8880, exposure: 1.02,
      shadow: 0x6d6558, shadowOp: 0.17, dial: 0x8d8a83, dialOp: 0.55,
      /* X-RAY 边线：纸面是深灰线画在浅纸上（技术制图） */
      edge: 0x2e2d29, edgeOp: 0.62,
    },
    dark: {
      /* 暗场里 key 2.35→2.90、rim 1.25→2.30 —— 深底上白壳必须靠一道亮轮廓跟背景
         分开，否则边缘整个「溶」进去；同时 hemi 降到 0.30，把补光让给方向光。 */
      key: 2.90, fill: 0.70, rim: 2.30, bottom: 0.30, hemi: 0.30,
      hemiSky: 0x9fc4e8, hemiGnd: 0x0a0d12, exposure: 1.12,
      /* 影子在暗场里不能给深：ShadowMaterial 只出影子不出地面，纯黑 + 0.52
         会变成画面正中一个「黑洞」。0.26 的深蓝黑才读成落影。 */
      shadow: 0x080c12, shadowOp: 0.26,
      /* 刻度盘反而要比纸面亮 —— 深底上细线本来就看不见，0.34 直接消失。 */
      dial: 0x9fb0c4, dialOp: 0.52,
      /* 暗场边线必须往亮里走。原来的深灰线画在近黑底上，整台产品只剩一团影子，
         最该出效果的「暗场线框」反而什么都看不见。 */
      edge: 0xbedcf0, edgeOp: 0.66,
    },
  }, opts);

  let kind = 'paper';
  const { renderer, scene, lights, ground, dialMats } = stage;
  const { hemi, key, fill, rim, bottom } = lights;

  /** @param {'paper'|'dark'} next */
  function set(next) {
    kind = next === 'dark' ? 'dark' : 'paper';
    const L = LIGHT_SET[kind];
    scene.environment = kind === 'dark' ? stage.env.dark : stage.env.paper;
    renderer.toneMappingExposure = L.exposure;
    key.intensity = L.key; fill.intensity = L.fill;
    rim.intensity = L.rim; bottom.intensity = L.bottom;
    hemi.intensity = L.hemi; hemi.color.setHex(L.hemiSky); hemi.groundColor.setHex(L.hemiGnd);
    ground.material.color.setHex(L.shadow); ground.material.opacity = L.shadowOp;
    look.EDGE_MAT.color.setHex(L.edge); look.EDGE_MAT.opacity = L.edgeOp;

    for (const d of dialMats) {
      /* 「浅」在纸面和暗场是**两个方向**，不能一条公式套过去。
         纸面：浅 = 往白里兑 + 高不透明度 ⇒ 边缘立得住又不抢产品。
         暗场：浅 = 更亮 = 更抢眼。粗环照抄「兑白 + 0.86」会变成一圈发光灯带，
         正好违反「刻度盘要克制」。所以暗场把方向反过来：往黑里兑 + 降透明。 */
      if (kind === 'dark') {
        d.mat.color.setHex(d.k ? darken(L.dial, d.k * 0.55) : L.dial);
        d.mat.opacity = d.base * (L.dialOp / 0.55) * (d.k ? 0.42 : 1);
      } else {
        d.mat.color.setHex(d.k ? lighten(L.dial, d.k) : L.dial);
        d.mat.opacity = d.base * (L.dialOp / 0.55);
      }
    }
    document.body.dataset.env = kind;
    onApply?.(kind);
    return kind;
  }

  return { set, get kind() { return kind; }, sets: LIGHT_SET };
}
