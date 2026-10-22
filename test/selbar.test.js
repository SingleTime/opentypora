// 生成「翻译浮标定位」集成测试页：验证分栏/源码模式下的浮动按钮是否贴在实际选区上。
// 在真实 WKWebView 里跑（build/shot），测的是真的布局坐标。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__selbar_harness.html');

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
  '# 公式推导',
  '',
  '行内公式 $E = mc^2$，独立公式：',
  '',
  '$$',
  '\\frac{\\partial L}{\\partial \\theta} = \\sum_{i=1}^{n} \\left( y_i - \\hat{y}_i \\right)',
  '$$',
  '',
  '最后一段说明文字。'
].join('\n');

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function report() {
    var pass = R.filter(function (s) { return /^\\d+\\. PASS /.test(s); }).length;
    var fail = R.filter(function (s) { return /^\\d+\\. FAIL /.test(s); }).length;
    window.__report = 'SELBAR ' + pass + '/' + (pass + fail) + (fail ? ' FAIL=' + fail : '') +
      '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;background:#fff;color:#111;' +
      'font:11px/1.5 monospace;padding:8px;border:1px solid #ccc;max-height:40vh;overflow:auto;white-space:pre-wrap';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function barRect() { return $('sel-bar').getBoundingClientRect(); }
  // 选中 ta 里 [a,b)，然后像真实拖选一样触发 mouseup
  function selectIn(ta, a, b) {
    ta.focus();
    ta.setSelectionRange(a, b);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  function check(name, ctxMode) {
    var ctx = Editor.selectionContext();
    ok(name + '：拿到选区上下文', !!ctx && ctx.mode === ctxMode, ctx && ctx.mode);
    if (!ctx) return;
    var shown = $('sel-bar').classList.contains('show');
    ok(name + '：浮标出现', shown);
    if (!shown) return;
    var br = barRect(), r = ctx.rect;
    var dx = Math.abs((br.left + br.width / 2) - (r.left + r.width / 2));
    ok(name + '：浮标水平居中对齐选区', dx <= 12,
      'dx=' + dx.toFixed(1) + ' bar=' + Math.round(br.left) + ',' + Math.round(br.top) +
      ' sel=' + Math.round(r.left) + '..' + Math.round(r.left + r.width));
    ok(name + '：浮标在选区正上方且不重叠',
      br.bottom <= r.top + 1 && r.top - br.bottom <= 14,
      'gap=' + (r.top - br.bottom).toFixed(1));
    ok(name + '：浮标在可视区内', br.top >= 0 && br.left >= 0 &&
      br.bottom <= window.innerHeight + 1 && br.right <= window.innerWidth + 1,
      Math.round(br.left) + ',' + Math.round(br.top));
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 40000);
    await sleep(600);

    R.push('STEP 1 分栏模式');
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    var ta = $('split-src');
    ta.value = ${JSON.stringify(DOC)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // 选中 \frac 那一行的中段（就是用户截图里的场景）
    var line = '\\\\frac{\\\\partial L}{\\\\partial \\\\theta}';
    var i = ta.value.indexOf(line);
    ok('找到公式行', i >= 0);
    selectIn(ta, i + 8, i + 8 + 26);
    await sleep(120);
    check('分栏', 'split');

    // 选一个较短的片段，浮标也不该跑到行首
    var j = ta.value.indexOf('\\\\sum_{i=1}^{n}');
    selectIn(ta, j, j + 15);
    await sleep(120);
    check('分栏短选区', 'split');

    // 在分栏右侧预览里做真实 DOM 选区：这里最容易回归（预览是独立容器）
    var pv = $('split-prev-inner');
    var b1 = pv ? pv.querySelector('.blk[data-i="1"]') : null;
    var sp0 = b1 ? b1.querySelector('[data-s]') : null;
    ok('分栏预览已渲染且行内偏移为绝对值', !!b1 && !!sp0 && +sp0.getAttribute('data-s') > 0,
      sp0 ? 'data-s=' + sp0.getAttribute('data-s') : 'null');
    if (b1) {
      var tn = null, w0 = document.createTreeWalker(b1, NodeFilter.SHOW_TEXT, null), c0;
      while ((c0 = w0.nextNode())) { if (c0.nodeValue.indexOf('行内公式') >= 0) { tn = c0; break; } }
      ok('预览里找到纯文本节点', !!tn, tn ? JSON.stringify(tn.nodeValue.slice(0, 10)) : 'null');
      if (tn) {
        var s0 = tn.nodeValue.indexOf('行内公式');
        var rg = document.createRange();
        rg.setStart(tn, s0);
        rg.setEnd(tn, s0 + 4);
        var ss = window.getSelection();
        ss.removeAllRanges();
        ss.addRange(rg);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        // 真实拖选结束后浏览器还会补一个 click，必须在选区还在时就跑掉，
        // 否则 click → jumpToSource 会把焦点交给左侧 textarea，选区被收掉
        (tn.parentNode || b1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(140);
        var c4 = Editor.selectionContext();
        ok('分栏预览：拿到选区上下文', !!c4 && c4.mode === 'split-preview', c4 && c4.mode);
        ok('分栏预览：选区区段与源码一致',
          !!c4 && ta.value.slice(c4.docStart, c4.docEnd) === c4.text,
          c4 ? JSON.stringify(ta.value.slice(c4.docStart, c4.docEnd)) : '-');
        ok('分栏预览：浮标出现', $('sel-bar').classList.contains('show'));
        if (c4) {
          var br4 = barRect(), r4 = c4.rect;
          var dx4 = Math.abs((br4.left + br4.width / 2) - (r4.left + r4.width / 2));
          ok('分栏预览：浮标水平居中', dx4 <= 12, 'dx=' + dx4.toFixed(1));
          ok('分栏预览：浮标在选区上方且不重叠',
            br4.bottom <= r4.top + 1 && r4.top - br4.bottom <= 14,
            'gap=' + (r4.top - br4.bottom).toFixed(1));
          var before = ta.value.length;
          var okr = Editor.replaceSplitDocRange(c4.docStart, c4.docEnd, '译文', c4.text);
          await sleep(220);
          ok('分栏预览：按偏移替换写回源码', okr && ta.value.length === before - 4 + 2,
            'len ' + before + '→' + ta.value.length);
          ok('替换后源码含译文', ta.value.indexOf('译文') >= 0);
          // expect 对不上时必须拒绝，防止错位改写
          var bad = Editor.replaceSplitDocRange(0, 4, 'X', '绝不可能匹配的原文');
          ok('原文不符时拒绝替换', bad === false);
        }
      }
    }

    R.push('STEP 3 源码模式');    window.OpenTyporaCmd.toggleSplit();
    await sleep(150);
    Editor.toggleSource(true);
    await sleep(200);
    var sa = $('source-area');
    var k = sa.value.indexOf(line);
    ok('源码模式找到公式行', k >= 0);
    selectIn(sa, k + 8, k + 8 + 26);
    await sleep(120);
    check('源码', 'source');

    R.push('STEP 4 跨行选区');
    var frac = sa.value.indexOf('\\\\partial L');
    var qq = sa.value.lastIndexOf('$$', frac);
    ok('定位到公式块', frac > 0 && qq > 0, 'frac=' + frac + ' qq=' + qq);
    var a = qq + 1, b = frac + 20;
    selectIn(sa, a, b);
    await sleep(120);
    var rect3 = Editor.selectionRectInTextarea(sa);
    ok('跨行选区测量细节', true, rect3 ? JSON.stringify({
      l: Math.round(rect3.left), r: Math.round(rect3.right),
      t: Math.round(rect3.top), b: Math.round(rect3.bottom),
      w: Math.round(rect3.width), same: rect3.sameLine
    }) : 'null');
    ok('跨行选区文本', true, JSON.stringify(sa.value.slice(a, Math.min(b, a + 30))));
    var c2 = Editor.selectionContext();
    ok('跨行选区有矩形', !!c2 && c2.rect.width > 100, c2 ? Math.round(c2.rect.width) : 'null');
    var br2 = barRect();
    ok('跨行选区浮标水平居中整栏',
      !!c2 && Math.abs((br2.left + br2.width / 2) - (c2.rect.left + c2.rect.width / 2)) <= 12,
      c2 ? 'dx=' + Math.abs((br2.left + br2.width / 2) - (c2.rect.left + c2.rect.width / 2)).toFixed(1) : '-');

    clearTimeout(watchdog);
    report();
  }

  window.addEventListener('load', function () {
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
