#!/usr/bin/env node
/**
 * 把 src/ 打成一个**自包含 HTML**：three.js、CSS、JS 全部内联，file:// 双击就能开。
 *
 * 为什么用 esbuild 而不是手写拼接：three 的构建产物是 ESM（core + module 两三个文件，
 * 彼此 import/re-export）。手写正则把它们包成 IIFE 也能跑，但那是**自己实现打包器** ——
 * 每次 three 升版都要重新验证一遍，而且没法 minify（产物 2.2 MB）。
 *
 * 产物结构：
 *   <style>  全部 CSS
 *   <script> three + 应用代码（一个 IIFE）
 *   <!-- 第三方许可声明 -->
 *
 * 用法：
 *   node tools/build.mjs                 压缩 + 输出 examples/sample/dossier.html
 *   node tools/build.mjs --no-min        不压缩（调试用，报错行号可读）
 *   node tools/build.mjs --sourcemap     追加内联 sourcemap（调试用，产物会变大）
 *   node tools/build.mjs --watch         监听改文件重建（配合任意静态服务器预览）
 *   node tools/build.mjs --out path.html 指定输出
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const MIN = !has('--no-min');
const OUT = resolve(ROOT, argOf('--out', 'examples/sample/dossier.html'));

/** 打包 JS（three 走 npm 依赖，esbuild 自己解析） */
async function bundleJs() {
  const res = await build({
    entryPoints: [join(ROOT, 'src/app/main.js')],
    bundle: true,
    format: 'iife',            // 单文件里不能有 ESM 顶层 import
    target: ['es2020'],
    minify: MIN,
    sourcemap: has('--sourcemap') ? 'inline' : false,
    /* 保留依赖里的许可声明（three 的 @license 横幅），追加到 bundle 末尾。
       产物是自包含单文件，随包分发时必须带着 third-party 的版权声明。 */
    legalComments: 'eof',
    write: false,
    logLevel: 'warning',
  });
  return res.outputFiles[0].text;
}

/** 读取第三方依赖的许可全文，作为 HTML 注释注入产物 */
async function thirdPartyNotices() {
  const files = [
    ['three.js', join(ROOT, 'node_modules/three/LICENSE')],
  ];
  const parts = [];
  for (const [name, p] of files) {
    let text;
    try {
      text = await readFile(p, 'utf8');
    } catch {
      continue;               // 依赖没装就跳过，不阻塞构建
    }
    parts.push(`${name}\n${text.trim()}`);
  }
  if (!parts.length) return '';
  return '\n<!--\n' + parts.join('\n\n') + '\n-->\n';
}

/** 本项目自己的许可声明（产物是本代码的实质副本，必须带着） */
async function projectNotice() {
  try {
    const text = await readFile(join(ROOT, 'LICENSE'), 'utf8');
    return `\n<!--\n${text.trim()}\n-->\n`;
  } catch {
    return '';
  }
}

async function run() {
  const [js, css, html, notices, own] = await Promise.all([
    bundleJs(),
    readFile(join(ROOT, 'src/app/dossier.css'), 'utf8'),
    readFile(join(ROOT, 'src/app/index.html'), 'utf8'),
    thirdPartyNotices(),
    projectNotice(),
  ]);

  // `</script` 必须转义：JS 里任何字符串只要含有它就提前结束 script 标签
  const safeJs = js.replace(/<\/script/gi, '<\\/script');

  let out = html;
  /* 替换串必须用**函数**形式，不能用字符串。
     String.prototype.replace 会把替换串里的 $& / $` / $' / $$ 当成模式：
     压缩后的 JS 里只要出现一次 `$'`，整个文档尾部的 HTML 就会被注进 <script> 里，
     script 提前结束，剩下的代码被当成 HTML 解析 —— 表现是
     「Unexpected token '<'」外加一堆「<circle> attribute r: Expected length, \"${d}\"」。
     用函数返回就没有任何模式解释。 */
  const linkTag = '<link rel="stylesheet" href="./dossier.css">';
  if (!out.includes(linkTag)) throw new Error('index.html 里找不到 css 占位 <link>');
  out = out.replace(linkTag, () => `<style>\n${css}\n</style>`);

  const scriptTag = '<script type="module" src="main.js"></script>';
  if (!out.includes(scriptTag)) throw new Error('index.html 里找不到 js 占位 <script>');
  out = out.replace(scriptTag, () => `<script>\n${safeJs}\n</script>`);

  /* 许可声明挂在 </body> 之前，作为 HTML 注释 —— 自包含产物随包分发时
     必须带着本项目与 three.js 的版权与许可全文。 */
  if (own || notices) out = out.replace('</body>', () => `${own}${notices}</body>`);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out, 'utf8');
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`built ${OUT.replace(ROOT + '/', '')}  ${kb} KB${MIN ? '' : '  (unminified)'}`);
}

await run();

if (has('--watch')) {
  console.log('watching src/ …');
  let timer = null;
  watch(join(ROOT, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => run().catch((e) => console.error(e.message)), 120);
  });
}
