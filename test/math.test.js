// KaTeX 集成测试：在真实 WKWebView 里跑（build/shot），验证公式渲染的全部约束。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__math_harness.html');

const DOC = [
  '# 公式',
  '',
  '行内 $E=mc^2$ 与求和 $\\sum_{i=1}^{n} i^2$。',
  '',
  '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
  '',
  '$$\\begin{aligned} x &= 1 \\\\ &= 2 \\end{aligned}$$',
  '',
  '$$\\begin{cases} 1 & x>0 \\\\ 0 & x\\le 0 \\end{cases}$$',
  '',
  '$$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$',
  '',
  '坏公式 $\\frac{1}{$ 后面还有正文。',
  '',
  '## 普通段落',
  '',
  '不应受影响。',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__m.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__m.md' }); },
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
  var pass = 0, fail = 0, log = [];
  function ok(c, m) { if (c) { pass++; log.push('ok ' + m); } else { fail++; log.push('FAIL ' + m); } }
  function eq(a, b, m) { ok(a === b, m + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }

  var DOC = JSON.parse(document.getElementById('__doc').textContent);

  function run() {
    Editor.load(DOC, '/tmp/math-test.md', 'math-test.md');
    setTimeout(phase1, 600);
  }

  function phase1() {
    ok(!!window.katex, 'KaTeX 已加载');
    eq(window.katex && window.katex.version, '0.19.0', 'KaTeX 版本');

    var mbs = document.querySelectorAll('.mathblock');
    eq(mbs.length, 4, '块级公式数量');

    var disp = document.querySelectorAll('.katex-display');
    eq(disp.length, 4, 'displayMode 生效（.katex-display）');

    var mb = mbs[0];
    eq(getComputedStyle(mb).textAlign, 'center', '块级公式居中');

    ok(document.querySelectorAll('.mathblock .mtable').length >= 3, '矩阵/对齐/分段有 mtable 结构');
    eq(document.querySelectorAll('.katex').length, 6, '.katex 节点数（4 块 + 2 个正常行内；坏公式只出 katex-error）');

    // 行内公式
    var inls = document.querySelectorAll('.math-inline');
    eq(inls.length, 3, '行内公式数量');
    ok(inls[0].querySelector('.katex'), '行内公式内有 katex');
    ok(!inls[0].querySelector('.katex-display'), '行内公式不是 displayMode');

    // 错误公式：红字降级，且不影响后文
    var err = document.querySelectorAll('.katex-error');
    eq(err.length, 1, '坏公式只产生一个 katex-error');
    ok(err[0] && err[0].textContent.indexOf('frac') >= 0, '错误信息保留了原始命令');
    ok(document.body.textContent.indexOf('后面还有正文') >= 0, '坏公式没有吞掉后文');
    ok(document.body.textContent.indexOf('普通段落') >= 0, '坏公式没有打挂整篇渲染');

    // 字体真的加载了
    var fontOk = false;
    try { fontOk = document.fonts.check('16px KaTeX_Main'); } catch (e) { fontOk = true; }
    ok(fontOk, 'KaTeX_Main 字体可用');

    // 公式不破坏字符偏移映射
    var spans = document.querySelectorAll('.math-inline[data-s]');
    ok(spans.length > 0, '行内公式带 data-s 偏移');
    var ds = spans[0].getAttribute('data-s');
    ok(/^\d+$/.test(ds), 'data-s 是数字偏移');

    phase2();
  }

  function phase2() {
    // 深色主题：颜色应跟随正文，而不是固定黑
    var k = document.querySelector('.mathblock .katex');
    var lightColor = getComputedStyle(k).color;
    Editor.setTheme('night');
    setTimeout(function () {
      var k2 = document.querySelector('.mathblock .katex');
      var darkColor = getComputedStyle(k2).color;
      ok(darkColor !== lightColor, '夜间主题公式颜色跟随变化');
      var m = /rgb\((\d+), (\d+), (\d+)\)/.exec(darkColor);
      ok(m && (+m[1] + +m[2] + +m[3]) > 400, '夜间主题公式是浅色（' + darkColor + '）');

      Editor.setTheme('github');
      setTimeout(phase3, 300);
    }, 300);
  }

  function phase3() {
    // 分栏预览也要渲染公式
    try {
      if (window.Split && Split.enter) Split.enter(); else Editor.setSplitMode(true);
    } catch (e) {}
    setTimeout(function () {
      var prev = document.getElementById('split-prev-inner');
      var n = prev ? prev.querySelectorAll('.katex').length : 0;
      ok(n > 0, '分栏预览里公式已渲染（' + n + ' 个）');

      var mb = prev && prev.querySelector('.mathblock');
      ok(mb && prev.querySelectorAll('.katex-display').length > 0, '分栏里块级公式是 displayMode');

      window.__report = 'MATH ' + pass + '/' + (pass + fail) +
        (fail ? ' | ' + log.filter(function (x) { return x.indexOf('FAIL') === 0; }).join(' ; ') : '');
    }, 900);
  }

  setTimeout(run, 500);
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
