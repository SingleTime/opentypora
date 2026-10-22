// HTML 块渲染集成测试：真实 WKWebView 里跑（build/shot）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__html_harness.html');

// 块：0 标题 / 1 居中 div / 2 跨空行 / 3 details / 4 script / 5 事件属性 / 6 未闭合 / 7 段落
const DOC = [
  '# HTML 块',
  '',
  '<div class="note" style="text-align:center;font-size:20px">居中<strong>加粗</strong></div>',
  '',
  '<div class="multi">',
  '第一段',
  '',
  '第二段',
  '</div>',
  '',
  '<details>',
  '<summary>点我展开</summary>',
  '里面是内容',
  '</details>',
  '',
  '<script>window.__pwned = 1;</script>',
  '',
  '<div onclick="window.__clicked = 1" class="evil">带事件</div>',
  '',
  '<div class="broken">',
  '没闭合',
  '',
  '后面段落',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
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

const TEST = String.raw`
(function () {
  var pass = 0, fail = 0, bad = [];
  function ok(c, m) { if (c) pass++; else { fail++; bad.push(m); } }
  function eq(a, b, m) { ok(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }

  var DOC = JSON.parse(document.getElementById('__doc').textContent);
  var blocks = function () { return Editor.getState().model.blocks; };
  var rawOf = function (i) { return blocks()[i].raw; };
  var htmlBlk = function (n) { return document.querySelectorAll('#editor .blk.html')[n]; };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  (async function () {
   await sleep(600);
   try {
    Editor.load(DOC, '/tmp/h.md', 'h.md');

    /* ---------- 分块 ---------- */
    eq(blocks().length, 8, '整篇 8 块');
    eq(blocks()[1].type, 'html', '第 2 块是 html');
    eq(blocks()[6].type, 'html', '未闭合的 div 仍是 html 块');
    eq(blocks()[7].type, 'para', '未闭合 div 后面的段落没被吞掉');
    ok(rawOf(2).indexOf('第二段') > 0, '跨空行的 div 整块收进来了');
    ok(rawOf(7) === '后面段落', '第 8 块内容正确');

    /* ---------- 渲染 ---------- */
    eq(document.querySelectorAll('#editor .blk.html').length, 6, '6 个 HTML 块都渲染');
    eq(document.querySelectorAll('#editor .html-body').length, 6, '每个块都有 html-body 容器');

    var note = document.querySelector('#editor .html-body > div.note');
    ok(!!note, 'div.note 渲染成真标签');
    ok(!!note && !!note.querySelector('strong'), '内层 <strong> 也渲染');
    eq(note && getComputedStyle(note).textAlign, 'center', '行内 style 生效（居中）');
    eq(note && getComputedStyle(note).fontSize, '20px', '行内 style 生效（字号）');
    eq(note && note.textContent, '居中加粗', '文字内容完整');

    var multi = document.querySelector('#editor .html-body > div.multi');
    ok(!!multi && multi.textContent.indexOf('第一段') >= 0 && multi.textContent.indexOf('第二段') >= 0,
      '跨空行的两段都在同一个 div 里');

    var det = document.querySelector('#editor details');
    ok(!!det, '<details> 渲染出来');
    eq(det && det.tagName, 'DETAILS', '确实是 details 元素');
    ok(!!det && !!det.querySelector('summary'), 'summary 在');
    eq(det && det.open, false, '默认折叠');
    eq(det && det.textContent.indexOf('里面是内容') >= 0, true, '内容在');

    /* ---------- 消毒 ---------- */
    eq(document.querySelectorAll('#editor .blk.html script').length, 0, '<script> 没进 DOM');
    eq(typeof window.__pwned, 'undefined', 'script 没执行');
    var evil = document.querySelector('#editor .evil');
    ok(!!evil, '.evil 渲染出来');
    eq(evil && evil.getAttribute('onclick'), null, 'onclick 属性被剔除');
    eq(typeof window.__clicked, 'undefined', '事件属性没生效');

    /* ---------- 未闭合不吞后文 ---------- */
    var last = htmlBlk(5);
    ok(!!last, '第 6 个 html 块存在');
    ok(last && last.textContent.indexOf('后面段落') === -1, '未闭合 div 没吞掉后面的段落');
    ok(!!document.querySelector('#editor .blk.para'), '后面段落仍是独立的 para 块');

    /* ---------- 悬停角标（CSS 接线） ---------- */
    eq(getComputedStyle(htmlBlk(0)).backgroundColor, 'rgba(0, 0, 0, 0)', 'HTML 块不再套代码底色');
    eq(getComputedStyle(htmlBlk(0)).fontFamily.indexOf('mono') === -1, true, '不再强制等宽字体');
    eq(getComputedStyle(htmlBlk(0)).position, 'relative', '块是定位容器（角标要用）');

    /* ---------- 点到块内子节点也能进编辑态 ---------- */
    var pspan = document.querySelector('#editor .blk.para span[data-s]');
    var pr = pspan.getBoundingClientRect();
    pspan.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: pr.left + 2, clientY: pr.top + 4
    }));
    await sleep(200);
    ok(!!document.querySelector('#editor .src'), '点普通段落里的文字能停在编辑态');
    Editor.exitEdit();
    await sleep(80);

    /* ---------- 点击进源码态 ---------- */
    note = document.querySelector('#editor .html-body > div.note');
    var r = note.getBoundingClientRect();
    note.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: r.left + 6, clientY: r.top + 6
    }));
    await sleep(240);
    var ta = document.querySelector('#editor .src');
    ok(!!ta, '点一下进入块内源码态（editing=' + Editor.getState().editing +
      ' / connected=' + note.isConnected + ' / inBlk=' + !!note.closest('.blk') + '）' );
    eq(ta && ta.value, rawOf(1), '源码态内容 = 原始 raw');
    ok(ta && ta.value.indexOf('<div class="note"') === 0, '源码以标签开头');

    Editor.exitEdit();
    eq(rawOf(1), '<div class="note" style="text-align:center;font-size:20px">居中<strong>加粗</strong></div>',
      '进出编辑态后 raw 没被改写');
    eq(Editor.getValue(), DOC, '整篇内容字节不变');
    eq(document.querySelectorAll('#editor .blk.html').length, 6, '退出后仍正确渲染');

    /* ---------- 分栏预览 ---------- */
    window.OpenTyporaCmd.toggleSplit();
    await sleep(260);
    var pv = document.getElementById('split-prev-inner');
    ok(!!pv, '分栏预览容器在');
    ok(!!pv && !!pv.querySelector('.html-body > div.note'), '分栏预览里也渲染成真标签');
    eq(pv && pv.querySelectorAll('script').length, 0, '分栏预览里也没有 script');
    window.OpenTyporaCmd.toggleSplit();
    await sleep(260);
    ok(!Editor.isSplitMode(), '已退出分栏');

    /* ---------- 导出 ---------- */
    var h = Editor.exportHTML();
    ok(h.indexOf('<div class="note"') > 0, '导出的 HTML 里是真标签' + ' [片段=' + h.slice(h.indexOf('html-body') - 40, h.indexOf('html-body') + 120) + ']');
    ok(h.indexOf('&lt;div class="note"') === -1, '不是转义后的源码');

    window.__report = 'HTML ' + pass + '/' + (pass + fail) +
      (fail ? ' | ' + bad.join(' ; ') : '') +
      (window.__errs.length ? ' [错误 ' + window.__errs.join(' / ') + ']' : '');
   } catch (e) {
     window.__report = 'HTML 异常 ' + (e && e.message) + ' @ ' + (e && e.stack || '').split('\n')[1] +
       ' [已完成 ' + pass + '/' + (pass + fail) + ']';
   }
  })();
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  // DOC 里有 <script> 字面量：JSON 里的 </script> 会提前闭合这个 JSON 脚本块，必须转义
  var payload = JSON.stringify(DOC).replace(/<\//g, '<\\/');
  return '<body>\n<script id="__doc" type="application/json">' + payload + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
