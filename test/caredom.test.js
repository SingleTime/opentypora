// 光标行几何 · 真 WKWebView 验证（build/shot 跑）
// 纯函数在 caret.test.js；这里验的是「量出来的位置和真实排版对不对得上」：
// 软换行折到第几行、打字机是不是把光标行钉在中间、专注模式的近邻与高亮条。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__caret_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  readText: function () { return Promise.resolve(''); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  saveImage: function () { return Promise.resolve({ path: '/ws/x.png' }); }
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
  function $(id) { return document.getElementById(id); }
  function px(v) { return Math.round(parseFloat(v) * 100) / 100; }
  function ta() { return document.querySelector('#editor .src'); }
  function scroller() { return document.getElementById('editor-scroll'); }

  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'CARET ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:820px;max-height:82vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
    console.log(window.__report);
  }

  // 长到必然折行：中文按字断行，160 个字在 830px 宽里至少 2 行
  var LONG = '';
  for (var k = 0; k < 40; k++) LONG += '这一句专门用来把段落撑到折行，反复重复才够长。';

  // LONG 放在第 9 块：它前面得垫够高度，否则「块首居中」会被
  // scrollTop 夹到 0（文档开头本来就没法把首行放到屏幕中间）。
  // LONG 后面再放几段长文，撑出足够的滚动余量。
  var TAIL = [];
  for (var q = 0; q < 4; q++) TAIL.push(LONG.slice(0, 320));
  var DOC = [
    '# 光标行与打字机',
    '',
    '第一段，站住一个块。',
    '',
    '第二段，也站住一个块。',
    '',
    '第三段。',
    '',
    '第四段。',
    '',
    '第五段。',
    '',
    '第六段。',
    '',
    '第七段。',
    '',
    '第八段。',
    '',
    LONG,                                   // 9
    '',
    TAIL[0], TAIL[1], TAIL[2], TAIL[3],     // 10..13
    '',
    '末尾一段。'                            // 14
  ].join('\\n');
  var LI = 9;   // LONG 的块号

  // 光标行在视口里的位置（相对 #editor-scroll 的顶）
  function rowBox() {
    var t = ta();
    var g = Caret.measure(t);
    if (!g) return null;
    var sr = scroller().getBoundingClientRect();
    var tr = t.getBoundingClientRect();
    return { top: tr.top - sr.top + g.top, h: g.height, vh: sr.height, raw: g };
  }
  function centerGap() {
    var b = rowBox();
    if (!b) return 9999;
    return (b.top + b.h / 2) - b.vh / 2;
  }
  function nearIds() {
    return Array.prototype.map.call(document.querySelectorAll('#editor .blk.near'), function (e) {
      return +e.getAttribute('data-i');
    }).sort(function (a, b) { return a - b; }).join(',');
  }

  async function run() {
    await sleep(420);
    Editor.load(DOC, '/ws/c.md', 'c.md');
    await sleep(200);

    // ---------- STEP 1 镜像测量：软换行也得量对 ----------
    Editor.enterEdit(LI, LONG.length);
    await sleep(80);
    var t = ta();
    var g = Caret.measure(t);
    ok('拿到测量结果', !!g && g.height > 0, JSON.stringify(g));
    ok('行高与 CSS 一致', Math.abs(g.height - parseFloat(getComputedStyle(t).lineHeight)) <= 0.6,
      px(g.height) + ' vs ' + getComputedStyle(t).lineHeight);
    ok('长段确实折行了（不止一行）', t.scrollHeight > g.height * 1.8,
      'scrollH=' + px(t.scrollHeight) + ' lineH=' + px(g.height));

    var totalLines = Math.round(t.scrollHeight / g.height);
    var caretLine = Math.round(g.top / g.height);
    ok('光标在文末 → 落在最后一行', Math.abs(caretLine - (totalLines - 1)) <= 1,
      'caretLine=' + caretLine + ' total=' + totalLines);
    ok('top 是行高的整数倍（没有半行漂移）', Math.abs(g.top - caretLine * g.height) <= 1,
      'top=' + px(g.top) + ' lineH=' + px(g.height));

    t.setSelectionRange(0, 0);
    var g0 = Caret.measure(t);
    ok('光标在开头 → top 归零', Math.abs(g0.top) <= 0.6, px(g0.top));

    var mid = Math.floor(LONG.length / 2);
    t.setSelectionRange(mid, mid);
    var gm = Caret.measure(t);
    ok('光标到中间 → top 变大', gm.top > g0.top, px(g0.top) + ' → ' + px(gm.top));
    ok('中间位置也在整行上', Math.abs(gm.top - Math.round(gm.top / g.height) * g.height) <= 1);
    ok('中间位置不超过内容高度', gm.top < t.scrollHeight, px(gm.top) + ' < ' + px(t.scrollHeight));

    // ---------- STEP 2 打字机：光标行钉在视口中间 ----------
    Editor.setTypewriter(true);
    await sleep(60);
    ok('打字机开关打开', document.body.classList.contains('typewriter-mode'));

    // 先滚到无关的位置，避免「本来就在中间」造成的假绿
    scroller().scrollTop = 0;
    await sleep(40);

    t.setSelectionRange(LONG.length, LONG.length);
    t.dispatchEvent(new Event('keyup'));
    await sleep(120);
    ok('到文末后光标行居中（±2px）', Math.abs(centerGap()) <= 2, 'gap=' + px(centerGap()));

    // 核心回归：同一个块里把光标挪到中间，也必须重新居中。
    // 老实现（整块居中）在这一步不会动，光标会飘到屏幕上半部分。
    t.setSelectionRange(mid, mid);
    t.dispatchEvent(new Event('keyup'));
    await sleep(120);
    var b1 = rowBox();
    ok('块内挪到中间后仍居中（±2px）', Math.abs(centerGap()) <= 2,
      'gap=' + px(centerGap()) + ' rowTop=' + px(b1.top) + ' vh=' + px(b1.vh));

    t.setSelectionRange(0, 0);
    t.dispatchEvent(new Event('keyup'));
    await sleep(120);
    ok('挪到块首仍居中（±2px）', Math.abs(centerGap()) <= 2, 'gap=' + px(centerGap()));

    // 三次的位置必须真的不同 —— 否则只是「恰好都在中间」
    var tops = [];
    for (var p = 0; p < 3; p++) {
      var off = Math.round(LONG.length * p / 3);
      t.setSelectionRange(off, off);
      t.dispatchEvent(new Event('keyup'));
      await sleep(100);
      tops.push(Math.round(scroller().scrollTop));
    }
    ok('随光标往下，滚动位置单调增加', tops[0] <= tops[1] && tops[1] <= tops[2] && tops[2] > tops[0],
      tops.join(' → '));

    // ---------- STEP 3 打字机不会滚出边界 ----------
    Editor.enterEdit(14, Editor.getRaw(14).length);
    await sleep(120);
    var maxScroll = scroller().scrollHeight - scroller().clientHeight;
    ok('最后一块：scrollTop 不越界', scroller().scrollTop <= maxScroll + 1,
      scroller().scrollTop + ' <= ' + maxScroll);
    ok('最后一块：scrollTop 非负', scroller().scrollTop >= 0, String(scroller().scrollTop));

    // ---------- STEP 4 专注模式：近邻与高亮条 ----------
    Editor.setFocus(true);
    Editor.enterEdit(LI, mid);
    await sleep(200);
    ok('专注模式打开', document.body.classList.contains('focus-mode'));
    ok('近邻只有前后两块', nearIds() === (LI - 1) + ',' + (LI + 1), 'got ' + nearIds());
    ok('光标块本身不标 near', document.querySelectorAll('#editor .blk[data-i="' + LI + '"].near').length === 0);

    var line = document.querySelector('#editor .blk[data-i="' + LI + '"] .caret-line');
    ok('编辑块里有高亮条', !!line);
    ok('高亮条不吃鼠标', line && getComputedStyle(line).pointerEvents === 'none',
      line ? getComputedStyle(line).pointerEvents : 'null');
    ok('专注模式下高亮条可见', line && parseFloat(getComputedStyle(line).opacity) > 0.9,
      line ? getComputedStyle(line).opacity : 'null');

    var bb = rowBox();
    var lr = line.getBoundingClientRect();
    var blkR = document.querySelector('#editor .blk[data-i="' + LI + '"]').getBoundingClientRect();
    ok('高亮条压在光标行上（±1.5px）',
      Math.abs((lr.top - blkR.top) - bb.raw.top) <= 1.5,
      'line=' + px(lr.top - blkR.top) + ' caret=' + px(bb.raw.top));
    ok('高亮条高度≈行高（±1.5px）', Math.abs(lr.height - bb.raw.height) <= 1.5,
      px(lr.height) + ' vs ' + px(bb.raw.height));

    // 光标换行 → 高亮条跟着走
    var secondStart = Math.floor(LONG.length / 3);
    t.setSelectionRange(0, 0);
    t.dispatchEvent(new Event('keyup'));
    await sleep(120);
    var topA = parseFloat(line.style.top);
    t.setSelectionRange(secondStart, secondStart);
    t.dispatchEvent(new Event('keyup'));
    await sleep(120);
    var topB = parseFloat(line.style.top);
    ok('光标下行后高亮条下移', topB > topA, px(topA) + ' → ' + px(topB));
    ok('下移量是行高的整数倍',
      Math.abs((topB - topA) - Math.round((topB - topA) / bb.raw.height) * bb.raw.height) <= 1,
      'Δ=' + px(topB - topA) + ' lineH=' + px(bb.raw.height));

    // ---------- STEP 5 近邻随光标块变化 ----------
    Editor.enterEdit(2, 0);
    await sleep(150);
    ok('换到第 2 块 → 近邻变成 1,3', nearIds() === '1,3', 'got ' + nearIds());
    Editor.enterEdit(0, 0);
    await sleep(150);
    ok('换到首块 → 近邻只有 1', nearIds() === '1', 'got ' + nearIds());

    // ---------- STEP 6 关掉专注模式 ----------
    Editor.setFocus(false);
    await sleep(220);
    ok('body 上没有 focus-mode', !document.body.classList.contains('focus-mode'));
    var line2 = document.querySelector('#editor .blk[data-i="0"] .caret-line');
    ok('高亮条还在但不显形（opacity 0）',
      !!line2 && parseFloat(getComputedStyle(line2).opacity) < 0.05,
      line2 ? getComputedStyle(line2).opacity : 'null');

    // ---------- STEP 7 退出编辑后清理 ----------
    Editor.exitEdit();
    await sleep(80);
    ok('退出后没有高亮条残留', document.querySelectorAll('#editor .caret-line').length === 0);
    ok('退出后没有 near 残留', document.querySelectorAll('#editor .blk.near').length === 0);

    // ---------- STEP 8 关掉打字机后不再居中 ----------
    Editor.setTypewriter(false);
    await sleep(60);
    ok('打字机开关关闭', !document.body.classList.contains('typewriter-mode'));
    // 进块时 ta.focus() 本身会把输入框滚进视口，所以不能拿「scrollTop 必须为 0」
    // 当判据；改成量「移动光标前后滚动位置有没有被动过」。
    Editor.enterEdit(LI, LONG.length);
    await sleep(200);
    var before = scroller().scrollTop;
    var t2 = ta();
    t2.setSelectionRange(0, 0);
    t2.dispatchEvent(new Event('keyup'));
    await sleep(150);
    ok('关掉后移动光标不动滚动条（差值 ≤1px）',
      Math.abs(scroller().scrollTop - before) <= 1,
      'before=' + px(before) + ' after=' + px(scroller().scrollTop));

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
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
