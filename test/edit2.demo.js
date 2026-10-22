// edit2.demo.js —— 第六轮新能力的演示页：Emoji 补全 / Text Snippet / 严格模式 / 表格拖动指示线
// 用法：node test/edit2.demo.js && ./build/shot app/__edit2_demo.html docs/opentypora-edit2.png 1280 900 "" 6
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__edit2_demo.html');

const DOC = [
  '# 编辑能力演示', '',
  '在正文里敲 `:名字` 会弹出 Emoji 补全，↑↓ 选择后 Enter 插入字形。', '',
  '## 文本片段', '',
  '偏好里写好 `触发词 => 内容`，在编辑器里敲触发词按 Tab 就能展开。', '',
  '## 严格模式', '',
  '这段同时含 ==高亮==、上标 a^2^、下标 H~2~O、表情 :smile:、链接 [[笔记]] 与 **粗体**。', '',
  '## 表格拖动排序', '',
  '| 水果 | 数量 | 备注 |',
  '| --- | --- | --- |',
  '| 苹果 | 3 | 红 |',
  '| 梨 | 12 | 黄 |',
  '| 桃 | 7 | 粉 |',
  '',
  '按住行/列手柄拖到目标行，落在上半插在前面、下半插在后面。', ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
localStorage.setItem('opentypora.prefs', JSON.stringify({
  size: 15.5, width: 830, autosave: true, spellcheck: false, base: 'github',
  autoPair: true, smart: true, lineno: false, zoom: 100, followSystem: false,
  imgCenter: false, strict: ${'$'}{STRICT},
  snippets: 'sig => 此致\\n敬礼\\n\\n$0\\nbrb => be right back\\ntbl => | 列一 | 列二 |\\n| --- | --- |\\n|  |  |'
}));
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__demo.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__demo.md' }); },
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

const TEST = String.raw`
(function () {
  function $(s) { return document.querySelector(s); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  (async function () {
    await sleep(500);
    var DOC = JSON.parse(document.getElementById('__doc').textContent);
    Editor.load(DOC, '/tmp/demo.md', 'demo.md');
    await sleep(400);

    /* ---- 0. 严格模式（第三张截图用：先打开再加载） ---- */
    if (window.__DEMO_STRICT) {
      if (window.MD && MD.setStrict) MD.setStrict(true);
    }

    /* ---- 1. Emoji 补全浮层 ---- */
    Editor.enterEdit(1, 999);
    var ta = $('#editor textarea.src');
    ta.value = '敲 :smi';
    ta.setSelectionRange(6, 6);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);
    if ($('.emoji-pop')) $('.emoji-pop').classList.add('on');

    /* ---- 2. 表格拖动指示线：假装正把第 1 行拖到第 3 行下面 ---- */
    await sleep(200);
    var cells = document.querySelectorAll('#editor td[data-r="2"]');
    if (cells.length) {
      var r = cells[0].getBoundingClientRect();
      var line = document.createElement('div');
      line.style.cssText = 'position:fixed;z-index:940;display:block;pointer-events:none;' +
        'background:#d1242f;box-shadow:0 0 0 1px rgba(209,36,47,.35);' +
        'left:' + Math.round(r.left) + 'px;width:' + Math.round(r.width) + 'px;' +
        'top:' + Math.round(r.bottom - 2) + 'px;height:3px;border-radius:2px;';
      document.body.appendChild(line);
      // 顺手给被拎起来的行加个底色，演示「拎起来」的样子
      var row1 = document.querySelectorAll('#editor td[data-r="0"]');
      Array.prototype.forEach.call(row1, function (td) {
        td.parentNode.style.background = 'rgba(209,36,47,.08)';
      });
    }

    /* ---- 3. 偏好面板（第二张截图才开，避免盖住正文） ---- */
    if (window.__DEMO_PREFS) {
      await sleep(200);
      OpenTyporaCmd.preferences();
      await sleep(300);
      var prefs = $('#prefs');
      if (prefs) {
        prefs.classList.add('show');
        prefs.scrollTop = 0;
      }
    }
  })().catch(function (e) { console.error(e); });
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
var strictMode = process.argv[2] === 'strict';
var prefsMode = process.argv[2] === 'prefs';
var mock = MOCK.replace('${STRICT}', strictMode ? 'true' : 'false');
html = html.replace('</head>', function () { return mock + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () {
  return '<script>window.__DEMO_PREFS = ' + prefsMode + ';window.__DEMO_STRICT = ' + strictMode + ';</script>\n' +
    '<script>\n' + TEST + '\n</script>\n</body>';
});
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
