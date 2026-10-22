// 生成 [TOC] / 脚注 / 锚点的展示截图（无断言）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__doc_demo.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); }
};
</script>
`;

const DOC = [
  '[TOC]',
  '',
  '# 文档结构',
  '',
  '一个 `[TOC]` 独占一行，就会在这里长成整篇的目录；标题变化时它自己跟着变。',
  '',
  '## 标题锚点',
  '',
  '每个标题都会拿到一个 GitHub 风格的 id，中文原样保留，同名自动加 `-1`。',
  '',
  '## 内部跳转',
  '',
  '像这样：[跳到脚注](#fn-def-note) 或 [回到文档结构](#文档结构)。',
  '',
  '# 脚注',
  '',
  '正文里的角标按出现顺序自动编号[^note]，跟作者写的标号无关[^second]。',
  '',
  '脚注定义可以带行内格式，比如 **加粗** 与 `代码`。',
  '',
  '[^second]: 第二条脚注',
  '',
  '[^note]: 第一条脚注，定义写在正文后面'
].join('\n');

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  window.addEventListener('load', async function () {
    try { localStorage.clear(); } catch (e) {}
    await sleep(500);
    Editor.load(${JSON.stringify(DOC)}, null, '结构示例.md');
    await sleep(600);
    var sc = document.getElementById('editor-scroll');
    if (sc) sc.scrollTop = 0;
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
