import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { buildObjRig } from '../src/kit/objrig.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OBJ = join(HERE, '..', 'src', 'products', 'obj-demo', 'demo.obj');

/** 一个最小 OBJ：两个装配，各一个四边形。 */
const MINI_OBJ = [
  '# test',
  'o shell',
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'f 1 2 3 4',
  'o core',
  'v 0 0 0.2', 'v 0.5 0 0.2', 'v 0.5 0.5 0.2', 'v 0 0.5 0.2',
  'f 5 6 7 8',
].join('\n');

test('解析 OBJ：每个 o 分组成为一个装配', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 2 });
  assert.deepEqual(rig.meta.assemblies, ['shell', 'core']);
});

test('未列进 layers 的装配不参与拆解，但仍在 root 里', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 2, layers: ['shell'] });
  assert.deepEqual(rig.parts.map((p) => p.name), ['shell']);

  const names = [];
  rig.root.traverse((o) => { if (o.isMesh) names.push(o.name); });
  assert.ok(names.includes('core'), 'core 应当留在 root 里');
});

test('归一化到目标尺寸', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 4 });
  const h = rig.bounds.top - rig.bounds.bottom;
  // 原始模型最长边 1，归一化后应为 4
  assert.ok(Math.abs(h - 4) < 1e-3, `期望最长边 4，实得 ${h}`);
});

test('fit: "height" 按高度归一化', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 4, fit: 'height' });
  const h = rig.bounds.top - rig.bounds.bottom;
  assert.ok(Math.abs(h - 4) < 1e-3, `期望高度 4，实得 ${h}`);
});

test('root 的 position 与 scale 必须是 0 / 1', () => {
  // app 层（main.js）会按 bounds 把产品居中到转台中心：
  //   root.position.y = -(top + bottom) / 2
  // 若适配器也动 root.position，两处互相覆盖，模型实际位置与 bounds
  // 相差一个高度，取景失准、模型撑出画面。
  const rig = buildObjRig(MINI_OBJ, { size: 2 });
  assert.equal(rig.root.position.x, 0);
  assert.equal(rig.root.position.y, 0);
  assert.equal(rig.root.position.z, 0);
  assert.equal(rig.root.scale.x, 1);
  assert.equal(rig.root.scale.y, 1);
  assert.equal(rig.root.scale.z, 1);
});

test('bounds 必须与实际几何一致', () => {
  // 这是「模型撑出画面」那个 bug 的直接判据：
  // bounds 与实际几何差了整整一个高度，取景就会算错。
  const rig = buildObjRig(MINI_OBJ, { size: 2 });
  const box = new THREE.Box3().setFromObject(rig.root);
  assert.ok(Math.abs(rig.bounds.top - box.max.y) < 1e-6, 'bounds.top 应等于实际 max.y');
  assert.ok(Math.abs(rig.bounds.bottom - box.min.y) < 1e-6, 'bounds.bottom 应等于实际 min.y');
  assert.ok(
    Math.abs(rig.bounds.halfW - Math.max(Math.abs(box.min.x), Math.abs(box.max.x))) < 1e-6,
    'bounds.halfW 应等于实际横向半宽'
  );
});

test('包围盒中心落在 root 原点上', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 2 });
  const centerY = (rig.bounds.top + rig.bounds.bottom) / 2;
  assert.ok(Math.abs(centerY) < 1e-3, `中心应在 y=0，实得 ${centerY}`);
});

test('parts 的 off 是装配偏移之外的拆解位移', () => {
  const rig = buildObjRig(MINI_OBJ, {
    size: 2,
    layers: ['shell', 'core'],
    explode: { shell: [0, 1, 0], core: [0, 0, 0] },
  });
  assert.deepEqual(rig.parts.find((p) => p.name === 'shell').off.toArray(), [0, 1, 0]);
  assert.deepEqual(rig.parts.find((p) => p.name === 'core').off.toArray(), [0, 0, 0]);
});

test('每个可动层有自己的 Group —— 不会牵动原始装配', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 2, layers: ['shell'] });
  const layer = rig.parts[0].g;
  assert.equal(layer.type, 'Group');
  assert.equal(layer.name, 'shell');
  // 层是 root 的直接子对象，装配是层的子对象
  assert.equal(layer.parent, rig.root);
});

test('材质被统一成 MeshStandardMaterial', () => {
  const rig = buildObjRig(MINI_OBJ, { size: 2 });
  let checked = 0;
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    assert.ok(o.material.isMeshStandardMaterial, `${o.name} 应为标准材质`);
    checked++;
  });
  assert.ok(checked > 0);
});

test('材质覆写生效', () => {
  const rig = buildObjRig(MINI_OBJ, {
    size: 2,
    materials: { shell: { color: 0xff0000, roughness: 0.9, metalness: 0.1 } },
  });
  const m = rig.mat.shell;
  assert.equal(m.color.getHex(), 0xff0000);
  assert.ok(Math.abs(m.roughness - 0.9) < 1e-6);
});

test('up: "z" 的模型会先摆正再量包围盒', () => {
  // 同一个模型，up 不同 => 归一化后的竖直尺寸不同
  const y = buildObjRig(MINI_OBJ, { size: 2, up: 'y' });
  const z = buildObjRig(MINI_OBJ, { size: 2, up: 'z' });
  assert.notEqual(y.bounds.top, z.bounds.top);
});

test('GLTF/GLB 明确报错而不是静默失败', () => {
  assert.throws(
    () => buildObjRig('{}', { format: 'glb' }),
    /GLTF\/GLB/,
    '应当抛出可读的错误'
  );
});

test('demo.obj 能被解析出四个装配', async () => {
  const text = await readFile(OBJ, 'utf8');
  const rig = buildObjRig(text, { size: 2 });
  assert.deepEqual(rig.meta.assemblies, ['base', 'housing', 'cap', 'core']);
  assert.ok(rig.bounds.top - rig.bounds.bottom > 1.5, 'demo 模型高度应大于 1.5');
});