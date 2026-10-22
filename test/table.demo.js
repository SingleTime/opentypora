// 表格编辑演示页：默认展示「手柄」，URL 带 #menu 时展示右键菜单
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MENU = process.argv[2] === 'menu';
const OUT = path.join(ROOT, 'app', MENU ? '__table_menu.html' : '__table_demo.html');

const DOC = [
  '# 表格结构编辑',
  '',
  '不用切到源码，直接在渲染出来的表格上增删行列、改列对齐。',
  '',
  '## 订单明细',
  '',
  '| 商品 | 单价 | 数量 | 小计 |',
  '|:-----|-----:|-----:|-----:|',
  '| 机械键盘 | 899 | 1 | 899 |',
  '| 显示器 | 2499 | 2 | 4998 |',
  '| 鼠标 | 299 | 3 | 897 |',
  '',
  '鼠标移到单元格上，左侧出现「+」插入行、顶部出现「+」插入列；右键有完整菜单。',
  '',
  '## 说明',
  '',
  '表格改动会直接写回 Markdown 源码，并且和正文共用同一套撤销栈。',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__t.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__t.md' }); },
  saveImage: function () { return Promise.resolve('assets/x.png'); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  exportHTML: function () { return Promise.resolve({ path: '/tmp/x.html' }); },
  exportPDF: function () { return Promise.resolve({ path: '/tmp/x.pdf' }); },
  exportFile: function () { return Promise.resolve({ path: '/tmp/x.bin' }); },
  readBinary: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: '' }); }
};
</script>`;

const BODY = String.raw`
(function () {
  var DOC = JSON.parse(document.getElementById('__doc').textContent);
  setTimeout(function () {
    Editor.load(DOC, '/tmp/table-demo.md', 'table-demo.md');
    setTimeout(function () {
      var td = document.querySelector('#editor td[data-r="1"][data-c="1"]');
      if (!td) return;
      var r = td.getBoundingClientRect();
      td.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: r.left + 8, clientY: r.top + 8
      }));
      if (__MENU__) {
        td.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: Math.round(r.left + 40), clientY: Math.round(r.bottom - 6)
        }));
      }
      window.__report = 'DEMO ' + (__MENU__ ? 'menu' : 'handles');
    }, 420);
  }, 500);
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
const bodySrc = 'var __MENU__ = ' + MENU + ';\n' + BODY;
html = html.replace('</body>', function () { return '<script>\n' + bodySrc + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
