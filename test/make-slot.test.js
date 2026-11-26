import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'tools', 'make-slot.mjs');

/** 造一个 OBJ：两个同心装配 + 一个偏出去的。 */
async function writeObj(dir, name, body) {
  const p = join(dir, name);
  await writeFile(p, body, 'utf8');
  return p;
}

const TWO_CENTRIC = [
  'o shell',
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'f 1 2 3 4',
  'o core',
  'v 0 0 0.2', 'v 0.5 0 0.2', 'v 0.5 0.5 0.2', 'v 0 0.5 0.2',
  'f 5 6 7 8',
].join('\n');

const WITH_BODY = [
  'o body',
  'v -2 -0.25 0', 'v 2 -0.25 0', 'v 2 0.25 0', 'v -2 0.25 0',
  'f 1 2 3 4',
  'o grip',
  'v -0.3 -1 0', 'v 0.3 -1 0', 'v 0.3 -0.25 0', 'v -0.3 -0.25 0',
  'f 5 6 7 8',
  'o scope',
  'v -0.6 0.25 0', 'v 0.6 0.25 0', 'v 0.6 0.8 0', 'v -0.6 0.8 0',
  'f 9 10 11 12',
].join('\n');

/** 从生成的 rig.js 里把 explode 表抠出来。 */
function parseExplode(rig) {
  const raw = rig.match(/explode: (\{[\s\S]*?\}),\n/)[1];
  return JSON.parse(raw.replace(/\n\s*/g, '').replace(/,\}/, '}'));
}

async function gen(objPath, slot, extra = []) {
  const r = await run('node', [SCRIPT, objPath, slot, ...extra], { cwd: ROOT });
  return r.stdout;
}

const slotDirOf = (name) => join(ROOT, 'src', 'products', name);

test('生成器：建出槽目录与两个文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', TWO_CENTRIC);
    await gen(obj, 'test-a');
    const rig = await readFile(join(slotDirOf('test-a'), 'rig.js'), 'utf8');
    const cfg = await readFile(join(slotDirOf('test-a'), 'config.js'), 'utf8');
    assert.ok(rig.includes("import modelText from './m.obj'"), 'rig 应 import 模型');
    assert.ok(cfg.includes('createRig'), 'config 应导出 createRig');
  } finally {
    await rm(slotDirOf('test-a'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：模型文件被拷进槽目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', TWO_CENTRIC);
    await gen(obj, 'test-b');
    const copied = await readFile(join(slotDirOf('test-b'), 'm.obj'), 'utf8');
    assert.equal(copied, TWO_CENTRIC);
  } finally {
    await rm(slotDirOf('test-b'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：标注按模型的分组名索引', async () => {
  // 这是最难查的一类问题 —— 分组名对不上时标注静默消失。
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', TWO_CENTRIC);
    await gen(obj, 'test-c');
    const cfg = await readFile(join(slotDirOf('test-c'), 'config.js'), 'utf8');
    // 只取 anchor 里的 name —— 别的 name（槽名等）与分组无关
    const names = [...cfg.matchAll(/anchor: \{ kind: 'part', name: '([^']+)' \}/g)].map((m) => m[1]);
    assert.ok(names.length > 0, '应当生成至少一条 part 标注');
    for (const n of names) {
      assert.ok(TWO_CENTRIC.includes(`o ${n}`), `标注引用了模型里不存在的分组：${n}`);
    }
    // root 锚点只给主体件用，且必须指向一个真实存在的装配
    const rootAnchors = [...cfg.matchAll(/anchor: \{ kind: 'root', at: \[[^\]]*\] \}/g)];
    assert.ok(rootAnchors.length <= 1, 'root 锚点最多一条（主体件）');
  } finally {
    await rm(slotDirOf('test-c'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：主体件留在原位，其余向外散开', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', WITH_BODY);
    await gen(obj, 'test-d');
    const rig = await readFile(join(slotDirOf('test-d'), 'rig.js'), 'utf8');
    const explode = parseExplode(rig);
    // body 在模型中心，不该被推开
    assert.equal(explode.body, undefined, '主体件不应出现在 explode 里');
    // grip 在下方 → 往下推；scope 在上方 → 往上推
    assert.ok(explode.grip[1] < 0, `grip 应向下推，实得 ${explode.grip}`);
    assert.ok(explode.scope[1] > 0, `scope 应向上推，实得 ${explode.scope}`);
  } finally {
    await rm(slotDirOf('test-d'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：maxPush 等于最大的 off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', WITH_BODY);
    await gen(obj, 'test-e');
    const cfg = await readFile(join(slotDirOf('test-e'), 'config.js'), 'utf8');
    const rig = await readFile(join(slotDirOf('test-e'), 'rig.js'), 'utf8');
    const maxPush = Number(cfg.match(/maxPush: ([\d.]+)/)[1]);
    const biggest = Math.max(...Object.values(parseExplode(rig)).flat().map(Math.abs));
    assert.ok(Math.abs(maxPush - biggest) < 1e-6, `maxPush ${maxPush} 应等于最大 off ${biggest}`);
  } finally {
    await rm(slotDirOf('test-e'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：拒绝非法槽名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', TWO_CENTRIC);
    await assert.rejects(
      () => run('node', [SCRIPT, obj, 'Bad Name'], { cwd: ROOT }),
      /槽名/,
      '非法槽名应当报错'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('生成器：拒绝覆盖非空的槽目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slot-'));
  try {
    const obj = await writeObj(dir, 'm.obj', TWO_CENTRIC);
    await gen(obj, 'test-f');
    await assert.rejects(
      () => run('node', [SCRIPT, obj, 'test-f'], { cwd: ROOT }),
      /已存在/,
      '已有槽应当拒绝覆盖'
    );
  } finally {
    await rm(slotDirOf('test-f'), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});