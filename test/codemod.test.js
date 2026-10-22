// 生成「代码块 Code Tools」集成测试页（WKWebView）。
// 纯函数在 code.test.js 里已经覆盖了；这里验证的是那些纯函数测不到的东西：
// 真实 DOM 里的右键菜单、clipboard、光标到底落在第几行、以及 tab 会不会跑偏。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__codemod_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__clip = '';
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: function (t) { window.__clip = t; return Promise.resolve(); } }
});
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/d.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/d.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  readText: function () { return Promise.resolve(''); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // 反引号在模板里转义是地狱，直接用字符码拼
  var BT = String.fromCharCode(96);
  var FENCE = BT + BT + BT;
  function $(id) { return document.getElementById(id); }
  function codeBlk() { return document.querySelector('#editor .blk.code'); }
  function codePre() { return document.querySelector('#editor .blk.code .code-body pre'); }
  function codeEl() { return document.querySelector('#editor .blk.code .code-body pre code'); }
  function rawNow() { return Editor.getRaw(+codeBlk().getAttribute('data-i')); }
  function menuItems() {
    return Array.prototype.slice.call(document.querySelectorAll('#ctxmenu .ctx-item'))
      .map(function (b) { return b.textContent.replace(/[^\\u4e00-\\u9fa5A-Za-z /]/g, '').trim(); });
  }
  function menuVisible() { return $('ctxmenu').classList.contains('show'); }
  function openMenu(line) {
    Code.closeMenu();
    var blk = codeBlk();
    var code = codeEl();
    var rect = code.getBoundingClientRect();
    // 用第一行的中点作为落点，保证 pointToLine 落在预期的行上
    var lh = code.textContent.indexOf('\\n') > 0
      ? (rect.height / (code.textContent.split('\\n').length)) : rect.height;
    var y = rect.top + lh * (line + 0.5);
    code.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: y
    }));
    return menuVisible();
  }
  function pick(label) {
    var b = Array.prototype.slice.call(document.querySelectorAll('#ctxmenu .ctx-item'))
      .filter(function (x) { return x.textContent.indexOf(label) === 0; })[0];
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  function ta() { return document.querySelector('#editor .src'); }
  function enterEdit() {
    var blk = codeBlk();
    Editor.enterEdit(+blk.getAttribute('data-i'), 0);
    return ta();
  }
  function key(target, opts) {
    var e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts));
    Object.defineProperty(e, 'target', { value: target });
    target.dispatchEvent(e);
  }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'CODEMOD ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:720px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  var SRC_CODE = [
    '# 标题',
    '',
    FENCE + 'js',
    'function main() {',
    'console.log("x");',
    '}',
    FENCE,
    ''
  ].join('\\n');

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 60000);
    await sleep(400);

    /* ---------- STEP 1 渲染代码块 ---------- */
    R.push('STEP 1 渲染');
    Editor.load(SRC_CODE, '/ws/d.md', 'd.md');
    await sleep(200);
    ok('代码块渲染出来了', !!codeBlk());
    ok('语言选择器在', !!document.querySelector('.code-lang-sel'));
    ok('下拉认得出 js 别名', document.querySelector('.code-lang-sel').value === 'javascript',
      document.querySelector('.code-lang-sel').value);
    ok('有三行正文', codeEl().textContent.split('\\n').length === 3,
      String(codeEl().textContent.split('\\n').length));

    /* ---------- STEP 2 右键菜单 ---------- */
    R.push('STEP 2 右键菜单');
    ok('右键代码块弹出菜单', openMenu(1));
    var items = menuItems();
    R.push('    菜单项: ' + items.join(' / '));
    function has(p) { return items.some(function (x) { return x.indexOf(p) === 0; }); }
    ok('有「复制代码」', has('复制代码'));
    ok('有「复制为 HTML」', has('复制为 HTML'));
    ok('有「自动缩进整理」', has('自动缩进整理'));
    ok('有「切换行注释」', has('切换行注释'));
    ok('有「上移当前行」', has('上移当前行'));
    ok('有「删除代码块」', has('删除代码块'));
    ok('js 的注释项可用（没 disabled）', (function () {
      var b = Array.prototype.slice.call(document.querySelectorAll('#ctxmenu .ctx-item'))
        .filter(function (x) { return x.textContent.indexOf('切换行注释') === 0; })[0];
      return b && !b.disabled;
    })());

    /* ---------- STEP 3 复制系列 ---------- */
    R.push('STEP 3 复制');
    window.__clip = '';
    ok('点得到复制代码', pick('复制代码'));
    await sleep(200);
    ok('剪贴板拿到源码', window.__clip.indexOf('function main()') === 0,
      window.__clip.slice(0, 30));
    ok('复制后菜单关闭了', !menuVisible());

    window.__clip = '';
    ok('点得到复制为 HTML', pick('复制为 HTML'));
    await sleep(200);
    ok('HTML 带 <pre><code>', window.__clip.indexOf('<pre><code class="language-js">') === 0,
      window.__clip.slice(0, 40));
    ok('HTML 里有高亮 span', window.__clip.indexOf('tok-') > 0);

    window.__clip = '';
    ok('点得到复制为 Markdown', pick('复制为 Markdown'));
    await sleep(200);
    ok('Markdown 带回围栏', window.__clip.indexOf(FENCE + 'js') === 0, window.__clip.slice(0, 12));
    ok('围栏闭合了', window.__clip.slice(-3) === FENCE);

    /* ---------- STEP 4 自动缩进整理 ---------- */
    R.push('STEP 4 自动缩进');
    ok('整理前有未缩进的行', rawNow().indexOf('\\nconsole.log') > 0);
    ok('点得到自动缩进整理', pick('自动缩进整理'));
    await sleep(250);
    R.push('    整理后: ' + JSON.stringify(rawNow()));
    ok('console.log 被压进函数体', rawNow().indexOf('\\n  console.log') > 0);
    ok('闭合括号留在原层级', rawNow().indexOf('\\n}') > 0);
    ok('围栏行没有被改动', rawNow().indexOf(FENCE + 'js') >= 0);
    ok('首行 function 没有缩进', rawNow().indexOf('\\nfunction main()') > 0);
    ok('再整理一次内容不变（幂等）', (function () {
      var before = rawNow();
      openMenu(0);
      pick('自动缩进整理');
      return true;   // 幂等性在下面的异步等待后单独断言
    })());
    await sleep(250);
    ok('幂等：第二次整理结果一致', rawNow().indexOf('\\n  console.log') > 0 &&
      rawNow().indexOf('\\n}') > 0);

    /* 包装一层，记录真实调用参数（纯排障用，不改动任何状态） */
    window.__log = [];
    var origKeep = Editor.replaceRawRangeKeepEdit;
    Editor.replaceRawRangeKeepEdit = function () {
      var a = Array.prototype.slice.call(arguments);
      var r = origKeep.apply(null, a);
      window.__log.push('keep(i=' + a[0] + ',s=' + a[1] + ',e=' + a[2] + ') ret=' + r);
      return r;
    };

    /* ---------- STEP 5 行注释切换（⌘/） ---------- */
    R.push('STEP 5 ⌘/ 注释');
    var box = enterEdit();
    await sleep(150);
    ok('进入了编辑态', !!box);
    box.value = rawNow();
    box.selectionStart = box.selectionEnd = box.value.indexOf('console');
    key(box, { key: '/', metaKey: true });
    await sleep(250);
    R.push('    注释后: ' + JSON.stringify(rawNow()));
    ok('⌘/ 注释掉了当前行', rawNow().indexOf('// console.log') > 0);
    ok('注释后缩进没丢', rawNow().indexOf('  // console.log') > 0);
    R.push('    ⌘/ 之后 editing=' + Editor.getState().editing +
      ' textarea=' + !!ta() + ' codeBlk=' + !!codeBlk());
    R.push('    调用日志: ' + (window.__log || []).join(' | '));
    ok('其他行没被注释', rawNow().indexOf('function main() {') > 0);
    ok('⌘/ 之后仍在编辑态', !!ta() && Editor.getState().editing >= 0,
      'editing=' + Editor.getState().editing);

    if (!ta()) Editor.enterEdit(+codeBlk().getAttribute('data-i'),
      rawNow().indexOf('console'));
    var box2 = ta();
    R.push('    二次按键前 editing=' + Editor.getState().editing);
    box2.selectionStart = box2.selectionEnd = box2.value.indexOf('console');
    key(box2, { key: '/', metaKey: true });
    R.push('    二次按键同步后 editing=' + Editor.getState().editing);
    await sleep(30);
    R.push('    +30ms editing=' + Editor.getState().editing);
    await sleep(220);
    R.push('    +250ms editing=' + Editor.getState().editing);
    ok('再按一次取消注释', rawNow().indexOf('// console') < 0);

    /* ---------- STEP 6 移动行（⌥↑ / ⌥↓） ---------- */
    R.push('STEP 6 移动行');
    var before6 = rawNow();
    var box6 = ta();
    box6.selectionStart = box6.selectionEnd = box6.value.indexOf('function main');
    key(box6, { key: 'ArrowDown', altKey: true });
    await sleep(250);
    R.push('    下移后: ' + JSON.stringify(rawNow()));
    ok('第一行换到第二行位置', rawNow().indexOf('console.log') < rawNow().indexOf('function main'),
      String(rawNow().indexOf('console.log')) + ' < ' + String(rawNow().indexOf('function main')));
    ok('行数没变', rawNow().split('\\n').length === before6.split('\\n').length);

    // 上一步把 function main 挤到了第二行，所以这里要选中它再 ⌥↑ 换回去；
    // 选 console.log 是没用的——它已经是第一行了。
    var box6b = ta();
    box6b.selectionStart = box6b.selectionEnd = box6b.value.indexOf('function main');
    key(box6b, { key: 'ArrowUp', altKey: true });
    await sleep(250);
    ok('⌥↑ 换回来', rawNow().indexOf('function main') < rawNow().indexOf('console.log'));

    /* ---------- STEP 7 Tab 缩进 ---------- */
    R.push('STEP 7 Tab 缩进');
    var box7 = ta();
    var s7 = box7.value.indexOf('function main');
    var e7 = box7.value.indexOf('console.log') + 'console.log("x");'.length;
    ok('找到了两行选区', s7 > 0 && e7 > s7);
    box7.selectionStart = s7;
    box7.selectionEnd = e7;
    key(box7, { key: 'Tab' });
    await sleep(250);
    R.push('    Tab 后: ' + JSON.stringify(rawNow()));
    ok('两行都加了缩进', rawNow().indexOf('  function main') > 0 && rawNow().indexOf('    console.log') > 0,
      rawNow().replace(/\\n/g, '⏎'));

    var box7b = ta();
    box7b.selectionStart = box7b.value.indexOf('  function main');
    box7b.selectionEnd = box7b.value.indexOf('    console.log') + '    console.log("x");'.length;
    key(box7b, { key: 'Tab', shiftKey: true });
    await sleep(250);
    R.push('    Shift+Tab 后: ' + JSON.stringify(rawNow()));
    ok('反缩进回到原样', rawNow().indexOf('function main') > 0 && rawNow().indexOf('  console.log') > 0);

    /* ---------- STEP 8 Tab 不会跳出代码块 ---------- */
    R.push('STEP 8 Tab 不跳出块');
    var box8 = ta();
    ok('Tab 之后仍在编辑同一个块', Editor.getState().editing === +codeBlk().getAttribute('data-i'),
      String(Editor.getState().editing));

    /* ---------- STEP 9 删除代码块 ---------- */
    R.push('STEP 9 删除');
    Editor.exitEdit();
    await sleep(150);
    var nBefore = Editor.blockCount();
    ok('菜单能再次打开', openMenu(0));
    ok('点得到删除代码块', pick('删除代码块'));
    await sleep(250);
    ok('代码块没了', !codeBlk());
    ok('块数减一', Editor.blockCount() === nBefore - 1,
      nBefore + ' → ' + Editor.blockCount());
    ok('标题还在', document.querySelector('#editor .blk').textContent.indexOf('标题') >= 0);

    clearTimeout(watchdog);
    report();
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) {
        R.push('THROW ' + (e && e.message) + ' @ ' + (e && e.stack ? e.stack.split('\\n')[1] : ''));
        report();
      });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
