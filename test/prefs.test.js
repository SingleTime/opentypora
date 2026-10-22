// 偏好设置 / 自定义主题集成测试：真实 WKWebView + mock 原生桥
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__prefs_harness.html');

const THEME_CSS = [
  ':root { --bg: #101418; --text: #e6edf3; --accent: #58a6ff; }',
  '.editor .blk.h1 { color: #58a6ff; }'
].join('\n');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
/* 改名前的旧键：boot 应当把它搬到 opentypora.* 并删掉旧键（用没别处读的探针键，
 * 免得影响下面各条偏好断言） */
try { localStorage.setItem('typora.__probe', 'v1'); } catch (e) {}
window.__saveCount = 0;
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { window.__saveCount++; return Promise.resolve({ path: '/tmp/__x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); },
  listThemes: function () {
    return Promise.resolve({ dir: '/Users/x/Library/Application Support/OpenTypora/themes',
      themes: [{ id: 'cobalt.css', name: 'cobalt' }] });
  },
  readTheme: function (name) {
    return Promise.resolve({ css: name === 'cobalt.css' ? ${JSON.stringify(THEME_CSS)} : '' });
  },
  openThemeFolder: function () { window.__openedFolder = true; return Promise.resolve(null); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'PREFS ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    document.documentElement.setAttribute('data-report', window.__report);
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:999;margin:0;padding:8px 12px;' +
      'background:#0b0f14;color:#7ee787;font:11.5px/1.5 Menlo,monospace;border-radius:8px;' +
      'max-width:680px;max-height:72vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function prefs() { try { return JSON.parse(localStorage.getItem('opentypora.prefs') || '{}'); } catch (e) { return {}; } }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 900000);
    await sleep(700);

    R.push('STEP 0 改名的旧键迁移');
    ok('旧 typora.* 已搬到 opentypora.*',
       (localStorage.getItem('opentypora.__probe') || '') === 'v1',
       String(localStorage.getItem('opentypora.__probe')));
    ok('旧键已删掉', localStorage.getItem('typora.__probe') == null,
       String(localStorage.getItem('typora.__probe')));

    R.push('STEP 1 打开偏好面板');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
    await sleep(300);
    ok('⌘, 打开面板', $('prefs').classList.contains('show'));
    ok('主题下拉有 6 个内置 + 1 个自定义',
       $('prefs-theme').options.length === 7, String($('prefs-theme').options.length));
    ok('内置主题含 Whitey / Gothic',
       /whitey/.test($('prefs-theme').innerHTML) && /gothic/.test($('prefs-theme').innerHTML));
    ok('自定义主题在 optgroup 里', !!$('prefs-theme').querySelector('optgroup'));
    ok('显示主题目录路径', ($('prefs-themedir').textContent || '').indexOf('OpenTypora/themes') >= 0,
       $('prefs-themedir').textContent);

    R.push('STEP 2 字号与宽度');
    $('prefs-size').value = '19';
    $('prefs-size').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);
    ok('字号变量生效', cssVar('--base-size') === '19px', cssVar('--base-size'));
    ok('正文字号实际变大', parseFloat(getComputedStyle(document.body).fontSize) === 19,
       getComputedStyle(document.body).fontSize);
    ok('字号写进 localStorage', prefs().size === 19, JSON.stringify(prefs().size));

    $('prefs-width').value = '700';
    $('prefs-width').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);
    ok('宽度变量生效', cssVar('--content-width') === '700px', cssVar('--content-width'));
    var ed = getComputedStyle($('editor')).maxWidth;
    ok('编辑区实际宽度跟随', ed === '700px', ed);

    R.push('STEP 3 拼写检查');
    $('prefs-spell').checked = true;
    $('prefs-spell').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    ok('拼写开关写入偏好', prefs().spellcheck === true, String(prefs().spellcheck));
    Editor.enterEdit(0, 0);
    await sleep(120);
    var ta = document.querySelector('#editor .src');
    ok('块内 textarea 打开拼写检查', !!ta && ta.spellcheck === true, ta ? String(ta.spellcheck) : 'null');
    Editor.exitEdit();
    $('prefs-spell').checked = false;
    $('prefs-spell').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    Editor.enterEdit(0, 0);
    await sleep(100);
    var ta2 = document.querySelector('#editor .src');
    ok('关闭后 textarea 不再检查', !!ta2 && ta2.spellcheck === false, ta2 ? String(ta2.spellcheck) : 'null');
    Editor.exitEdit();
    await sleep(80);

    R.push('STEP 4 自动保存开关');
    Editor.load('# t\\n\\nbody', '/tmp/prefs-test.md', 'prefs-test.md');
    await sleep(200);
    $('prefs-autosave').checked = false;
    $('prefs-autosave').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    ok('自动保存偏好已关闭', prefs().autosave === false, String(prefs().autosave));
    var c0 = window.__saveCount;
    Editor.enterEdit(0, 3);
    var ta3 = document.querySelector('#editor .src');
    ta3.value = '# t2\\n\\nbody';
    ta3.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1100);
    ok('关闭后不再写盘', window.__saveCount === c0, c0 + ' → ' + window.__saveCount);
    $('prefs-autosave').checked = true;
    $('prefs-autosave').dispatchEvent(new Event('change', { bubbles: true }));
    var c1 = window.__saveCount;
    ta3.value = '# t3\\n\\nbody';
    ta3.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1100);
    ok('打开后恢复写盘', window.__saveCount > c1, c1 + ' → ' + window.__saveCount);
    Editor.exitEdit();
    await sleep(100);

    R.push('STEP 5 自定义主题');
    $('prefs-theme').value = 'user:cobalt.css';
    $('prefs-theme').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    var st = document.getElementById('user-theme');
    ok('注入了用户主题 <style>', !!st && st.textContent.indexOf('--bg: #101418') >= 0);
    ok('实际背景色变深', getComputedStyle(document.body).backgroundColor === 'rgb(16, 20, 24)',
       getComputedStyle(document.body).backgroundColor);
    ok('基底仍是内置主题', document.documentElement.getAttribute('data-theme') === 'github',
       document.documentElement.getAttribute('data-theme'));
    ok('主题 id 存到 localStorage', (localStorage.getItem('opentypora.theme') || '') === 'user:cobalt.css',
       localStorage.getItem('opentypora.theme'));
    ok('状态栏下拉同步选中', $('theme-select').value === 'user:cobalt.css', $('theme-select').value);

    R.push('STEP 6 切回内置主题');
    $('theme-select').value = 'night';
    $('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    ok('切回内置主题：用户 CSS 被清空', (document.getElementById('user-theme').textContent || '') === '');
    ok('切回内置主题：data-theme=night',
       document.documentElement.getAttribute('data-theme') === 'night');
    ok('风格恢复为 night 背景', getComputedStyle(document.body).backgroundColor === 'rgb(38, 41, 46)',
       getComputedStyle(document.body).backgroundColor);

    R.push('STEP 7 打开主题目录 / 恢复默认');
    $('prefs-openthemes').click();
    await sleep(150);
    ok('打开主题文件夹调用原生', window.__openedFolder === true);
    $('prefs-size').value = '17';
    $('prefs-size').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    $('prefs-reset').click();
    await sleep(200);
    ok('恢复默认字号 15.5', cssVar('--base-size') === '15.5px', cssVar('--base-size'));
    ok('恢复默认宽度 830', cssVar('--content-width') === '830px', cssVar('--content-width'));
    ok('恢复默认不影响主题', (localStorage.getItem('opentypora.theme') || '') === 'night',
       localStorage.getItem('opentypora.theme'));

    R.push('STEP 8 Esc 关闭');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    ok('Esc 关闭面板', !$('prefs').classList.contains('show'));

    R.push('STEP 9 偏好持久化结构');
    var p = prefs();
    ok('localStorage 里有完整偏好', p.size != null && p.width != null &&
       p.autosave != null && p.spellcheck != null, JSON.stringify(p));

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
