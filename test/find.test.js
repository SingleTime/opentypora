// 生成「查找 / 替换」集成测试页：注入 mock 桥 + 断言脚本，在真实 WKWebView 里跑。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__find_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); }
};
</script>
`;

const DOC = [
  '# 查找测试',
  '',
  'alpha beta ALPHA',
  '',
  '行内的 alpha 也要命中，还有 $$E = mc^2$$ 与价格 $5。',
  '',
  '最后一行 alpha 结尾。'
].join('\n');

const TEST = `
<script>
(function () {
  var R = [], t0 = Date.now();
  function ok(name, cond, extra) { R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'FIND ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    document.documentElement.setAttribute('data-report', window.__report);
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:999;margin:0;padding:8px 12px;' +
      'background:#0b0f14;color:#7ee787;font:11.5px/1.5 Menlo,monospace;border-radius:8px;' +
      'max-width:660px;max-height:70vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function key(k, opt) {
    document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opt || {})));
  }
  function typeIn(el, v) {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function countText() { return $('fb-count').textContent; }
  function barOpen() { return $('findbar').classList.contains('show'); }
  function editArea() { return document.querySelector('#editor .src'); }
  function sel() {
    var ta = editArea();
    return ta ? { s: ta.selectionStart, e: ta.selectionEnd, v: ta.value } : null;
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 900000);
    await sleep(600);

    Editor.load(${JSON.stringify(DOC)}, null, 'find.md');
    await sleep(200);

    R.push('STEP 1 打开与基本搜索');
    key('f', { metaKey: true });
    await sleep(60);
    ok('⌘F 打开查找条', barOpen());
    ok('⌘F 只显示查找行', $('fb-replace-row').hidden === true);

    typeIn($('fb-q'), 'alpha');
    await sleep(200);
    ok('不区分大小写：命中 4 处', countText() === '1/4', countText());
    var s1 = sel();
    ok('渲染态：跳到第一个匹配并选中', !!s1 && s1.v.slice(s1.s, s1.e) === 'alpha', s1 ? JSON.stringify(s1.v.slice(s1.s, s1.e)) : 'null');

    R.push('STEP 2 上下跳转');
    $('fb-next').click();
    await sleep(120);
    ok('下一个：计数 2/4', countText() === '2/4', countText());
    var s2 = sel();
    ok('下一个：选中的是大写 ALPHA', !!s2 && s2.v.slice(s2.s, s2.e) === 'ALPHA', s2 ? s2.v.slice(s2.s, s2.e) : 'null');
    $('fb-next').click();
    await sleep(120);
    ok('再下一个：计数 3/4', countText() === '3/4', countText());
    $('fb-next').click();
    await sleep(120);
    ok('第 4 个匹配：4/4', countText() === '4/4', countText());
    $('fb-next').click();
    await sleep(120);
    ok('末尾再下一个：循环回 1/4', countText() === '1/4', countText());
    $('fb-prev').click();
    await sleep(120);
    ok('上一个：从 1 回绕到 4/4', countText() === '4/4', countText());

    R.push('STEP 3 开关');
    $('fb-case').click();
    await sleep(180);
    ok('区分大小写：只剩 3 处', countText() === '1/3', countText());
    ok('开关按钮高亮', $('fb-case').classList.contains('on'));
    $('fb-case').click();
    await sleep(180);

    typeIn($('fb-q'), 'a\\\\w+');
    $('fb-regex').click();
    await sleep(180);
    ok('正则：a\\\\w+ 命中多个单词', /^1\\/[1-9]\\d*$/.test(countText()), countText());

    typeIn($('fb-q'), '(');
    await sleep(200);
    ok('非法正则：给出提示且不崩', countText() === '正则有误', countText());
    ok('非法正则：输入框标红', $('fb-q').classList.contains('bad'));
    $('fb-regex').click();
    await sleep(120);

    R.push('STEP 4 替换');
    key('f', { metaKey: true, altKey: true });
    await sleep(120);
    ok('⌘⌥F 展开替换行', $('fb-replace-row').hidden === false);

    typeIn($('fb-q'), 'alpha');
    await sleep(200);
    ok('替换前 1/4', countText() === '1/4', countText());
    typeIn($('fb-r'), 'omega');
    $('fb-rep').click();
    await sleep(220);
    ok('替换当前：文本已变', Editor.getValue().indexOf('omega beta') >= 0, Editor.getValue().slice(0, 40));
    ok('替换当前：计数变 1/3', countText() === '1/3', countText());

    $('fb-repall').click();
    await sleep(260);
    var txt = Editor.getValue();
    ok('全部替换：alpha 清空', txt.toLowerCase().indexOf('alpha') < 0, txt.slice(0, 60));
    ok('全部替换：4 处变 omega', (txt.match(/omega/g) || []).length === 4, String((txt.match(/omega/g) || []).length));
    ok('全部替换：计数归零', $('fb-count').textContent === '0/0', $('fb-count').textContent);

    R.push('STEP 5 撤销');
    Editor.undo();
    await sleep(140);
    ok('撤销恢复替换前的文本', Editor.getValue().toLowerCase().indexOf('alpha') >= 0, Editor.getValue().slice(0, 40));

    R.push('STEP 6 Escape 与选区带入');
    key('Escape');
    await sleep(100);
    ok('Esc 关闭查找条', !barOpen());
    Editor.load(${JSON.stringify(DOC)}, null, 'find.md');
    await sleep(150);
    var blk = document.querySelectorAll('#editor .blk')[2];
    var rg = document.createRange();
    rg.selectNodeContents(blk);
    var se = window.getSelection();
    se.removeAllRanges(); se.addRange(rg);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(60);
    key('f', { metaKey: true });
    await sleep(150);
    ok('选区自动带进查找框', $('fb-q').value.indexOf('alpha') >= 0, $('fb-q').value.slice(0, 20));

    R.push('STEP 7 源码模式');
    $('fb-q').value = '';
    key('Escape');
    await sleep(80);
    Editor.toggleSource(true);
    await sleep(200);
    key('f', { metaKey: true });
    await sleep(80);
    typeIn($('fb-q'), 'alpha');
    await sleep(200);
    ok('源码模式：命中 4 处', $('fb-count').textContent === '1/4', $('fb-count').textContent);
    var sa = $('source-area');
    ok('源码模式：选区落在 textarea 里', sa.value.slice(sa.selectionStart, sa.selectionEnd) === 'alpha',
       JSON.stringify(sa.value.slice(sa.selectionStart, sa.selectionEnd)));
    typeIn($('fb-r'), 'beta');
    $('fb-rep').click();
    await sleep(220);
    ok('源码模式：替换生效', sa.value.indexOf('beta beta') >= 0, sa.value.slice(0, 30));
    Editor.undo();
    await sleep(150);
    ok('源码模式：撤销生效', sa.value.indexOf('alpha') >= 0, sa.value.slice(0, 30));
    key('Escape');
    Editor.toggleSource(false);
    await sleep(200);

    R.push('STEP 8 分栏模式');
    window.OpenTyporaCmd.toggleSplit();
    await sleep(300);
    key('f', { metaKey: true });
    await sleep(80);
    typeIn($('fb-q'), 'alpha');
    await sleep(220);
    var ss = $('split-src');
    ok('分栏：命中 4 处', $('fb-count').textContent === '1/4', $('fb-count').textContent);
    ok('分栏：选区落在左侧源码里', ss.value.slice(ss.selectionStart, ss.selectionEnd) === 'alpha',
       JSON.stringify(ss.value.slice(ss.selectionStart, ss.selectionEnd)));
    typeIn($('fb-r'), 'gamma');
    $('fb-repall').click();
    await sleep(260);
    ok('分栏：全部替换写回左侧源码', ss.value.toLowerCase().indexOf('alpha') < 0 && (ss.value.match(/gamma/g) || []).length === 4,
       String((ss.value.match(/gamma/g) || []).length));
    ok('分栏：右侧预览同步', $('split-prev-inner').textContent.indexOf('gamma') >= 0);
    key('Escape');
    window.OpenTyporaCmd.toggleSplit();
    await sleep(200);

    clearTimeout(watchdog);
    report();
  }

  window.addEventListener('load', function () {
    window.onerror = function (msg, src, line) {
      R.push('JS错误 ' + msg + ' @' + line);
      if (!window.__report) report();
    };
    run().catch(function (e) {
      R.push('FAIL 脚本异常 | ' + (e && e.message ? e.message : e));
      report();
    });
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
