#!/usr/bin/env node
/**
 * 从一个 OBJ 模型生成产品槽。
 *
 * 用法：
 *   node tools/make-slot.mjs <model.obj> <slot-name>
 *   node tools/make-slot.mjs <model.obj> <slot-name> --size 2.0 --up y
 *
 * 会生成：
 *   src/products/<slot-name>/rig.js      几何装配（引用模型文件）
 *   src/products/<slot-name>/config.js   行为数据（机位、标注、拆解）
 *
 * 生成的不是最终答案 —— 它把「模型有哪几个装配、该怎么拆、标注挂哪」这些
 * **能算出来的部分**先算好，你只需要改文案和调参。
 *
 * 为什么需要它：产品槽的契约里，config.js 的标注是按**模型的分组名**索引的
 * （`anchor: { kind: 'part', name: 'housing' }`）。手写时分组名对不上，
 * 标注会**静默消失** —— 不报错，只是看不见，最难查。
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── 参数 ──────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const flagOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const positional = args.filter((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = args[i - 1];
  return !(prev && prev.startsWith('--'));
});

const modelArg = positional[0];
const slotName = positional[1];

if (!modelArg || !slotName) {
  console.error('用法：node tools/make-slot.mjs <model.obj> <slot-name> [--size 2.0] [--up y|z]');
  console.error('');
  console.error('例：node tools/make-slot.mjs ~/Desktop/my-part.obj my-part');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slotName)) {
  console.error(`槽名只能用小写字母、数字和连字符：${slotName}`);
  process.exit(1);
}

const size = Number(flagOf('--size', '2.0'));
const up = flagOf('--up', 'y');
const modelPath = resolve(process.cwd(), modelArg);
const slotDir = join(ROOT, 'src', 'products', slotName);

/* ── 解析模型 ──────────────────────────────────────────────────────── */
if (!existsSync(modelPath)) {
  console.error(`找不到模型文件：${modelPath}`);
  process.exit(1);
}

const text = await readFile(modelPath, 'utf8');
const parsed = new OBJLoader().parse(text);

/* OBJLoader 把每个 o / g 分组做成一个 child。 */
const assemblies = parsed.children
  .map((c, i) => ({ name: c.name || `assembly_${i + 1}`, obj: c }))
  .filter((a) => {
    let n = 0;
    a.obj.traverse((o) => { if (o.isMesh) n++; });
    return n > 0;
  });

if (!assemblies.length) {
  console.error('模型里没有可用的装配（没有任何 mesh）。');
  console.error('提示：OBJ 需要用 `o 名称` 或 `g 名称` 分组，否则没法做拆解。');
  process.exit(1);
}

/* ── 量每个装配的位置 ──────────────────────────────────────────────── */
parsed.updateMatrixWorld(true);
const wholeBox = new THREE.Box3().setFromObject(parsed);
const wholeCenter = wholeBox.getCenter(new THREE.Vector3());
const wholeSize = wholeBox.getSize(new THREE.Vector3());

const info = assemblies.map((a) => {
  const b = new THREE.Box3().setFromObject(a.obj);
  const c = b.getCenter(new THREE.Vector3());
  const dir = c.clone().sub(wholeCenter);
  return {
    name: a.name,
    center: c,
    dir,
    /* 与整机中心的距离 —— 用来决定推开多远 */
    reach: dir.length(),
    size: b.getSize(new THREE.Vector3()),
  };
});

/* ── 定拆解方向与行程 ────────────────────────────────────────────────
   规则：
     ① 装配中心明显偏离整机中心 → 沿那个方向推（「拔出来」的读法）
     ② 几乎同心的装配（reach 很小）→ 按装配在 OBJ 里出现的顺序，
        沿**主轴**依次排开，间距递增
   主轴取整机最长的那条尺寸轴；层序沿该轴排。 */
const dims = [wholeSize.x, wholeSize.y, wholeSize.z];
const axis = dims.indexOf(Math.max(...dims));
const AXIS_VEC = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
][axis];

/* 同心阈值：偏离心机不足整机尺寸的 8% 就算同心 */
const reachThreshold = Math.max(...dims) * 0.08;

/* ── 主体件判定 ────────────────────────────────────────────────────────
   离整机中心最近的那个装配通常是主体（枪身、机身、底座）。
   主体留在原位 —— 拆解图里主体飘走，读不出「拆开是什么样」，
   只剩一堆零件乱飞。

   必须在「同心分类」**之前**判定：主体件往往也是最居中的那个，
   若先分同心，主体就被当成同心层一起排开了。 */
let bodyName = null;
if (info.length > 1) {
  let best = null;
  for (const i of info) {
    if (!best || i.reach < best.reach) best = i;
  }
  /* 只有明显比其他装配更居中才算主体（差距要够大，
     否则是同心的多层结构，比如外壳套内核 —— 那种每个都要拆） */
  const others = info.filter((i) => i !== best);
  const minOther = Math.min(...others.map((i) => i.reach));
  if (best.reach < minOther * 0.6) bodyName = best.name;
}

