// 导入功能在真实 WKWebView 里的集成测试（build/shot 跑）
// 重点验证 Node 测不到的两件事：DecompressionStream('deflate-raw') 在 WebKit 里可用、
// base64 → Uint8Array → 解压 → 转换 整条链路在浏览器引擎里也是对的；顺带跑一遍 UI 入口。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__import_harness.html');
const { sampleDocx } = require('./fixtures.js');

const DOCX_B64 = Buffer.from(sampleDocx()).toString('base64');
const HTML = '<html><head><meta charset="utf-8"><title>网页标题</title></head><body>' +
  '<h1>网页大标题</h1><p>正文 <strong>粗</strong> 与 <em>斜</em></p>' +
  '<ul><li>甲</li><li>乙</li></ul><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>' +
  '<img src="pic.png" width="120" height="60"></body></html>';
const HTML_B64 = Buffer.from(HTML, 'utf8').toString('base64');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function (p) { window.__setFile = p; return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__i.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__i.md' }); },
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
  translate: function () { return Promise.resolve({ text: '' }); },
  importFile: function () { return Promise.resolve(window.__SRC); },
  saveImport: function (name, content, assets) {
    window.__SAVED = { name: name, content: content, assets: assets };
    return Promise.resolve({ path: '/tmp/导入样本.md' });
  }
};
</script>`;

const TEST = String.raw`
(function () {
  var pass = 0, fail = 0, bad = [];
  function ok(c, m) { if (c) pass++; else { fail++; bad.push(m); } }
  function eq(a, b, m) { ok(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var DOCX = document.getElementById('__docx').textContent;
  var HTMLB64 = document.getElementById('__html').textContent;

  (async function () {
    try {
      ok(typeof window.Importer === 'object', 'Importer 脚本已加载');

      /* ---------- 引擎能力 ---------- */
      eq(typeof DecompressionStream, 'function', 'WebKit 支持 DecompressionStream');
      if (typeof DecompressionStream === 'function') {
        var okRaw = false;
        try { new DecompressionStream('deflate-raw'); okRaw = true; } catch (e) {}
        ok(okRaw, "支持 'deflate-raw'（docx 里的 deflate 靠它）");
      }

      /* ---------- docx 直接转换 ---------- */
      var r = await window.Importer.convert('docx', DOCX, { assetDir: 'assets/样本-media/' });
      ok(r.markdown.indexOf('# 第一章 标题') === 0, 'docx 首行是标题：' + r.markdown.slice(0, 30));
      ok(r.markdown.indexOf('- 无序一\n- 无序二\n  - 无序二·嵌套') > 0, '列表结构正确');
      ok(r.markdown.indexOf('[示例站点](https://example.com/a?b=1)') > 0, '超链接正确');
      ok(r.markdown.indexOf('[^1]: 这是脚注正文') > 0, '脚注定义正确');
      eq(r.assets.length, 1, '图片资源数量');
      eq(r.assets[0].path, 'assets/样本-media/image1.png', '图片相对路径');
      ok(r.assets[0].base64.length > 8, '图片 base64 非空');
      ok(r.markdown.indexOf('=200x100') > 0, '图片尺寸按 extent 换算');

      /* ---------- html 直接转换 ---------- */
      var h = await window.Importer.convert('html', HTMLB64, {});
      ok(h.markdown.indexOf('# 网页大标题') === 0, 'html 标题转换');
      ok(h.markdown.indexOf('**粗**') > 0 && h.markdown.indexOf('*斜*') > 0, 'html 行内样式');
      ok(h.markdown.indexOf('![', 0) > 0 && h.markdown.indexOf('=120x60') > 0, 'html 图片带尺寸');
      eq(h.title, '网页标题', '取到 <title>');
      eq(h.assets.length, 0, 'html 不产生内嵌资源');

      /* ---------- UI 入口：带图片的 docx ---------- */
      window.__SRC = { path: '/tmp/样本.docx', name: '样本.docx', ext: 'docx', base64: DOCX };
      window.OpenTyporaCmd.importFile();
      await sleep(1200);
      ok(!!window.__SAVED, '走的是「先选保存位置」分支（有图片）[toast=' +
        (document.getElementById('toast') || {}).textContent + ' / setFile=' + window.__setFile + ']');
      if (window.__SAVED) {
        eq(window.__SAVED.name, '样本.md', '保存名');
        eq(window.__SAVED.assets.length, 1, '交给原生写盘的图片数');
        eq(window.__SAVED.assets[0].path, 'assets/样本-media/image1.png', '图片落盘路径');
        ok(window.__SAVED.content.indexOf('# 第一章 标题') === 0, '写盘内容正确');
      }
      ok(Editor.getValue().indexOf('# 第一章 标题') === 0, '编辑器里已经载入转换结果');
      eq(Editor.getPath(), '/tmp/导入样本.md', '文档路径已绑定（图片才能按相对路径解析）');

      /* ---------- UI 入口：纯 html（不产生图片） ---------- */
      window.__SAVED = null;
      window.__SRC = { path: '/tmp/网页.html', name: '网页.html', ext: 'html', base64: HTMLB64 };
      window.OpenTyporaCmd.importFile();
      await sleep(400);
      eq(window.__SAVED, null, '没有图片时不再弹保存框');
      ok(Editor.getValue().indexOf('# 网页大标题') === 0, '编辑器载入了网页内容');
      eq(Editor.getPath(), null, '纯 html 导入是未命名文档');

      window.__report = 'IMPORTWEB ' + pass + '/' + (pass + fail) +
        (fail ? ' | ' + bad.join(' ; ') : '') +
        (window.__errs.length ? ' [错误 ' + window.__errs.join(' / ') + ']' : '');
    } catch (e) {
      window.__report = 'IMPORTWEB 异常 ' + (e && e.message) +
        ' @ ' + ((e && e.stack) || '').split('\n')[1] +
        ' [已完成 ' + pass + '/' + (pass + fail) + ']';
    }
  })();
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
// MOCK 必须放在 bridge.js 之后：bridge.js 顶层是 `var Bridge = …`，会把前面挂的 mock 覆盖掉
html = html.replace('</body>', function () { return MOCK + '\n</body>'; });
html = html.replace('<body>', function () {
  return '<body>\n' +
    '<script id="__docx" type="text/plain">' + DOCX_B64 + '</script>\n' +
    '<script id="__html" type="text/plain">' + HTML_B64 + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
