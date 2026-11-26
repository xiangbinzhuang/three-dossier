import modelText from './demo.obj';
import { buildObjRig } from '../../kit/objrig.js';

/**
 * OBJ-DEMO —— 用一个外部模型文件驱动的产品槽。
 *
 * 这是「换一个产品来展示」的最小完整示例：几何来自 demo.obj（构建期内联进
 * 产物，运行时零网络请求），行为数据在下面这个文件里。
 *
 * demo.obj 里的 `o` 语句定义了四个装配：
 *   base     底座        —— 不参与拆解
 *   housing  外壳        —— 拆解时向上抬起
 *   core     内核        —— 留在原地，被外壳让出来后露出来
 *   cap      顶盖        —— 飞得最远
 *
 * 换成你自己的模型时，要改的只有三处：
 *   ① 换掉 import 的模型文件
 *   ② 改 layers —— 列出你想拆开的装配名
 *   ③ 改 explode —— 每个层往哪个方向推多远
 *
 * 模型必须按部件分成 `o` / `g` 组，爆炸图的「层」才有意义。整一个没分组的
 * OBJ 只能当静态模型展示，拆解会把它整体平移出去。
 */
export function createRig() {
  return buildObjRig(modelText, {
    /* 归一化后的目标高度。CAD 导出的 OBJ 单位不统一，这里统一到 2 个世界单位，
       kit 的取景参数是按这个尺度调过的。 */
    height: 2.0,
    up: 'y',

    /* 参与拆解的层，顺序决定 config.explode 里的位移方向。
       没列出的装配（比如 base）留在原地。 */
    layers: ['housing', 'core', 'cap'],

    /* 每个层的拆解位移 —— 是「满拆时该层走多远」，不是装配偏移。
       这里让三层沿 y 依次往上抽，读起来就是「拔顶盖 → 提外壳 → 露内核」。 */
    explode: {
      cap: [0, 1.35, 0],
      housing: [0, 0.68, 0],
      core: [0, 0, 0],
    },

    /* 材质覆写。loader 给的材质通常没有 metalness / roughness，
       不覆写的话在影棚灯光下会显得很平。 */
    materials: {
      base: { color: 0x2d3239, roughness: 0.28, metalness: 0.78 },
      housing: { color: 0xb9b4aa, roughness: 0.58, metalness: 0.16 },
      core: { color: 0x1d2026, roughness: 0.72, metalness: 0.12 },
      cap: { color: 0x2d3239, roughness: 0.28, metalness: 0.78 },
    },
  });
}