/* 同心的装配（主体件已排除） */
const concentric = info.filter((i) => i.reach < reachThreshold && i.name !== bodyName);
/* 同心的装配按主轴方向排序：从负端到正端 */
concentric.sort((a, b) => a.center.dot(AXIS_VEC) - b.center.dot(AXIS_VEC));

/* 拆解行程：最远的一层推多少。取整机最长边的 0.42 倍 —— 与 kit 的
   取景留白相称（sample 的最大 off 是 1.35，整机最长边约 1.94）。 */
const maxTravel = Math.max(...dims) * 0.42;
const step = maxTravel / Math.max(1, concentric.length);

function round(v) {
  return Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000;
}

/* ── 生成 explode 表 ───────────────────────────────────────────────── */
const explode = {};

for (const i of info) {
  if (concentric.includes(i) || i.name === bodyName) continue;
  /* 非同心：沿自己的方向推，长度按离心率缩放 —— 越靠外的推得越远 */
  const unit = i.dir.clone().normalize();
  const t = Math.min(1, (i.reach / reachThreshold) * 0.6 + 0.4);
  const v = unit.multiplyScalar(maxTravel * t);
  explode[i.name] = [round(v.x), round(v.y), round(v.z)];
}

/* 同心的：沿主轴依次排开，最外的推最远 */
concentric.forEach((i, k) => {
  const half = Math.ceil(concentric.length / 2);
  const sign = k < half ? -1 : 1;
  const rank = k < half ? (half - k) : (k - half + 1);
  const v = AXIS_VEC.clone().multiplyScalar(sign * step * rank);
  explode[i.name] = [round(v.x), round(v.y), round(v.z)];
});

/* 只有一个装配 → 没有可拆的层，留空 */
if (info.length === 1) {
  for (const k of Object.keys(explode)) delete explode[k];
}

/* ── 标注 ────────────────────────────────────────────────────────────
   每个可拆层一条，挂在该层上（拆解时跟着层飞走）。
   主体件（不参与拆解的那个）也配一条，用 kind:'root' 挂在整机坐标上 ——
   否则模型上最大的那一块反而没有标注。

   dy 从上往下均分排布，左右交替 —— 与 kit 的防重叠逻辑相容。 */
const layers = Object.keys(explode);
const callouts = layers.map((name, k) => ({
  no: String(k + 1).padStart(2, '0'),
  label: prettyName(name),
  zh: name,
  side: k % 2 === 0 ? 'left' : 'right',
  dy: -120 + k * 70,
  anchor: { kind: 'part', name },
}));

/* 主体件：root 局部坐标里的一个点 —— 取它在整机里的实际中心，
   减去整机中心（归一化后整机中心在原点），换算到 root 坐标。 */
if (bodyName) {
  const bi = info.find((i) => i.name === bodyName);
  const at = bi.center.clone().sub(wholeCenter);
  callouts.unshift({
    no: '00',
    label: prettyName(bodyName),
    zh: bodyName,
    side: 'left',
    dy: -190,
    anchor: { kind: 'root', at: [round(at.x), round(at.y), round(at.z)] },
  });
  callouts.forEach((c, k) => { c.no = String(k + 1).padStart(2, '0'); });
}

function prettyName(n) {
  return String(n).replace(/[_-]+/g, ' ').trim().toUpperCase();
}

/* ── 写文件 ────────────────────────────────────────────────────────── */
if (existsSync(slotDir)) {
  const existing = await readdir(slotDir);
  if (existing.length) {
    console.error(`目标目录已存在且非空：src/products/${slotName}/`);
    console.error(`  里面已有：${existing.join(', ')}`);
    console.error('换个槽名，或先删掉那个目录。');
    process.exit(1);
  }
}

await mkdir(slotDir, { recursive: true });

/* 模型文件复制进槽目录 —— 槽是自包含的，换产品只动一个目录。 */
const modelName = basename(modelPath);
await writeFile(join(slotDir, modelName), text, 'utf8');

