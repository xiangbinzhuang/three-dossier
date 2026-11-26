---
name: three-dossier
description: 把一件真实产品做成可交互的 3D 技术档案页——素纸转台、三档显示模式、爆炸拆解、投影标注、纸面/暗场双主题、桌面与手机两套排版，最后打包成单个 HTML。要做「产品规格页」「技术档案」「可拆解展示页」「线上产品手册」时用这个。也用于给已有的档案页换产品、换版式、排查渲染问题。
---

# 3D 技术档案页

**一句话**：一个产品，转到哪一面都能看清，拆开来能一层层数，手机上单手能操作，最后是一个 HTML 文件。

## §0 先判断是不是这个技能

| 你要的东西 | 用这个 | 不用这个 |
|---|---|---|
| 一张静态产品图 / 爆炸图 | 不用，出图就行 | ✓ |
| 一段产品宣传视频 | 视频技能 | ✓ |
| **能自己转、能拆、带标注的网页** | **本技能** | |
| 只是想看某个 three.js 效果怎么实现 | 读 `src/kit/` 对应模块 | |

判据很简单：成品需不需要**用户自己动**。需要就用这个，不需要就别过度工程。

## §1 三层结构，别混着改

```
src/kit/                引擎。不认识任何产品。
src/products/<产品>/     插槽。config.js（行为）+ rig.js（几何）
src/app/                装配。main.js 接线 + index.html 骨架 + dossier.css 版式
```

改渲染行为 → `kit/`。改这个产品的视角/标注/拆解 → `products/`。
改文案和排版 → `app/`。

**换产品时 kit 一行都不该动。**如果发现必须改 kit 才能接新产品，说明契约缺字段，
补 `docs/契约.md` 和 kit，而不是在产品层写特例。

## §2 接一个新产品的顺序

**路线 A：代码搭几何**（和产品无关时）

1. `cp -r src/products/sample src/products/<name>`
2. `rig.js`：`createRig()` 返回 `{ root, bounds, parts, joints, mat }`。
   `bounds` 要**量出来**（`new THREE.Box3().setFromObject(root)`），不是估的。
3. `config.js`：`views` 四档机位、`callouts` 五条（先少写几条跑通再加）、
   `explode.slideOffsets`、`hud.layers`。
4. `npm run build -- --product <name>`，双击产物，逐个按钮点一遍。

**路线 B：拿模型文件**（有 CAD / 3D 导出时，推荐）

1. `cp -r src/products/obj-demo src/products/<name>`，把模型换成自己的
2. `rig.js` 里改 `buildObjRig(modelText, {...})` 的参数：
   `layers`（哪些 `o`/`g` 分组参与拆解）、`explode`（每层往哪推多远）、
   `materials`（颜色/粗糙度/金属度）、`height`（归一化目标高度）、`up`（模型的上轴）
3. `config.js` 按模型改 `callouts` 的 `anchor.name`（要用模型里的分组名）和 `views`
4. `npm run build -- --product <name>`，双击产物，逐个按钮点一遍

**两条路线都不用改 `src/app/main.js`** —— 它里面写的是占位路径
`../products/slot/config.js`，构建时重定向到选中的槽。改源码会产生与产品
无关的 diff，而且未选中的产品模块进不了 bundle（产物白白变大）。

模型文件在**构建期内联**进产物，运行时零网络请求。但 MTL 引用的**贴图不会内联** ——
用到贴图就在 `materials` 里直接给材质参数。

`index.html` 里的文案（型号、规格、面板标题）是设计出来的版式，逐字改那一段 HTML。
不要把文案搬进 config 用 JS 拼字符串。

`src/products/sample/` 只是个通用占位产品（基本体拼的立柱 + 滑环 + 同轴模块），
拿来跑通流程没问题；上真产品时整个目录换掉。

## §3 验收门禁

**截图对比法**，别靠肉眼说「差不多」：

```python
# 每换一个状态就重开页面 —— 状态会互相污染，连续切模式对比出来的是假差异
DOSSIER.pause(); DOSSIER.seek(0); DOSSIER.settle()
DOSSIER.setMode('clay'); DOSSIER.settle()
pg.screenshot(...)
```

判据：改动前后同状态截图的 **平均绝对误差 ≤ 1.0**（抗锯齿和贴图动画的噪声级别）。
> 3 就是画面真的变了。

必须过的五态：`hero / clay / xray / dark / explode`。
再加手机四档：`360×780 / 390×844 / 430×932 / 844×390`，每档看三条：

- `document.documentElement.scrollWidth === window.innerWidth`（无横向溢出）
- 每颗按钮的 `.tx`：`scrollWidth <= clientWidth`（标签没被截断）
- 同一行按钮宽度一致

**判截断不能读按钮**：`.tx` 在里层被裁，按钮自己的 `scrollWidth` 永远不溢出。

手机上还有三条交互门禁（都是「看着能用、实际是死区」的坑）：

- 双指张开 ⇒ `dist` 变小并停在 `zoomLimit()` 的上下限之内
- 双指平移（间距不变）⇒ `dist` **一点都不变**
- 双指松回单指再拖 ⇒ `goal.yaw` 连续，不许跳

转台会一直转，所以标注锚点要在**每一个转角**都验一遍：
产品左右各有一层同名零件时，标注必须跟着「当前朝向观众的那一层」走。
判据：把 `t` 从 0 扫到 12 s（一个整圈），每一步比对
「标注当前挂的那一层」和「法线朝向相机的那一层」是否一致。

## §4 最容易踩的几个坑

全文见 `docs/坑.md`，这里是最高频的：

1. **边线必须是 mesh 的子对象**。预烘成静态几何挂在转台下，一拆解就是两套错位轮廓。
2. **关实体用 layers，不用 `visible=false`**。后者会让整棵子树（含边线）一起消失。
3. **`1fr` 是 `minmax(auto,1fr)`**，不是等宽。要等宽写 `minmax(0,1fr)`。
4. **`viewport-fit=cover` 漏了，`env(safe-area-inset-*)` 恒为 0**，底部安全区白写。
5. **esbuild 打包时 `$` 和 `$$` 会撞名**，`$('#gl')` 拿到数组，报错信息还指向别处。
6. **手机上的双指缩放要自己写**，`touch-action:none` 还得写在根上 ——
   只写 canvas 的话，一根手指落在 dock 上就变成整页缩放（退不回去）。

## §5 调试钩子

`window.DOSSIER`（名字由 `config.qaGlobal` 定，默认就是 `DOSSIER`）：
`seek(t) / pause() / play() / setMode() / setEnv() / setExplode() / setLabels() / setView() / settle()`

`settle()` 是截图的前提：无头浏览器只有十几帧，靠插值到位要等好几秒，
不贴住截到的是半路状态。

## §6 产物

`examples/<产品>/dossier.html`，780 KB 左右（gzip 205 KB），双击即开。
交付前跑一遍：

```bash
npm run build
node -e "const s=require('fs').statSync('examples/sample/dossier.html');console.log((s.size/1024|0)+' KB')"
```

体积突增通常是 three 被打了两遍（检查是否有人在代码里又 import 了一份 CDN 版本）。

产物末尾带着本项目与 three.js 的完整 MIT 声明（HTML 注释），随包分发时必须保留。
</content>