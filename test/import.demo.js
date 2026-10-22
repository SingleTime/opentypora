// 生成 docs/opentypora-import.png：把 docx 转换结果直接载入编辑器截图
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__import_demo.html');
const { sampleDocx } = require('./fixtures.js');

const DOCX_B64 = Buffer.from(sampleDocx()).toString('base64');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
  saveImage: function () { return Promise.resolve('assets/x.png'); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); }
};
</script>`;

const TEST = String.raw`
(function () {
  var DOCX = document.getElementById('__docx').textContent;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  (async function () {
    await sleep(500);
    var r = await window.Importer.convert('docx', DOCX, { assetDir: 'assets/样本-media/' });
    // 演示图里不放真图（样本里的 PNG 是占位字节），把图片行去掉
    var md = r.markdown.split('\n').filter(function (l) { return l.indexOf('![') !== 0; }).join('\n');
    Editor.load(md, null, '产品需求.docx → 产品需求.md');
    window.__report = 'DEMO ok';
  })();
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('<body>', function () {
  return '<body>\n<script id="__docx" type="text/plain">' + DOCX_B64 + '</script>';
});
html = html.replace('</body>', function () { return MOCK + '\n<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