const rigJs = `import modelText from './${modelName}';
import { buildObjRig } from '../../kit/objrig.js';

/**
 * ${slotName} —— 产品槽（由 tools/make-slot.mjs 生成）。
 *
 * 模型：${modelName}
 * 装配：${info.map((i) => i.name).join(', ')}
 *
 * 改这几处：
 *   · layers   —— 哪些装配参与拆解（其余留在原位）
 *   · explode  —— 每层往哪个方向推多远（世界单位）
 *   · materials—— 颜色 / 粗糙度 / 金属度
 */
export function createRig() {
  return buildObjRig(modelText, {
    /* 归一化后的最长边目标长度（世界单位）。CAD 导出的 OBJ 单位不统一，
       这里统一到这个尺度 —— kit 的取景参数是按这个量级调过的。
       默认按**最长边**归一化：取景是按包围盒算的，按高度归一化的话，
       一个又宽又扁的产品会横向出画。 */
    size: ${size},
    up: '${up}',

    /* 参与拆解的层。没列出的装配留在原位。 */
    layers: ${JSON.stringify(layers)},

    /* 每层的拆解位移 —— 是「满拆时该层走多远」，不是装配偏移。
       ${concentric.length > 1 ? '这几层几乎同心，按主轴依次排开。' : '各层沿自己相对整机中心的方向推开。'} */
    explode: ${JSON.stringify(explode, null, 2).replace(/\n/g, '\n  ')},

    /* 材质覆写。loader 给的材质通常没有 metalness / roughness，
       不覆写的话在影棚灯光下会显得很平。 */
    materials: {
${info.map((i) => `      ${JSON.stringify(i.name)}: { color: 0xb9b4aa, roughness: 0.58, metalness: 0.16 },`).join('\n')}
    },
  });
}
`;

const maxPush = round(Math.max(0, ...Object.values(explode).flat().map(Math.abs)));

const configJs = `/**
 * ${slotName} —— 产品槽（由 tools/make-slot.mjs 生成）。
 *
 * 与其他插槽同构。剩下的事：
 *   · 改 name 为产品代号
 *   · 改 callouts 的 label / zh —— 现在是占位文案
 *   · 按模型的实际装配关系调 explode（见 rig.js）
 *   · 改 index.html 里的静态文案（型号、规格、面板标题）
 */
import { createRig } from './rig.js';

export default {
  name: '${slotName.toUpperCase()}',

  clock: { duration: 12, omega: 0.35 },   // 转台一圈 12 s，角速度 rad/s

  views: {
    hero: { yaw: 0.46, pitch: 0.11 },
    front: { yaw: 0.00, pitch: 0.02 },
    side: { yaw: Math.PI / 2, pitch: 0.05 },
    top: { yaw: 0.40, pitch: 1.02 },
  },

  /* 取景预留的爆炸行程 —— 必须等于 rig 里最大的 off。
     留少了零件会飞出画面，留多了产品缩得太小。 */
  framing: {
    maxPush: ${maxPush},
  },

  /* ── 标注 ──────────────────────────────────────────────────────────────
     anchor.kind 的四种：
       root   root 局部坐标里的一个点
       part   挂在某个零件层上，拆解时跟着层飞
       parts  左右各一层，按层法线挑朝向观众的那只
       joints 多颗球，挑离相机最近的
     这里给每个可拆层配了一条。label / zh 是占位文案，记得改。 */
  callouts: [
${callouts.map((c) => {
  const anchor = c.anchor.kind === 'root'
    ? `{ kind: 'root', at: [${c.anchor.at.join(', ')}] }`
    : `{ kind: 'part', name: '${c.anchor.name}' }`;
  return `    {
      no: '${c.no}', label: '${c.label}', zh: '${c.zh}', side: '${c.side}', dy: ${c.dy},
      anchor: ${anchor},
    },`;
}).join('\n')}
  ],

  hud: {
    lane: { samples: 300, width: 600, base: 18 },
    /* kit 的同心圆层叠图最多 10 条 —— 再多半径会变成负数。
       装配多于 10 个时只列前 9 个 + 主体，其余靠标注展示。 */
    layers: ${JSON.stringify(
      [...layers, ...(bodyName ? [bodyName] : [])].slice(0, 10).map(prettyName)
    )},
  },

  createRig,
};
`;

await writeFile(join(slotDir, 'rig.js'), rigJs, 'utf8');
await writeFile(join(slotDir, 'config.js'), configJs, 'utf8');

/* ── 报告 ──────────────────────────────────────────────────────────── */
console.log(`已生成产品槽 src/products/${slotName}/`);
console.log('');
console.log(`  模型      ${modelName}`);
console.log(`  装配      ${info.map((i) => i.name).join(', ')}`);
console.log(`  可拆层    ${layers.length ? layers.join(', ') : '(无 — 模型只有一个装配)'}`);
console.log(`  maxPush   ${maxPush}`);
console.log('');
console.log('下一步：');
console.log(`  1. 改 src/products/${slotName}/rig.js 里的 materials（配色）`);
console.log('  2. 改 config.js 里的 callouts 文案（label / zh）');
console.log('  3. 改 src/app/index.html 里的刊头和规格文案');
console.log('     —— 这一步不做，页面标题仍然是 SAMPLE');
console.log('  4. 构建并预览：');
console.log(`     npm run build -- --product ${slotName} --out examples/${slotName}/dossier.html`);
console.log(`     open examples/${slotName}/dossier.html`);
console.log('');
console.log('  配色建议：底座/框架用深色，主体外壳用浅色，内部件最深 ——');
console.log('  深色件在纸面底上形成层次，是这类页面惯用的读法。');
