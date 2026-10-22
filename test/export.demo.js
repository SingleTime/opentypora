// 生成「导出菜单」演示页：加载一篇有图有表的文档，然后点开导出菜单保持不关，
// 供 build/shot 截图（docs/opentypora-export.png）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__export_demo.html');

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
  exportHTML: function () { return Promise.resolve({ path: '/tmp/x.html' }); },
  exportPDF: function () { return Promise.resolve({ path: '/tmp/x.pdf' }); },
  exportFile: function (n) { return Promise.resolve({ path: '/tmp/' + n }); },
  readBinary: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); }
};
</script>
`;

const DOC = [
  '# 导出与格式转换',
  '',
  '内置导出**不依赖 pandoc**：docx 与 epub 都是 zip 包，直接在本包内生成。',
  '',
  '## 支持范围',
  '',
  '| 格式 | 说明 |',
  '|:---|:---|',
  '| Word | 标题样式、表格、脚注、图片 |',
  '| ePub | 目录、脚注锚点、图片 |',
  '| LaTeX | ctexart，XeLaTeX 编译 |',
  '',
  '脚注也被保留[^1]，[TOC] 会变成真正的目录。',
  '',
  '[^1]: 导出时按首次引用顺序编号。',
  ''
].join('\n');

const TEST = `
<script>
(function () {
  window.addEventListener('load', function () {
    setTimeout(function () {
      Editor.load(${JSON.stringify(DOC)}, null, '导出与格式转换.md');
      setTimeout(function () {
        document.getElementById('tb-export').click();
      }, 260);
    }, 300);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
