# 参与贡献

感谢参与。这个仓库很小，流程也尽量简单 —— 但有几条约定请先看一眼，能省掉来回返工。

## 环境

```bash
npm install
npm run build
npm test
open examples/sample/dossier.html
```

Node ≥ 18。构建只依赖 `three` 与 `esbuild`，产物本身零运行时依赖。
测试用 Node 内置的 test runner，不需要装任何东西。

## 分支与提交

- 一个改动一个提交，提交信息写清楚「改了什么」而不是「改完了」。
- 不要直接改 `examples/sample/dossier.html` —— 它是构建产物。
  改 `src/`，然后 `npm run build` 重新生成，两次必须一起提交。
- `examples/sample/dossier.dev.html` 是开发期产物，已被 `.gitignore` 忽略，不要提交。

## 三层结构

```
src/kit/                引擎。不认识任何产品。
src/products/<产品>/     插槽。config.js（行为）+ rig.js（几何）
src/app/                装配。main.js 接线 + index.html 骨架 + dossier.css 版式
```

**换产品时 kit 一行都不该动。** 如果发现必须改 kit 才能接新产品，说明
[docs/契约.md](docs/契约.md) 缺字段 —— 补契约和 kit，而不是在产品层写特例。

产品层的完整字段说明在 [docs/契约.md](docs/契约.md)，接第一个产品前先读那一页。

**产品槽用构建参数选，不改源码。** `main.js` 里写的是占位路径
`../products/slot/config.js`，构建时重定向到选中的槽：

```bash
npm run build -- --product obj-demo
npm run build -- --product obj-demo --out examples/my-product/dossier.html
```

新增产品只要建 `src/products/<name>/` 目录，不用改 `main.js`、不用登记。

**用模型文件（OBJ）时**：模型必须按部件分组（`o` / `g`），
否则爆炸图没有层可拆。构建期会把模型内联进产物，运行时零网络请求 ——
但 MTL 引用的**贴图不会被内联**（会被浏览器去 fetch），用到贴图请在 `config` 的
`materials` 里直接给材质参数。没有 MTL 时 `usemtl` 引用只会得到白色材质，不发请求。

新槽用生成器起手，别手抄：

```bash
npm run make-slot -- path/to/model.obj slot-name
npm run build -- --product slot-name --out examples/slot-name/dossier.html
```

生成器会算好拆解方向、行程和标注锚点，你只改配色和文案。
手写也行 —— `src/products/obj-demo/` 就是手写的例子，但注意标注是按
**模型的分组名**索引的，分组名对不上时标注会**静默消失**（不报错、只是看不见）。

## 提交前的验收

```bash
npm test
npm run build
```

然后至少走一遍：

- 四个机位预设、三种显示模式、拆解/收拢、标注开关、纸面/暗场
- 桌面（1440×900）与手机（390×844、360×780）各看一遍
- 控制台无报错，Network 面板**零外部请求**

改了标注锚点或层法线的，还要把时间扫一个整圈（`DOSSIER.seek(t)`，`t` 从 0 到 12），
确认标注始终跟着朝向观众的那一层走 —— 原因见 [docs/坑.md](docs/坑.md) 第 14 条。

## 代码风格

- 与现有代码一致：2 空格缩进，单引号，分号。
- 注释解释**为什么**，不解释「这行在做什么」。踩过的坑写成一条注释，
  并在 [docs/坑.md](docs/坑.md) 里补一条正文 —— 排查成本都在小时级以上。
- 不要提交调试用的 `console.log`、注释掉的代码块、临时脚本。

## 许可

贡献的代码以 MIT 发布，见 [LICENSE](LICENSE)。
提交即表示你同意以该许可发布你的改动。
</content>