// HTML 块演示页：无参数出「渲染态」，带 edit 参数出「点进去看源码」态
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MODE = process.argv[2] === 'edit' ? 'edit' : 'render';
const OUT = path.join(ROOT, 'app', '__html_demo' + (MODE === 'edit' ? '_src' : '') + '.html');
const PIC = '/tmp/opentypora-img/pic.png';

const DOC = [
  '# HTML 块',
  '',
  '直接写 HTML，就按 HTML 渲染 —— 和 Typora 一样。点一下整块可以看回源码。',
  '',
  '<div style="padding:12px 16px;border-left:4px solid #d1242f;background:#fff5f5;border-radius:6px">',
  '<strong>提示：</strong>这段是手写的 <code>&lt;div&gt;</code>，样式全部来自行内 style。',
  '</div>',
  '',
  '<div align="center">',
  '<img src="' + PIC + '" width="220">',
  '<div style="color:#6e7781;font-size:13px">居中的图注（align="center" + width 属性）</div>',
  '</div>',
  '',
  '<details>',
  '<summary>点开看详情（原生 details / summary）</summary>',
  '',
  '里面可以有整段文字，也可以有空行 —— 这些都在同一个 HTML 块里，不会被空行切开。',
  '</details>',
  '',
  '<table border="1" cellpadding="6" style="border-collapse:collapse">',
  '<tr><th>标签</th><th>用途</th></tr>',
  '<tr><td>div</td><td>块级容器，可跨空行</td></tr>',
  '<tr><td>details</td><td>折叠面板，原生交互</td></tr>',
  '</table>',
  '',
  '后面继续是普通 Markdown —— 未闭合的 HTML 不会把后文吞掉。',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__h.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__h.md' }); },
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

const BODY = `setTimeout(function () {
  Editor.load(${JSON.stringify(DOC)}, '/tmp/html-demo.md', 'html-demo.md');
  ${MODE === 'edit' ? `
  setTimeout(function () {
    // 点第一个 HTML 块，切到源码态
    var el = document.querySelector('#editor .blk.html .html-body > div');
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8
    }));
    setTimeout(function () {
      window.__report = 'EDIT 源码态=' + !!document.querySelector('#editor textarea.src');
    }, 200);
  }, 700);` : `
  setTimeout(function () {
    window.__report = 'HTML 块=' + document.querySelectorAll('#editor .blk.html').length +
      ' / details=' + !!document.querySelector('#editor details') +
      ' / 表格=' + document.querySelectorAll('#editor .html-body table').length +
      ' / 图片加载=' + (function () {
        var im = document.querySelector('#editor .html-body img');
        return !!im && im.complete && im.naturalWidth > 0;
      })();
  }, 700);`}
}, 500);`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + BODY + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
