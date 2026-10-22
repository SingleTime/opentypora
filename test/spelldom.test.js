// 渲染态拼写波浪线 · 真 WKWebView 验证（build/shot 跑）
//
// 纯函数在 spell.test.js，原生词典在 test/spell/main.swift。
// 这里验的是 DOM 那一层：包出来的 span 位置对不对、代码块有没有被误伤、
// data-s 算出来的偏移能不能真的改到正文、右键菜单点下去词有没有换掉。
//
// 词典用桩：真词典会随系统版本变（macOS 会记住用户"学过"的词），
// 断言不能建在它上面。桩只认固定几个词，这样每个用例都可复现。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__spelldom_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve(null); },
  saveAs: function () { return Promise.resolve(null); },
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
  function q(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function spans() { return q('#editor .spell-bad'); }
  function texts() { return spans().map(function (s) { return s.textContent; }).join(','); }

  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'SPELL ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:860px;max-height:84vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
    console.log(window.__report);
  }

  // 桩词典：只认这几个词（小写比较）
  var BAD = { speling: 1, coloumn: 1, recieve: 1, seperate: 1, occured: 1 };
  var SUG = { recieve: ['receive', 'relieve'], coloumn: ['column'], occured: ['occurred'], seperate: ['separate'] };
  var CALLS = [];
  function stubEngine(words, ignore) {
    CALLS.push(words.slice());
    var out = [];
    words.forEach(function (w, i) {
      if (BAD[w.toLowerCase()] && (ignore || []).indexOf(w.toLowerCase()) < 0) out.push(i);
    });
    return Promise.resolve(out);
  }

  var DOC = [
    '# Speling issues',                              // 0  标题里也标
    '',
    'The coloumn recieve teh siggnals from the sensor.',   // 2  普通段落
    '',
    'A **seperate** word inside bold.',              // 4  行内嵌套
    '',
    'Inline \\u0060coloumn\\u0060 code span must be skipped.',   // 6  行内代码跳过
    '',
    '\\u0060\\u0060\\u0060js\\nconst coloumn = 1;\\n\\u0060\\u0060\\u0060',      // 8  围栏代码跳过
    '',
    '这一句只有中文，没有英文单词。',                    // 10 纯中文
    '',
    'A [seperate](http://example.com) link.'          // 12 链接文字
  ].join('\\n');

  async function run() {
    await sleep(420);
    Spell._reset();
    Spell.setEngine(stubEngine);
    Spell.setGuesses(function (w) {
      return Promise.resolve(SUG[w] || []);
    });
    Editor.load(DOC, '/ws/s.md', 's.md');
    await sleep(120);

    // ---------- STEP 1 开关 ----------
    ok('默认是关的（偏好里 spellcheck=false）', Spell.isEnabled() === false, String(Spell.isEnabled()));
    ok('关着的时候一个波浪线都没有', spans().length === 0, String(spans().length));

    Spell.setEnabled(true);
    await sleep(260);

    // ---------- STEP 2 标对了没有 ----------
    ok('开关打开后确实上色了', spans().length > 0, String(spans().length));
    ok('标的是五个词（标题1 + 段落2 + 粗体1 + 链接1）', spans().length === 5, texts());
    ok('文档顺序：Speling,coloumn,recieve,seperate,seperate',
      texts() === 'Speling,coloumn,recieve,seperate,seperate', texts());
    ok('行内代码里的 coloumn 没被标', q('#editor code .spell-bad').length === 0);
    ok('围栏代码块一个字都没碰',
      q('#editor .blk.code .spell-bad').length === 0,
      String(q('#editor .blk.code .spell-bad').length));
    ok('纯中文段落没被标', q('#editor .blk[data-i="10"] .spell-bad').length === 0);
    ok('正确词 teh/siggnals 没被标（桩不认就放过）', texts().indexOf('teh') < 0);

    // ---------- STEP 3 样式：真的是波浪线 ----------
    var sp = spans()[1];
    var cs = getComputedStyle(sp);
    ok('下划线', cs.textDecorationLine === 'underline', cs.textDecorationLine);
    ok('波浪', cs.textDecorationStyle === 'wavy', cs.textDecorationStyle);
    ok('跳过 skip-ink', cs.textDecorationSkipInk === 'none' || cs.textDecorationSkipInk === '',
      String(cs.textDecorationSkipInk));
    var v = getComputedStyle(document.documentElement).getPropertyValue('--spell').trim();
    ok('颜色取主题变量', v === '#d1242f', v);
    ok('不占布局（不改变行高）',
      Math.abs(parseFloat(cs.lineHeight) - parseFloat(getComputedStyle(q('#editor .blk[data-i="2"]')[0]).lineHeight)) < 0.6,
      cs.lineHeight);

    // ---------- STEP 4 请求只发一次、词不重复 ----------
    ok('问过引擎', CALLS.length >= 1, String(CALLS.length));
    var first = CALLS[0] || [];
    var uniq = {};
    var dup = 0;
    first.forEach(function (w) { if (uniq[w]) dup++; uniq[w] = 1; });
    ok('请求里的词没有重复', dup === 0, 'dup=' + dup + ' n=' + first.length);
    ok('请求里带上错词', first.indexOf('coloumn') >= 0 && first.indexOf('recieve') >= 0, first.join(','));
    ok('没有把中文或代码塞进请求',
      first.every(function (w) { return /^[A-Za-z']+$/.test(w); }), first.join(','));

    var before = CALLS.length;
    Editor.render();
    await sleep(200);
    ok('重画一遍不再问引擎（走缓存）', CALLS.length === before,
      before + ' → ' + CALLS.length + '，缓存 ' + Spell.cacheSize());
    ok('重画后波浪线还在', spans().length === 5, texts());

    // ---------- STEP 5 偏移：能不能改到正文那一处 ----------
    // md.js 是逐块 parse 的，data-s 是**块内**偏移 —— 定位必须带块号，
    // 按全篇算会差出前面所有块的长度（同词出现两次就会改错地方）。
    var bad = 0, detail = [];
    spans().forEach(function (s) {
      var w = s.textContent;
      var i = Spell.blockIndexOf(s);
      var off = Spell.rawOffset(s);
      var raw = i >= 0 ? Editor.getRaw(i) : '';
      var hit = i >= 0 && off != null && raw.substr(off, w.length) === w;
      if (!hit) { bad++; detail.push(w + '@blk' + i + '+' + off); }
    });
    ok('每个波浪线的块内偏移都精确命中 raw', bad === 0, detail.join(' '));
    ok('块号认得出来', Spell.blockIndexOf(spans()[1]) === 1, String(Spell.blockIndexOf(spans()[1])));

    // ---------- STEP 6 编辑态不重复画 ----------
    // 块 1 是「The coloumn recieve…」（块 0 是标题）
    Editor.enterEdit(1, 0);
    await sleep(180);
    ok('编辑块里没有波浪线（交给 textarea 原生检查）',
      q('#editor .blk.editing .spell-bad').length === 0,
      String(q('#editor .blk.editing .spell-bad').length));
    ok('编辑时其余块照样标', q('#editor .blk:not(.editing) .spell-bad').length === 3,
      String(q('#editor .blk:not(.editing) .spell-bad').length));

    Editor.exitEdit();
    await sleep(220);
    ok('退出编辑后那一块重新标上', q('#editor .blk[data-i="1"] .spell-bad').length === 2,
      String(q('#editor .blk[data-i="1"] .spell-bad').length));

    // ---------- STEP 7 右键菜单 + 采纳建议 ----------
    var target = spans().filter(function (s) { return s.textContent === 'recieve'; })[0];
    ok('找得到 recieve 那个波浪线', !!target);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 220 }));
    await sleep(120);
    var menu = document.querySelector('.spell-menu');
    ok('右键弹出菜单', !!menu);
    ok('菜单标题是那个词', menu && menu.querySelector('.spell-menu-head').textContent === 'recieve',
      menu ? menu.querySelector('.spell-menu-head').textContent : 'null');
    var items = menu ? Array.prototype.map.call(menu.querySelectorAll('.spell-menu-item'), function (b) { return b.textContent; }) : [];
    ok('菜单里有建议词', items.indexOf('receive') >= 0, items.join('|'));
    ok('菜单里还有「忽略」', items.some(function (t) { return t.indexOf('忽略') === 0; }), items.join('|'));

    var sug = menu ? Array.prototype.filter.call(menu.querySelectorAll('.spell-menu-item'), function (b) {
      return b.textContent === 'receive';
    })[0] : null;
    ok('建议项是个按钮', !!sug && sug.tagName === 'BUTTON', sug ? sug.tagName : 'null');
    sug.click();
    await sleep(240);
    ok('点建议后正文被替换', Editor.getText().indexOf('receive teh siggnals') > 0, Editor.getText().split('\\n')[2]);
    ok('旧词已经不在正文里', Editor.getText().indexOf('recieve') < 0);
    ok('替换后菜单自动关掉', !document.querySelector('.spell-menu'));

    // ---------- STEP 8 忽略 ----------
    var n0 = spans().length;
    var col = spans().filter(function (s) { return s.textContent === 'coloumn'; })[0];
    ok('还有一个 coloumn 挂着', !!col, texts());
    Spell.ignore('coloumn');
    await sleep(200);
    ok('忽略后 coloumn 不再标', !spans().some(function (s) { return s.textContent === 'coloumn'; }), texts());
    ok('忽略不影响别的词', spans().length === n0 - 1, n0 + ' → ' + spans().length);
    ok('忽略表里有了它', Spell.ignoreList().indexOf('coloumn') >= 0, Spell.ignoreList().join(','));
    ok('忽略的词记成"对"进缓存', Spell.cacheGet('coloumn') === 0, String(Spell.cacheGet('coloumn')));

    var again = CALLS.length;
    Editor.render();
    await sleep(180);
    ok('忽略后重画也不会再问这个词', CALLS.length === again, again + ' → ' + CALLS.length);

    // ---------- STEP 9 关掉就全清 ----------
    var n1 = spans().length;
    Spell.setEnabled(false);
    await sleep(150);
    ok('关掉后没有残留波浪线', spans().length === 0, String(spans().length));
    ok('关掉前确实有', n1 > 0, String(n1));
    ok('文本没被开关搞坏（复原成纯文本）',
      q('#editor .blk[data-i="0"]')[0].textContent.indexOf('Speling issues') >= 0);

    Spell.setEnabled(true);
    await sleep(300);
    ok('重新打开又标上了', spans().length > 0, texts());

    // ---------- STEP 10 同一个词出现两次：只能改点中的那一处 ----------
    // data-s 是块内偏移，如果按全篇算，第二次出现的词会被改成第一处 —— 正是这条回归。
    Editor.load('one occured here\\n\\nand occured there', '/ws/t.md', 't.md');
    await sleep(320);
    var both = spans().filter(function (s) { return s.textContent === 'occured'; });
    ok('两段里的 occured 都标了', both.length === 2, texts());
    ok('两次出现分属不同块',
      Spell.blockIndexOf(both[0]) !== Spell.blockIndexOf(both[1]),
      Spell.blockIndexOf(both[0]) + ' vs ' + Spell.blockIndexOf(both[1]));

    var second = both[1];
    second.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    await sleep(120);
    var m2 = document.querySelector('.spell-menu');
    var b2 = m2 ? Array.prototype.filter.call(m2.querySelectorAll('.spell-menu-item'), function (b) {
      return b.textContent === 'occurred';
    })[0] : null;
    ok('第二处的菜单给出了 occurred', !!b2, m2 ? m2.textContent : 'no menu');
    if (b2) b2.click();
    await sleep(240);
    ok('只有第二段被改', Editor.getText().indexOf('and occurred there') > 0, Editor.getText());
    ok('第一段原样不动', Editor.getText().indexOf('one occured here') === 0, Editor.getText());

    report();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) { R.push('THROW ' + e + '\\n' + (e && e.stack)); report(); });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', () => MOCK + TEST + '\n</body>');
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
