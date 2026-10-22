// edit2.test.js —— 第六轮编辑能力集成测试：Emoji 补全 / Text Snippet / 表格拖动排序 / 严格模式
// 真实 WKWebView 里跑（build/shot）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__edit2_harness.html');

const DOC = [
  '# 编辑能力',
  '',
  '第一段：表情与片段在这里试。',
  '',
  '| 名称 | 数量 | 备注 |',
  '| --- | --- | --- |',
  '| 苹果 | 3 | 红 |',
  '| 梨 | 12 | 黄 |',
  '| 桃 | 7 | 粉 |',
  '',
  '> [!NOTE]',
  '> 提示块',
  '',
  '严格模式的试金石：==高亮== a^2^ H~2~O :smile: [[笔记]] 与 **粗体**。',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__e2.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__e2.md' }); },
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
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var DOC = JSON.parse(document.getElementById('__doc').textContent);

  function load(raw) {
    Editor.load(raw, '/tmp/e2.md', 'e2.md');
    return Editor.getState().model.blocks;
  }
  function blocks() { return Editor.getState().model.blocks; }
  function rawAt(i) { return blocks()[i].raw; }

  /* 进入某块的光标处 */
  function editAt(i, text, caret) {
    Editor.enterEdit(i, caret == null ? text.length : caret);
    var ta = $('#editor .src');
    ta.value = text;
    ta.setSelectionRange(caret == null ? text.length : caret, caret == null ? text.length : caret);
    return ta;
  }
  function type(ta, text) {
    var v = ta.value, at = ta.selectionStart;
    ta.value = v.slice(0, at) + text + v.slice(ta.selectionEnd);
    ta.setSelectionRange(at + text.length, at + text.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function key(ta, k, opts) {
    ta.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
  }

  (async function () {
    await sleep(300);
    load(DOC);

    /* ==================================================== Emoji 补全 */
    var P_I = 1;                                  // 「第一段」
    var ta = editAt(P_I, '表情 :sm', 6);
    ok(!$('.emoji-pop'), '一开始没有浮层');
    type(ta, 'i');                                // → 「表情 :smi」
    await sleep(60);
    var pop = $('.emoji-pop');
    ok(!!pop, '敲 :smi 弹出补全浮层');
    ok(!!pop && pop.classList.contains('on'), '浮层可见');
    var names = pop ? $$('.emoji-pop .emoji-name').map(function (e) { return e.textContent; }) : [];
    ok(names.length > 0, '有候选（' + names.slice(0, 4).join(' ') + '）');
    ok(names[0] === ':smile:', 'smile 排第一（' + names[0] + '）');
    var glyphs = pop ? $$('.emoji-pop .emoji-ch') : [];
    ok(glyphs.length > 0 && glyphs[0].textContent.length > 0, '候选里显示字形');

    key(ta, 'ArrowDown');                          // 移到第二个
    await sleep(30);
    var onIdx = pop ? $$('.emoji-pop .emoji-item').findIndex(function (e) { return e.classList.contains('on'); }) : -1;
    eq(onIdx, 1, '↓ 移到第二个候选');
    key(ta, 'ArrowUp');
    await sleep(30);
    onIdx = $$('.emoji-pop .emoji-item').findIndex(function (e) { return e.classList.contains('on'); });
    eq(onIdx, 0, '↑ 移回第一个');

    key(ta, 'Escape');
    await sleep(30);
    ok(!$('.emoji-pop') || !$('.emoji-pop').classList.contains('on'), 'Esc 关掉浮层');
    eq(ta.value, '表情 :smi', 'Esc 不改文本');

    type(ta, 'l');                                 // 「表情 :smil」
    await sleep(60);
    key(ta, 'Enter');
    await sleep(60);
    var inserted = ta.value;
    ok(inserted.indexOf(':smi') < 0, 'Enter 后查询串被替换');
    ok(inserted.indexOf('😄') >= 0, '插入的是字形（' + inserted + '）');
    ok(inserted.indexOf(':smile:') < 0, '不留 shortcode 原文');

    // 时间与 URL 不误触发
    var ta2 = editAt(P_I, '现在 12:30 了', 9);
    type(ta2, '5');
    await sleep(40);
    ok(!$('.emoji-pop') || !$('.emoji-pop').classList.contains('on'), '12:30 不弹浮层');

    var ta3 = editAt(P_I, '见 https://example.com/a', 24);
    type(ta3, 'b');
    await sleep(40);
    ok(!$('.emoji-pop') || !$('.emoji-pop').classList.contains('on'), 'URL 里不弹浮层');

    // 行内代码里不弹
    var ta4 = editAt(P_I, '代码 \`:sm', 8);
    type(ta4, 'i');
    await sleep(40);
    ok(!$('.emoji-pop') || !$('.emoji-pop').classList.contains('on'), '行内代码里不弹浮层');

    /* ==================================================== Text Snippet */
    var SN_I = 1;
    var snEl = $('#prefs-snippets');
    ok(!!snEl, '偏好里有片段文本框');
    snEl.value = 'brb => be right back\nsig => 此致\\n敬礼\\n\\n$0';
    snEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(40);

    var ts = editAt(SN_I, '先说 brb', 7);
    key(ts, 'Tab');
    await sleep(60);
    eq(rawAt(SN_I), '先说 be right back', 'Tab 展开片段');
    var caretAfter = (function () {
      Editor.enterEdit(SN_I, 999);
      return $('#editor .src').selectionStart;
    })();
    eq(caretAfter, '先说 be right back'.length, '没有 $0 时光标落在末尾');

    var ts2 = editAt(SN_I, '落点 sig', 6);
    key(ts2, 'Tab');
    await sleep(60);
    eq(rawAt(SN_I), '落点 此致\n敬礼\n\n', '$0 从内容里去掉');
    Editor.enterEdit(SN_I, 999);
    eq($('#editor .src').selectionStart, '落点 '.length + 7, '$0 指定光标落点');

    // 非触发词按 Tab 原逻辑（缩进/焦点移动），不能乱展开
    var ts3 = editAt(SN_I, 'hello world', 11);
    key(ts3, 'Tab');
    await sleep(40);
    eq(rawAt(SN_I), '落点 此致\n敬礼\n\n', '不在表里的词不展开，内容保持原样');

    /* ==================================================== 表格拖动排序 */
    load(DOC);
    var TBL_I = 2;
    function tbl() { return MD.tableModel(rawAt(TBL_I)); }
    function cellEl(r, c) {
      return document.querySelector('#editor ' + (r < 0 ? 'th[data-c="' + c + '"]' : 'td[data-r="' + r + '"][data-c="' + c + '"]'));
    }
    function handle(kind, n) {
      var sel = kind === 'row' ? '.tbl-h-row[data-r="' + n + '"]' : '.tbl-h-col[data-c="' + n + '"]';
      return document.querySelector(sel);
    }
    function showHandles() {
      var c = cellEl(1, 1);
      var r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    }
    function hoverCell(r, c) {
      var cell = cellEl(r, c);
      if (!cell) return null;
      var rect = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
      return cell;
    }
    function drag(kind, from, toCell, before) {
      hoverCell(from < 0 ? -1 : from, 0);   // 先把手柄挪到源行/列上（手柄的 data-r/data-c 跟着悬停走）
      var h = handle(kind, from);
      if (!h) return false;
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
      var target = typeof toCell === 'function' ? toCell() : cellEl.apply(null, toCell);
      if (!target) return false;
      var r = target.getBoundingClientRect();
      var x = before ? r.left + 2 : r.right - 2;
      var y = before ? r.top + 2 : r.bottom - 2;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      return true;
    }

    showHandles();
    await sleep(40);
    ok(!!handle('row', 1), '有行手柄');
    ok(!!handle('col', 1), '有列手柄');
    eq(tbl().rows[0][0], '苹果', '初始第 1 行是苹果');

    // 行：把第 1 行（苹果）拖到第 3 行（桃）下面
    var moved = drag('row', 0, [2, 0], false);
    await sleep(80);
    ok(moved, '行拖拽事件派发成功');
    eq(tbl().rows[0][0], '梨', '第 1 行被拖走后梨上来');
    eq(tbl().rows[2][0], '苹果', '苹果落到第 3 行');
    eq(tbl().rows.length, 3, '行数不变');

    // 撤销
    Editor.undo();
    await sleep(80);
    eq(tbl().rows[0][0], '苹果', '撤销恢复行序');

    // 列：把第 1 列（名称）拖到第 3 列后面
    var moved2 = drag('col', 0, [-1, 2], false);
    await sleep(80);
    eq(tbl().head.join('|'), '数量|备注|名称', '列头顺序变了');
    eq(tbl().rows[0].join('|'), '3|红|苹果', '数据跟着列一起搬');
    Editor.undo();
    await sleep(80);
    eq(tbl().head.join('|'), '名称|数量|备注', '撤销恢复列序');

    // 原地拖 = 不动
    drag('row', 1, [1, 0], true);
    await sleep(60);
    eq(tbl().rows[1][0], '梨', '原地拖动不改内容');

    // 拖完不应顺手插入一行（click 被吃掉）
    eq(tbl().rows.length, 3, '拖动没有误触发插入');

    /* ==================================================== 严格模式 */
    var G_I = blocks().length - 1;               // 最后一段
    ok(/==高亮==/.test(rawAt(G_I)), '源码不变');
    var para = $('#editor .blk.para:last-of-type');
    ok(!!$('#editor mark'), '默认渲染出高亮');
    ok(!!$('#editor .emoji'), '默认渲染出 emoji');
    ok(!!$('#editor .callout'), '默认渲染出 callout');
    ok(!!$('#editor a.wiki-link'), '默认渲染出 wiki 链接');

    var strictEl = $('#prefs-strict');
    ok(!!strictEl, '偏好里有严格模式开关');
    strictEl.checked = true;
    strictEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    ok(MD.isStrict() === true, '开关打开后 MD 进入严格模式');
    ok(!$('#editor mark'), '严格模式没有高亮');
    ok(!$('#editor .emoji'), '严格模式没有 emoji');
    ok(!$('#editor .callout'), '严格模式没有 callout');
    ok(!$('#editor a.wiki-link'), '严格模式没有 wiki 链接');
    var lastPara = $$('#editor .blk.para').pop();
    ok(/==高亮==/.test(lastPara.textContent), '严格模式高亮退成字面');
    ok(/:smile:/.test(lastPara.textContent), '严格模式 emoji 退成字面');
    ok(/\[\[笔记\]\]/.test(lastPara.textContent), '严格模式 wiki 退成字面');
    ok(!!$('#editor strong'), '严格模式粗体照常');
    eq(rawAt(G_I), blocks()[G_I].raw, '源码一个字符都没动');

    strictEl.checked = false;
    strictEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    ok(MD.isStrict() === false, '可以关回去');
    ok(!!$('#editor mark'), '关掉后高亮回来');

    window.__report = 'EDIT2 ' + pass + '/' + (pass + fail) + (fail ? ' | ' + bad.join(' ; ') : '');
  })().catch(function (e) {
    window.__report = 'EDIT2 0/1 | 异常 ' + (e && e.stack ? e.stack.split('\n')[0] : e);
  });
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
