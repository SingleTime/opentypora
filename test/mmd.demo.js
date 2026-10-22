// 生成 Mermaid 图表的展示截图（无断言）
// 用法: node test/mmd.demo.js [night]  → app/__mmd_demo[_night].html
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const THEME = process.argv[2] || 'github';
const OUT = path.join(ROOT, 'app', '__mmd_demo' + (THEME === 'night' ? '_night' : '') + '.html');

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
  '# 图表',
  '',
  '写一个 `mermaid` 代码块，就会直接长成图；点进块里还是原来的源码。',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[写 Markdown] --> B{是 mermaid 块？}',
  '  B -->|是| C[渲染成 SVG]',
  '  B -->|否| D[普通代码高亮]',
  '  C --> E[继续写]',
  '```',
  '',
  '## 时序图',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  participant U as 作者',
  '  participant E as 编辑器',
  '  U->>E: 输入 ```mermaid',
  '  E->>E: 懒加载 mermaid.min.js',
  '  E-->>U: 画好 SVG',
  '```',
  '',
  '## 语法错误不会炸',
  '',
  '```mermaid',
  'flowchart TD',
  '  X --> ',
  '```',
  ''
].join('\n');

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  window.addEventListener('load', async function () {
    try { localStorage.clear(); } catch (e) {}
    await sleep(400);
    Editor.setTheme(${JSON.stringify(THEME)});
    Editor.load(${JSON.stringify(DOC)}, null, '图表示例.md');
    await sleep(2500);
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
console.log('demo →', path.relative(ROOT, OUT));
