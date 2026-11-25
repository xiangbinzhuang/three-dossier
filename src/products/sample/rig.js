import * as THREE from 'three';

/**
 * Sample —— 通用占位产品。
 *
 * 一台抽象的直线工作台：底座 + 立柱 + 滑环 + 横梁 + 两枚枢轴球，左右各一组
 * 「外壳 → 内核 → 端盖」的同轴模块。左右关于 x = 0 镜像、前后关于 z = 0 对称 ——
 * 转台转起来不会歪。
 *
 * 这里存在的意义不是「像某个产品」，而是给 kit 一个能跑的产品：每种锚点类型
 * （root / part / parts / joints）、每层拆解、每种显示模式都有东西可指。
 * 换真产品时整个文件换掉即可。
 *
 * 只用基本体，没有贴图、专有造型或任何产品数据。
 */

export function createRig() {
  const rig = new THREE.Group();
  rig.name = 'product';
  const parts = [];
  const joints = [];

  const mat = {
    body: new THREE.MeshStandardMaterial({ color: 0xd7d3cb, roughness: 0.46, metalness: 0.32 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2d3239, roughness: 0.28, metalness: 0.78 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.19, metalness: 0.94 }),
    core: new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.72, metalness: 0.12 }),
    /* 壳体是开口管，双面渲染才看得见管内 —— 内核就装在管里。 */
    shell: new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.58, metalness: 0.16, side: THREE.DoubleSide }),
  };

  const M = (geo, material) => new THREE.Mesh(geo, material);
  /* 圆柱默认沿 y，转成沿 x 只需绕 z 转 90°。open = true 时两端不封口，
     是一根开口管 —— 从侧面能看进管内。 */
  const tubeX = (r, len, seg = 64, open = false) =>
    new THREE.CylinderGeometry(r, r, len, seg, 1, open).rotateZ(Math.PI / 2);

  /**
   * 零件层。g 的原点固定在 root 原点，mesh 自带装配位置；
   * off 是**拆解位移**（不是装配偏移）—— 拆解时 g 被整体推到 off × exK。
   */
  function part(name, off, meshes) {
    const g = new THREE.Group();
    g.name = name;
    rig.add(g);
    for (const m of meshes) g.add(m);
    parts.push({ name, g, off: new THREE.Vector3(...off) });
    return g;
  }

  /* ── 尺寸 ────────────────────────────────────────────────────────────── */
  const BASE_R = 0.72, BASE_H = 0.09, BASE_Y = -0.86;
  const SHAFT_R = 0.10, SHAFT_L = 1.42, SHAFT_Y = -0.15;   // 立柱：整根不参与拆解
  const SLEEVE_R = 0.16, SLEEVE_H = 0.36, SLEEVE_Y = 0.16; // 套在立柱上的滑环
  const BAR_R = 0.10, BAR_L = 1.10, BAR_Y = 0.46;         // 横梁
  const JOINT_R = 0.15, JOINT_X = 0.42;                  // 梁两端的枢轴球
  const MOD_X = 0.74;                                    // 模块中心离中轴的距离
  const CORE_R = 0.19, CORE_L = 0.22;                    // 内核：封闭在外壳里
  const HOUSE_R = 0.26, HOUSE_L = 0.34;                  // 外壳：开口管，套住内核
  const CAP_R = 0.21, CAP_L = 0.06;                      // 端盖：压在外壳外端

  /* 拆解行程：off 是「满拆时该层沿 x 走多远」，实际位移 = off × exK（0.68）。
     两端同时拆：端盖飞得最远、外壳次之，内核留在原地 —— 读起来就是
     「拔掉端盖、抽出外壳、露出内核」这一串动作。
     滑环不走 off（off 为零），它的位移在 config.explode.slideOffsets 里给。 */
  const PUSH_HOUSE = 0.85, PUSH_CAP = 1.35;

  /* ── 底座 / 立柱 / 横梁：不参与拆解，始终留在原位 ───────────────────── */
  const base = M(new THREE.CylinderGeometry(BASE_R, BASE_R * 0.94, BASE_H, 96), mat.dark);
  base.position.y = BASE_Y;
  rig.add(base);

  const shaft = M(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, SHAFT_L, 48), mat.metal);
  shaft.position.y = SHAFT_Y;
  rig.add(shaft);
  const bar = M(tubeX(BAR_R, BAR_L, 48), mat.body);
  bar.position.y = BAR_Y;
  rig.add(bar);

  /* ── 枢轴：挂在 root 下，标注按「离相机近的那颗」挑 ─────────────────── */
  for (const s of [-1, 1]) {
    const j = new THREE.Group();
    j.name = 'pivot_' + s;
    j.position.set(s * JOINT_X, BAR_Y, 0);
    j.add(M(new THREE.SphereGeometry(JOINT_R, 32, 20), mat.metal));
    rig.add(j);
    joints.push(j);
  }

  /* ── 外壳 / 内核 / 端盖：左右各一组，沿 x 轴同轴串起来 ─────────────── */
  for (const s of [-1, 1]) {
    /* 外壳是开口管：内核装在里面，装配态看不见，外壳滑开之后才露出来。 */
    const house = M(tubeX(HOUSE_R, HOUSE_L, 64, true), mat.shell);
    house.position.set(s * MOD_X, BAR_Y, 0);
    part('housing_' + s, [s * PUSH_HOUSE, 0, 0], [house]);

    const core = M(new THREE.CylinderGeometry(CORE_R, CORE_R, CORE_L, 48).rotateZ(Math.PI / 2), mat.core);
    core.position.set(s * MOD_X, BAR_Y, 0);
    part('core_' + s, [0, 0, 0], [core]);

    const cap = M(tubeX(CAP_R, CAP_L, 48), mat.dark);
    cap.position.set(s * (MOD_X + HOUSE_L / 2 + CAP_L / 2), BAR_Y, 0);
    part('cap_' + s, [s * PUSH_CAP, 0, 0], [cap]);
  }

  /* ── 滑环：套在立柱上，不整体外推，靠 config.explode.slideOffsets 沿 −y 滑开 ── */
  const sleeve = M(new THREE.CylinderGeometry(SLEEVE_R, SLEEVE_R, SLEEVE_H, 48), mat.body);
  sleeve.position.y = SLEEVE_Y;
  part('sleeve_1', [0, 0, 0], [sleeve]);

  /* ── 阴影与包围盒 ───────────────────────────────────────────────────── */
  rig.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  rig.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rig);
  const bounds = {
    halfW: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    top: box.max.y,
    bottom: box.min.y,
  };

  return { root: rig, mat, parts, joints, bounds };
}
