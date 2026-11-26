/**
 * 测试入口。
 *
 * 为什么不用 `node --test test/` 或 `node --test test/*.test.js`：
 *   · Node 18 的 `--test` 把 `test/` 当**目录**递归扫描（能发现测试）
 *   · Node 24 的 `--test` 把 `test/` 当**模块路径**（报 MODULE_NOT_FOUND）
 *   · glob 写法 `test/*.test.js` 在 Node 18 里不被 `--test` 展开（它要的是
 *     字面路径），在 Node 24 里又依赖 shell 展开 —— 到了 Windows 的 cmd
 *     上两边都不成立
 *
 * 所以这里用最朴素、也最没歧义的办法：把每个测试文件 import 进来。
 * import 的副作用就是执行 —— `node:test` 会自动注册并运行它们。
 */
import './objrig.test.js';
import './make-slot.test.js';
