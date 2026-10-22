// 版式三件套（字体 / 行距 / 背景）：真实 WKWebView 集成测试
// 重点是真排版引擎算出来的东西：字体族有没有真落到段落上、行高倍数是不是
// 按字号折成了像素、标题有没有同比缩放、代码块有没有被带跑、换主题会不会
// 把自定义背景冲掉。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__typodom_harness.html');

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
  spellCheck: function () { return Promise.resolve('[]'); },
  spellGuesses: function () { return Promise.resolve('[]'); }
};
</script>
`;

const DOC = [
  '# 版式标题',
  '',
  '正文一段，用来量行高与字体。The quick brown fox jumps over the lazy dog.',
  '',
  '## 二级标题',
  '',
  '第二段正文。',
  '',
  '```js',
  'var coloumn = 1;',
  'var second = 2;',
  '```'
].join('\n');

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function prefs() { try { return JSON.parse(localStorage.getItem('opentypora.prefs') || '{}'); } catch (e) { return {}; } }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.6 : tol); }
  function lhOf(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var cs = getComputedStyle(el);
    return { lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize), fam: cs.fontFamily };
  }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'TYPODOM ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:999;margin:0;padding:8px 12px;' +
      'background:#0b0f14;color:#7ee787;font:11.5px/1.5 Menlo,monospace;border-radius:8px;' +
      'max-width:720px;max-height:74vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 900000);
    await sleep(800);
    if (Editor.isSplitMode && Editor.isSplitMode()) { try { Split.exit(); } catch (e) {} await sleep(300); }
    Editor.load(${JSON.stringify(DOC)}, '/tmp/typo.md', 'typo.md');
    await sleep(400);

    R.push('STEP 1 面板与默认值');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
    await sleep(350);
    ok('⌘, 打开面板', $('prefs').classList.contains('show'));
    ok('字体下拉有 8 个预设', $('prefs-font').options.length === 8, String($('prefs-font').options.length));
    ok('默认选中系统默认', $('prefs-font').value === 'system', $('prefs-font').value);
    ok('自定义字体输入行默认隐藏', $('prefs-font-row').style.display === 'none',
       $('prefs-font-row').style.display);
    ok('行距滑块默认 1.72', parseFloat($('prefs-leading').value) === 1.72, $('prefs-leading').value);
    ok('行距读数显示 1.72', $('prefs-leading-val').textContent === '1.72', $('prefs-leading-val').textContent);
    // --font-body 在 :root 里有兜底值，所以「不覆盖」的表现是「等于 app.css 的那串」，
    // 不是空串 —— 空串只可能出现在行内被清掉之后
    var DEF_FONT = cssVar('--font-body');
    ok('默认可读到的 --font-body 是 app.css 的系统栈', /PingFang SC/.test(DEF_FONT), DEF_FONT);
    ok('无自定义背景时色块禁用', $('prefs-bg').disabled === true);
    ok('色块显示当前主题背景', $('prefs-bg').value.toLowerCase() === '#ffffff', $('prefs-bg').value);
    var base = lhOf('.blk.para');
    ok('正文字号 15.5', near(base.fs, 15.5, 0.1), String(base.fs));
    ok('正文行高 1.72 倍', near(base.lh, 15.5 * 1.72), base.lh + ' vs 26.66');
    ok('默认字体是系统栈', /-apple-system|PingFang SC/.test(base.fam), base.fam);

    R.push('STEP 2 换字体：宋体');
    $('prefs-font').value = 'songti';
    $('prefs-font').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    ok('--font-body 写上宋体栈', /Songti SC/.test(cssVar('--font-body')), cssVar('--font-body'));
    var song = lhOf('.blk.para');
    ok('段落真的用了宋体', /Songti SC/.test(song.fam), song.fam);
    ok('标题也跟着换', /Songti SC/.test(lhOf('.blk.h1').fam), lhOf('.blk.h1').fam);
    ok('代码块仍是等宽', /mono|Menlo|SF Mono/.test(lhOf('.blk.code pre code').fam), lhOf('.blk.code pre code').fam);
    ok('字体写进偏好', prefs().font === 'songti', JSON.stringify(prefs().font));
    ok('自定义输入行仍然隐藏', $('prefs-font-row').style.display === 'none');
    ok('换字体不动行距', cssVar('--leading') === '1.72', cssVar('--leading'));

    R.push('STEP 3 自定义字体族');
    $('prefs-font').value = 'custom';
    $('prefs-font').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    ok('选自定义后输入行出现', $('prefs-font-row').style.display !== 'none',
       $('prefs-font-row').style.display);
    $('prefs-font-custom').value = "'Baskerville', Georgia, serif";
    $('prefs-font-custom').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    ok('自定义栈生效', /Baskerville/.test(lhOf('.blk.para').fam), lhOf('.blk.para').fam);
    ok('偏好存成 custom: 前缀', String(prefs().font).indexOf('custom:') === 0, JSON.stringify(prefs().font));
    // 注意：不能用 cssVar('--font-body') 断言「没有双引号」—— CSSOM 序列化
    // 自定义属性时会把字符串一律改写成双引号，读回来必然带 "。真正要紧的是
    // 落进偏好的原文（导出直接用它拼 style 属性）。
    ok('偏好里的自定义栈不含双引号', String(prefs().font).indexOf('"') < 0, JSON.stringify(prefs().font));
    ok('偏好里的自定义栈仍是单引号', String(prefs().font).indexOf("'Baskerville'") > 0,
       JSON.stringify(prefs().font));

    R.push('STEP 4 行距');
    var h1Before = lhOf('.blk.h1');
    var codeBefore = lhOf('.blk.code pre code');
    $('prefs-leading').value = '2.1';
    $('prefs-leading').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    ok('--leading 写成 2.1', cssVar('--leading') === '2.1', cssVar('--leading'));
    var p2 = lhOf('.blk.para');
    ok('正文行高 = 2.1 × 字号', near(p2.lh, p2.fs * 2.1), p2.lh + ' vs ' + (p2.fs * 2.1));
    ok('--lh-scale 同步', Math.abs(parseFloat(cssVar('--lh-scale')) - 1.2209) < 0.001, cssVar('--lh-scale'));
    var h1After = lhOf('.blk.h1');
    ok('标题行高同比放大', near(h1After.lh / h1After.fs, 1.3 * 1.2209, 0.02),
       (h1After.lh / h1After.fs) + ' vs ' + (1.3 * 1.2209));
    ok('标题放大前是 1.3 倍', near(h1Before.lh / h1Before.fs, 1.3, 0.02), h1Before.lh / h1Before.fs);
    var codeAfter = lhOf('.blk.code pre code');
    ok('代码块行高不跟着变', near(codeAfter.lh, codeBefore.lh, 0.05),
       codeBefore.lh + ' → ' + codeAfter.lh);
    ok('行距写进偏好', parseFloat(prefs().leading) === 2.1, JSON.stringify(prefs().leading));
    ok('读数显示 2.10', $('prefs-leading-val').textContent === '2.10', $('prefs-leading-val').textContent);

    R.push('STEP 5 背景色');
    $('prefs-bg').value = '#101418';
    $('prefs-bg').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    ok('--bg 写成自定义色', cssVar('--bg') === '#101418', cssVar('--bg'));
    ok('body 背景真的变深', getComputedStyle(document.body).backgroundColor === 'rgb(16, 20, 24)',
       getComputedStyle(document.body).backgroundColor);
    ok('偏好存了大写无关的色值', prefs().bg === '#101418', JSON.stringify(prefs().bg));
    ok('「跟随主题」按钮可点了', $('prefs-bg-reset').disabled === false);

    R.push('STEP 6 换主题不冲掉自定义背景');
    $('prefs-theme').value = 'night';
    $('prefs-theme').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    ok('主题确实换成 night', document.documentElement.getAttribute('data-theme') === 'night',
       document.documentElement.getAttribute('data-theme'));
    ok('自定义背景仍然压着主题', cssVar('--bg') === '#101418', cssVar('--bg'));
    ok('色块仍是自定义色', $('prefs-bg').value.toLowerCase() === '#101418', $('prefs-bg').value);

    R.push('STEP 7 跟随主题');
    $('prefs-bg-reset').click();
    await sleep(250);
    ok('清掉自定义背景变量', cssVar('--bg') === '#26292e', cssVar('--bg'));
    ok('body 回到 night 的底色', getComputedStyle(document.body).backgroundColor === 'rgb(38, 41, 46)',
       getComputedStyle(document.body).backgroundColor);
    ok('偏好里 bg 清空', (prefs().bg || '') === '', JSON.stringify(prefs().bg));
    ok('色块重新禁用', $('prefs-bg').disabled === true);
    ok('色块改为显示主题色', $('prefs-bg').value.toLowerCase() === '#26292e', $('prefs-bg').value);

    R.push('STEP 8 拖字号不会把版式冲掉');
    $('prefs-size').value = '18';
    $('prefs-size').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    ok('字号变了', near(lhOf('.blk.para').fs, 18, 0.1), String(lhOf('.blk.para').fs));
    ok('行距还在 2.1', cssVar('--leading') === '2.1', cssVar('--leading'));
    ok('自定义字体还在', /Baskerville/.test(cssVar('--font-body')), cssVar('--font-body'));
    var p3 = lhOf('.blk.para');
    ok('行高随字号重算', near(p3.lh, 18 * 2.1), p3.lh + ' vs ' + (18 * 2.1));

    R.push('STEP 9 恢复默认');
    $('prefs-reset').click();
    await sleep(350);
    ok('字体回到系统默认', $('prefs-font').value === 'system', $('prefs-font').value);
    ok('--font-body 回到 app.css 的系统栈', cssVar('--font-body') === DEF_FONT,
       cssVar('--font-body'));
    ok('行距回到 1.72', cssVar('--leading') === '1.72', cssVar('--leading'));
    ok('--lh-scale 回到 1', cssVar('--lh-scale') === '1', cssVar('--lh-scale'));
    ok('背景回到主题色', cssVar('--bg') === '#26292e', cssVar('--bg'));
    ok('偏好里的三项都回到默认',
       (prefs().font === 'system' || prefs().font === '') &&
       parseFloat(prefs().leading) === 1.72 && (prefs().bg || '') === '',
       JSON.stringify([prefs().font, prefs().leading, prefs().bg]));
    ok('自定义输入行又藏起来', $('prefs-font-row').style.display === 'none');

    R.push('STEP 10 导出的单页带上版式');
    $('prefs-font').value = 'kaiti';
    $('prefs-font').dispatchEvent(new Event('change', { bubbles: true }));
    $('prefs-leading').value = '1.9';
    $('prefs-leading').dispatchEvent(new Event('input', { bubbles: true }));
    $('prefs-bg').value = '#101418';
    $('prefs-bg').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(250);
    var html = Export.htmlDoc('<p>x</p>', {
      title: 'T', font: prefs().font, leading: prefs().leading, bg: prefs().bg
    });
    ok('导出 HTML 带 --font-body', /--font-body:'Kaiti SC'/.test(html), html.split('\\n')[1]);
    ok('导出 HTML 带 --leading:1.9', html.indexOf('--leading:1.9') > 0);
    ok('导出 HTML 带 --bg', html.indexOf('--bg:#101418') > 0);
    ok('导出 HTML 的 style 属性没被引号截断',
       /style="--font-body:'Kaiti SC'[^"]*"/.test(html), html.split('\\n')[1]);

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
console.log('harness → ' + path.relative(ROOT, OUT));
