// 源码模式高亮层 · 真 WKWebView 验证（build/shot 跑）
// 纯函数在 srcmode.test.js；这里只测「排版真的重合」这件事：
// 文字起点、行高节奏、滚动同步、输入后重画、退出后清理。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__srcmode_harness.html');

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
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'SRCMODE ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:760px;max-height:80vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
    console.log(window.__report);
  }

  var DOC = [
    '# 源码模式测试',
    '',
    '一段正文，里面有 **粗体**、*斜体* 和 一个很长的行用来检查横向滚动是不是真的不折行 ' + 'x'.repeat(160),
    '',
    '> 引用一行',
    '',
    '- 列表一',
    '- 列表二',
    '',
    '\\u0060\\u0060\\u0060js',
    'const a = 1; // 注释',
    '\\u0060\\u0060\\u0060',
    '',
    '结尾'
  ].join('\\n');

  async function run() {
    await sleep(420);
    document.documentElement.setAttribute('data-theme', 'github');
    Editor.load(DOC, '/ws/s.md', 's.md');
    await sleep(200);

    var ta = $('source-area'), hl = $('source-hl');

    // ---------- STEP 1 进源码模式 ----------
    Editor.toggleSource(true);
    await sleep(220);
    ok('textarea 显示', ta.style.display === 'block', ta.style.display);
    ok('高亮层显示', hl.hidden === false && !hl.hasAttribute('hidden'));
    ok('高亮层不吃鼠标', getComputedStyle(hl).pointerEvents === 'none', getComputedStyle(hl).pointerEvents);
    ok('textarea 文字透明', /rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(ta).color), getComputedStyle(ta).color);
    ok('光标颜色不是透明', getComputedStyle(ta).caretColor !== 'rgba(0, 0, 0, 0)', getComputedStyle(ta).caretColor);
    // 赋值会把光标丢到文末；进来必须停在开头，否则一进源码模式就对着最后一行的尾部
    ok('进源码模式停在开头', ta.selectionStart === 0 && ta.scrollTop === 0 && ta.scrollLeft === 0,
      'sel=' + ta.selectionStart + ' top=' + ta.scrollTop + ' left=' + ta.scrollLeft);

    // ---------- STEP 2 行数与行号 ----------
    var rows = hl.querySelectorAll('.sl');
    var want = DOC.split('\\n').length;
    ok('行数对上', rows.length === want, rows.length + ' vs ' + want);
    ok('首行行号是 1', rows[0].querySelector('.sl-n').textContent === '1');
    ok('末行行号对', rows[rows.length - 1].querySelector('.sl-n').textContent === String(want),
      rows[rows.length - 1].querySelector('.sl-n').textContent);
    ok('行号连续', (function () {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].querySelector('.sl-n').textContent !== String(i + 1)) return false;
      }
      return true;
    })());
    ok('空行也占一行', rows[1].querySelector('.sl-t').textContent === '\\u200b',
      JSON.stringify(rows[1].querySelector('.sl-t').textContent));
    ok('标题行被上色', rows[0].querySelector('.sl-t').innerHTML.indexOf('tok-') >= 0,
      rows[0].querySelector('.sl-t').innerHTML);
    ok('围栏行被上色', rows[9].querySelector('.sl-t').innerHTML.indexOf('tok-meta') >= 0,
      rows[9].querySelector('.sl-t').innerHTML);

    // ---------- STEP 3 两层逐字符对齐（核心） ----------
    var cs = getComputedStyle(ta), ch = getComputedStyle(hl);
    ok('字号一致', cs.fontSize === ch.fontSize, cs.fontSize + ' / ' + ch.fontSize);
    ok('行高一致', cs.lineHeight === ch.lineHeight, cs.lineHeight + ' / ' + ch.lineHeight);
    ok('字体一致', cs.fontFamily === ch.fontFamily, cs.fontFamily + ' / ' + ch.fontFamily);
    ok('tab-size 一致', cs.tabSize === ch.tabSize, cs.tabSize + ' / ' + ch.tabSize);
    ok('不折行（pre）', cs.whiteSpace === 'pre' && ch.whiteSpace === 'pre', cs.whiteSpace + ' / ' + ch.whiteSpace);

    var taRect = ta.getBoundingClientRect();
    var textX_ta = taRect.left + parseFloat(cs.paddingLeft);
    var slRect = rows[0].getBoundingClientRect();
    var textX_hl = rows[0].querySelector('.sl-t').getBoundingClientRect().left;
    ok('文字左起点重合（±0.6px）', Math.abs(textX_ta - textX_hl) <= 0.6,
      'ta=' + px(textX_ta) + ' hl=' + px(textX_hl) + ' 差=' + px(textX_ta - textX_hl));

    var textY_ta = taRect.top + parseFloat(cs.paddingTop);
    ok('首行上沿重合（±0.6px）', Math.abs(slRect.top - textY_ta) <= 0.6,
      'ta=' + px(textY_ta) + ' hl=' + px(slRect.top) + ' 差=' + px(slRect.top - textY_ta));

    ok('行高节奏＝CSS 行高', Math.abs(slRect.height - parseFloat(cs.lineHeight)) <= 0.6,
      px(slRect.height) + ' vs ' + cs.lineHeight);

    var lh = parseFloat(cs.lineHeight);
    var n = Math.min(6, rows.length);
    var drift = Math.abs(rows[n - 1].getBoundingClientRect().top - (slRect.top + lh * (n - 1)));
    ok('前 6 行无累积漂移（±0.6px）', drift <= 0.6, 'drift=' + px(drift));

    // 整篇高度：两层应当一致（long line 不折行，所以只有行数决定高度）
    // textarea 的横向滚动条会从 clientHeight 里吃掉十几 px，所以给 20px 余量
    ok('两层内容高度接近（±20px）', Math.abs(ta.scrollHeight - hl.scrollHeight) <= 20,
      'ta=' + ta.scrollHeight + ' hl=' + hl.scrollHeight);

    // ---------- STEP 4 行号列不压文字 ----------
    var gut = rows[0].querySelector('.sl-n').getBoundingClientRect();
    ok('行号列在文字左边', gut.right <= textX_hl + 0.6, 'gut.right=' + px(gut.right) + ' text=' + px(textX_hl));
    ok('行号右对齐', getComputedStyle(rows[0].querySelector('.sl-n')).textAlign === 'right');

    // ---------- STEP 5 滚动同步 ----------
    ta.scrollTop = 120;
    ta.scrollLeft = 60;
    ta.dispatchEvent(new Event('scroll'));
    await sleep(60);
    ok('纵向滚动同步', Math.abs(hl.scrollTop - ta.scrollTop) <= 1, 'ta=' + ta.scrollTop + ' hl=' + hl.scrollTop);
    ok('横向滚动同步', Math.abs(hl.scrollLeft - ta.scrollLeft) <= 1, 'ta=' + ta.scrollLeft + ' hl=' + hl.scrollLeft);
    ok('行号列粘住左边', (function () {
      var g = rows[2].querySelector('.sl-n').getBoundingClientRect();
      return g.left >= hl.getBoundingClientRect().left - 0.6;
    })());
    ta.scrollTop = 0; ta.scrollLeft = 0;
    ta.dispatchEvent(new Event('scroll'));
    await sleep(40);

    // ---------- STEP 6 输入后重画 ----------
    var before = rows.length;
    ta.value = DOC + '\\n新增一行';
    ta.dispatchEvent(new Event('input'));
    await sleep(120);
    rows = hl.querySelectorAll('.sl');
    ok('输入后行数增加', rows.length === before + 1, before + ' → ' + rows.length);
    ok('新行内容进高亮层', rows[rows.length - 1].querySelector('.sl-t').textContent === '新增一行',
      rows[rows.length - 1].querySelector('.sl-t').textContent);
    ok('新行拿对行号', rows[rows.length - 1].querySelector('.sl-n').textContent === String(rows.length));

    // 连打多个字符只重画一次（rAF 合帧）：这里只验「不丢最后一帧」
    for (var k = 0; k < 5; k++) {
      ta.value = ta.value + '!';
      ta.dispatchEvent(new Event('input'));
    }
    await sleep(120);
    var lastRow = hl.querySelectorAll('.sl')[rows.length - 1];
    ok('连续输入后末行仍同步', lastRow.querySelector('.sl-t').textContent === '新增一行!!!!!',
      lastRow.querySelector('.sl-t').textContent);

    // ---------- STEP 7 退出源码模式 ----------
    Editor.toggleSource(false);
    await sleep(180);
    ok('高亮层隐藏', hl.hidden === true);
    ok('高亮层内容清空', hl.innerHTML === '', String(hl.innerHTML.length));
    ok('编辑器回来了', $('editor').style.display !== 'none', $('editor').style.display);
    ok('body 不再是 source-mode', !document.body.classList.contains('source-mode'));
    ok('内容带回了改的那一行', Editor.getText().indexOf('新增一行!!!!!') >= 0);

    // 再进一次：不残留上一轮的旧行
    Editor.toggleSource(true);
    await sleep(150);
    ok('重进后行号重新从 1 开始',
      hl.querySelectorAll('.sl')[0].querySelector('.sl-n').textContent === '1');
    ok('重进后行数正确', hl.querySelectorAll('.sl').length === Editor.getText().split('\\n').length,
      hl.querySelectorAll('.sl').length + ' vs ' + Editor.getText().split('\\n').length);

    // ---------- STEP 8 长文档：真的撑出滚动条，验同步与行号粘边 ----------
    Editor.toggleSource(false);
    await sleep(140);
    var LONG = [];
    for (var i = 1; i <= 150; i++) LONG.push('第 ' + i + ' 行：用来撑高滚动条的正文，' + 'y'.repeat(i % 40));
    LONG.push('长行：' + 'z'.repeat(400));
    Editor.load(LONG.join('\\n'), '/ws/long.md', 'long.md');
    await sleep(220);
    Editor.toggleSource(true);
    await sleep(240);

    ok('长文档行数正确', hl.querySelectorAll('.sl').length === 151, String(hl.querySelectorAll('.sl').length));
    ok('纵向真的可滚', ta.scrollHeight > ta.clientHeight + 100,
      ta.scrollHeight + ' vs ' + ta.clientHeight);
    ok('横向真的可滚', ta.scrollWidth > ta.clientWidth + 100,
      ta.scrollWidth + ' vs ' + ta.clientWidth);

    ta.scrollTop = 600;
    ta.dispatchEvent(new Event('scroll'));
    await sleep(80);
    ok('长文档纵向同步', Math.abs(hl.scrollTop - ta.scrollTop) <= 1,
      'hl=' + hl.scrollTop + ' ta=' + ta.scrollTop);
    var firstTop = hl.querySelectorAll('.sl')[0].getBoundingClientRect().top - hl.getBoundingClientRect().top;
    ok('内容确实滚上去了', firstTop < -300, 'firstTop=' + px(firstTop));

    var gut0 = hl.querySelectorAll('.sl')[0].querySelector('.sl-n').getBoundingClientRect().left;
    ta.scrollLeft = 220;
    ta.dispatchEvent(new Event('scroll'));
    await sleep(80);
    ok('长文档横向同步', Math.abs(hl.scrollLeft - ta.scrollLeft) <= 1,
      'hl=' + hl.scrollLeft + ' ta=' + ta.scrollLeft);
    var gut1 = hl.querySelectorAll('.sl')[0].querySelector('.sl-n').getBoundingClientRect().left;
    ok('横滚时行号粘住不动', Math.abs(gut1 - gut0) <= 1.5,
      'before=' + px(gut0) + ' after=' + px(gut1) + ' hlLeft=' + px(hl.getBoundingClientRect().left) +
      ' hlSL=' + hl.scrollLeft + ' hlCW=' + hl.clientWidth + ' padL=' + getComputedStyle(hl).paddingLeft);

    // 横滚后文字仍与 textarea 对齐（sticky 只挪行号，不动正文）
    var tRect = ta.getBoundingClientRect(), h = rows0();
    ok('横滚后正文 x 仍未偏移', Math.abs(h - (tRect.left + parseFloat(getComputedStyle(ta).paddingLeft) - 220)) <= 1.5,
      'hl=' + px(h) + ' 期望≈' + px(tRect.left + parseFloat(getComputedStyle(ta).paddingLeft) - 220));

    report();
  }

  function rows0() {
    var hl = document.getElementById('source-hl');
    return hl.querySelectorAll('.sl')[0].querySelector('.sl-t').getBoundingClientRect().left;
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
