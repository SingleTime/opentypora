// 行内实时预览 · 真 WKWebView 验证（build/shot 跑）
//
// 纯逻辑在 live.test.js；这里验的是「真的能边打边藏」：
// 进入编辑是渲染态、标记不在 DOM 里、光标进到那段才露出来、打字落回原文、
// 以及哪些块必须老老实实退回源码 textarea（代码/链接/公式/多行）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__live_harness.html');

const MOCK = `
<script>
try {
  localStorage.clear();
  localStorage.setItem('opentypora.prefs', JSON.stringify({ autosave: false }));
} catch (e) {}
window.addEventListener('error', function (e) { window.__err = 'SCRIPT ERROR ' + e.message + ' @line ' + e.lineno; });
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/l.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/l.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve(null); },
  readFile: function () { return Promise.reject(new Error('x')); },
  listDir: function () { return Promise.resolve({ tree: [] }); },
  saveImage: function () { return Promise.resolve('assets/x.png'); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [], pass = 0, fail = 0;
  function ok(name, cond, got) {
    if (cond) { pass++; R.push((pass + fail) + '. PASS ' + name); }
    else { fail++; R.push((pass + fail) + '. FAIL ' + name + (got === undefined ? '' : '  got=' + got)); }
  }
  function eq(name, got, want) {
    ok(name + ' [' + JSON.stringify(want) + ']', JSON.stringify(got) === JSON.stringify(want),
      'got=' + JSON.stringify(got));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function report() {
    var s = 'LIVE ' + pass + '/' + (pass + fail) + '\\n' + R.join('\\n');
    if (window.__err) s = 'ERR ' + window.__err + '\\n' + s;
    window.__report = s;
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:900px;max-height:86vh;overflow:auto';
    box.textContent = s;
    document.body.appendChild(box);
  }
  function blk(i) { return document.querySelector('#editor .blk[data-i="' + i + '"]'); }
  function area() { return document.querySelector('#editor .src'); }
  function raw(i) { return Editor.getRaw(i); }

  /* 在光标处「打字」：真的往 DOM 里插一个文本节点，再派发 input，
   * 走的路径与浏览器原生输入一致（都是 DOM 变了 → input）。 */
  function type(el, text) {
    var sel = window.getSelection();
    var r = sel.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    var tn = document.createTextNode(text);
    r.insertNode(tn);
    var nr = document.createRange();
    nr.setStart(tn, tn.nodeValue.length);
    nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function key(el, k, opts) {
    el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
  }

  (async function () {
    await sleep(420);

    /* ============================================ 1. 标记藏在渲染态里 */
    Editor.load(['# 标题', '', '一段**粗体**文字。', '', '普通段落。'].join('\\n'), '/ws/l.md', 'l.md');
    await sleep(80);
    Editor.enterEdit(1, 2);
    await sleep(60);
    var el = blk(1);
    ok('带强调的段落走 live', el.classList.contains('live'), el.className);
    ok('输入面还是 .src（其他模块照旧找得到）', area() === el);
    eq('标记不在正文里', el.textContent, '一段粗体文字。');
    ok('粗体是渲染出来的', !!el.querySelector('strong'));
    eq('光标按原文偏移', el.selectionStart, 2);
    eq('一开始不露标记', el.querySelectorAll('[data-mk]').length, 0);

    /* ============================================ 2. 光标进了就露出来 */
    el.setSelectionRange(4);
    await sleep(50);
    el = blk(1);
    eq('光标进到强调里 → 开闭标记都露', el.querySelectorAll('[data-mk]').length, 2);
    eq('露出来时显示原文', el.textContent, '一段**粗体**文字。');

    el.setSelectionRange(0);
    await sleep(50);
    eq('光标移开 → 又藏回去', blk(1).querySelectorAll('[data-mk]').length, 0);
    eq('藏回去的正文', blk(1).textContent, '一段粗体文字。');

    /* ============================================ 3. 打普通字 */
    el = blk(1);
    el.setSelectionRange(0);
    type(el, '前');
    await sleep(60);
    eq('行首插字进原文', raw(1), '前一段**粗体**文字。');
    eq('打完之后标记仍然藏着（光标不在强调里）', blk(1).querySelectorAll('[data-mk]').length, 0);
    eq('打完之后正文', blk(1).textContent, '前一段粗体文字。');

    /* ============================================ 4. 在强调里打字 */
    el = blk(1);
    el.setSelectionRange(6);           // 「前一段**粗体**」里 粗 之后
    await sleep(40);
    type(el, '又');
    await sleep(80);
    eq('强调里插字进原文', raw(1), '前一段**粗又体**文字。');
    eq('插入后光标在字后面', blk(1).selectionStart, 7);

    /* ============================================ 5. 删掉强调内容 → 标记一起清 */
    el = blk(1);
    el.setSelectionRange(5, 8);        // 选中「粗又体」
    await sleep(40);
    var sel = window.getSelection();
    sel.getRangeAt(0).deleteContents();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    eq('删空强调后不留星号', raw(1), '前一段文字。');
    eq('清理后正文', blk(1).textContent, '前一段文字。');

    /* ============================================ 6. 自动配对：* 打出来能变斜体 */
    Editor.exitEdit();
    await sleep(40);
    Editor.load(['前 。'].join('\\n'), '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 2);
    await sleep(60);
    el = blk(0);
    el.setSelectionRange(2);           // 落在空格与句号之间：星号在这里会配对
    key(el, '*');
    await sleep(60);
    eq('自动配对先落成一对星号', raw(0), '前 **。');
    eq('配对之后光标在中间', blk(0).selectionStart, 3);
    eq('空的一对星号还是字面显示', blk(0).textContent, '前 **。');
    el = blk(0);
    type(el, '斜');
    await sleep(80);
    eq('中间打的字进原文', raw(0), '前 *斜*。');
    ok('收成斜体', !!blk(0).querySelector('em'), blk(0).innerHTML);
    eq('光标在强调里 → 标记露着', blk(0).querySelectorAll('[data-mk]').length, 2);
    eq('露出来时就是原文', blk(0).textContent, '前 *斜*。');
    blk(0).setSelectionRange(0);
    await sleep(50);
    eq('光标移开 → 藏起来', blk(0).textContent, '前 斜。');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 7. Enter 分块 */
    Editor.exitEdit();
    await sleep(40);
    Editor.load(['第一段文字。'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 4);
    await sleep(50);
    el = blk(0);
    el.setSelectionRange(4);
    eq('回车前光标停在 4', blk(0).selectionStart, 4);
    key(el, 'Enter');
    await sleep(80);
    eq('回车把块切开（块数）', Editor.blockCount(), 2);
    eq('前半段', raw(0), '第一段文');
    eq('后半段', raw(1), '字。');
    ok('回车之后停在新块里并且还是 live', blk(1).classList.contains('live'), blk(1).className);

    /* ============================================ 8. 行首退格合并 */
    el = blk(1);
    el.setSelectionRange(0);
    key(el, 'Backspace');
    await sleep(100);
    eq('行首退格并回上一块', Editor.blockCount(), 1);
    eq('合并后的原文', raw(0), '第一段文字。');

    /* ============================================ 9. 撤销 */
    await sleep(900);                  // 撤销是 800ms 合并，先停够
    el = blk(0);
    el.setSelectionRange(raw(0).length);
    type(el, '追加');
    await sleep(80);
    eq('追加之后', raw(0), '第一段文字。追加');
    Editor.undo();
    await sleep(80);
    eq('撤销回到追加之前', raw(0), '第一段文字。');

    /* ============================================ 10. 该退回 textarea 的块 */
    Editor.exitEdit();
    await sleep(40);
    Editor.load([
      '# 标题',
      '',
      '带 \`代码\` 的一段。',
      '',
      '带 [链接](https://a.b) 的一段。',
      '',
      '第一行',
      '第二行',
      '',
      '普通段落。'
    ].join('\\n'), '/ws/l.md', 'l.md');
    await sleep(80);

    Editor.enterEdit(1, 2);
    await sleep(50);
    ok('行内代码退回 textarea', !!document.querySelector('#editor textarea.src'),
      blk(1) ? blk(1).innerHTML.slice(0, 40) : 'no-blk');
    ok('行内代码的块不是 live', !blk(1).classList.contains('live'));
    Editor.exitEdit();

    Editor.enterEdit(2, 2);
    await sleep(50);
    ok('链接退回 textarea', !!document.querySelector('#editor textarea.src'));
    Editor.exitEdit();

    Editor.enterEdit(3, 2);
    await sleep(50);
    ok('多行段落退回 textarea', !!document.querySelector('#editor textarea.src'));
    Editor.exitEdit();

    Editor.enterEdit(4, 2);
    await sleep(50);
    ok('普通段落仍是 live', blk(4) && blk(4).classList.contains('live'),
      blk(4) ? blk(4).className : 'no-blk');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 11. 块前缀：标题藏、列表引用露 */
    Editor.load(['## 二级标题', '', '- 一条待办', '', '> 引用一句'].join('\\n'), '/ws/l.md', 'l.md');
    await sleep(80);
    Editor.enterEdit(0, 5);
    await sleep(60);
    eq('标题的 # 前缀也藏起来（看见的就是渲染态）', blk(0).textContent, '二级标题');
    ok('标题进 live 仍是标题字号（块类还在）', blk(0).classList.contains('h2'), blk(0).className);

    blk(0).setSelectionRange(3);         // 光标落到正文最前面
    await sleep(60);
    eq('光标到行首 → 前缀现形', blk(0).textContent, '## 二级标题');
    eq('前缀露出来时是一个标记节点', blk(0).querySelectorAll('[data-mk]').length, 1);

    el = blk(0);
    key(el, 'Backspace');
    await sleep(90);
    eq('行首退格一次去掉整个前缀', raw(0), '二级标题');
    eq('去掉前缀之后正文', blk(0).textContent, '二级标题');
    ok('标题变回普通段落', !blk(0).classList.contains('h2'), blk(0).className);
    Editor.exitEdit();
    await sleep(40);

    Editor.enterEdit(0, 2);
    await sleep(50);
    eq('藏的前提是光标不在行首（回到行中又藏起来）', blk(0).textContent, '二级标题');
    Editor.exitEdit();
    await sleep(40);

    Editor.enterEdit(1, 3);
    await sleep(50);
    eq('列表前缀还在', blk(1).textContent, '- 一条待办');
    Editor.exitEdit();

    Editor.enterEdit(2, 3);
    await sleep(50);
    eq('引用前缀也在', blk(2).textContent, '> 引用一句');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 11b. 光标紧贴露出的标记时退格 */
    Editor.load(['一段**粗体**文字。'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 4);
    await sleep(60);
    el = blk(0);
    eq('开标记露着', el.querySelectorAll('[data-mk]').length, 2);
    key(el, 'Backspace');
    await sleep(90);
    eq('贴着开标记退格 → 整对星号一起删（不是死键）', raw(0), '一段粗体**文字。');
    eq('删完正文', blk(0).textContent, '一段粗体**文字。');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 12. 任务列表带 input，退回 textarea */
    Editor.load(['- [ ] 待办一条'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 8);
    await sleep(50);
    ok('任务框的块退回 textarea（contenteditable 里塞 input 不行）',
      !!document.querySelector('#editor textarea.src'));
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 13. 开关关掉 → textarea */
    Editor.setLivePreview(false);
    Editor.load(['一段**粗体**文字。'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 2);
    await sleep(50);
    ok('关掉开关就退回 textarea', !!document.querySelector('#editor textarea.src'));
    eq('关掉之后正文是原文', document.querySelector('#editor textarea.src').value, '一段**粗体**文字。');
    Editor.exitEdit();
    Editor.setLivePreview(true);
    await sleep(40);

    /* ============================================ 14. 空块 */
    Editor.load([''], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 0);
    await sleep(50);
    ok('空块也能进 live', blk(0).classList.contains('live'), blk(0).className);
    el = blk(0);
    type(el, '新');
    await sleep(80);
    eq('空块里打的字进原文', raw(0), '新');
    eq('空块打完之后正文', blk(0).textContent, '新');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 15. 组字：过程中不翻译，结束才翻 */
    Editor.load(['一段文字。'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 2);
    await sleep(50);
    el = blk(0);
    el.setSelectionRange(2);
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    type(el, '拼');                     // 组字中的 input 不该落进原文
    await sleep(50);
    eq('组字过程中不动原文', raw(0), '一段文字。');
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await sleep(60);
    eq('组字结束一次落账', raw(0), '一段拼文字。');

    /* ============================================ 16. shim：value / setSelectionRange */
    el = blk(0);
    el.value = '整体换掉';
    await sleep(60);
    eq('直接写 .value 会进模型', raw(0), '整体换掉');
    eq('显示跟着换', blk(0).textContent, '整体换掉');
    blk(0).setSelectionRange(2);
    await sleep(40);
    eq('设光标按原文偏移', blk(0).selectionStart, 2);

    /* ============================================ 17. 退出后回到渲染态 */
    Editor.exitEdit();
    await sleep(60);
    el = blk(0);
    ok('退出后不再是 live', !el.classList.contains('live'), el.className);
    ok('退出后没有 contenteditable', !el.hasAttribute('contenteditable'));
    eq('退出后正文', el.textContent, '整体换掉');

    /* ============================================ 18. 强调与正文混排的高频路径 */
    Editor.load(['把**这段**和*那段*都改一下，还有~~划掉~~的部分。'], '/ws/l.md', 'l.md');
    await sleep(60);
    Editor.enterEdit(0, 0);
    await sleep(60);
    el = blk(0);
    eq('三种标记都藏起来', el.textContent, '把这段和那段都改一下，还有划掉的部分。');
    ok('strong 在', !!el.querySelector('strong'));
    ok('em 在', !!el.querySelector('em'));
    ok('del 在', !!el.querySelector('del'));
    el.setSelectionRange(3);
    await sleep(50);
    eq('进到 strong 里只露这一对', blk(0).querySelectorAll('[data-mk]').length, 2);
    el = blk(0);
    el.setSelectionRange(9);            // 落在 em 里
    await sleep(50);
    eq('换到 em 里露的是另一对', blk(0).querySelectorAll('[data-mk]').length, 2);
    eq('露出来的是 em 这一对，strong 仍藏着', blk(0).textContent, '把这段和*那段*都改一下，还有划掉的部分。');
    Editor.exitEdit();
    await sleep(40);

    /* ============================================ 19. 反复进出不残留 */
    var before = Editor.getValue();
    for (var k = 0; k < 3; k++) {
      Editor.enterEdit(0, 2);
      await sleep(30);
      Editor.exitEdit();
      await sleep(30);
    }
    eq('反复进出正文不变', Editor.getValue(), before);
    eq('没有残留的标记节点', document.querySelectorAll('#editor [data-mk]').length, 0);
    eq('没有残留的 live 块', document.querySelectorAll('#editor .blk.live').length, 0);

    report();
  })().catch(function (e) { window.__err = String(e && e.stack || e); report(); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
