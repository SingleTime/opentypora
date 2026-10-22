// 生成「flowchart.js 图表」集成测试页（WKWebView）。
// flow.js 是同步出 SVG 的纯函数，但「渲染进 DOM / 隐藏源码 / 换主题重画」
// 这些行为必须在真实 WebView 里验证。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__flow_harness.html');

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
  '# 流程图示例',
  '',
  '```flow',
  'st=>start: 开始',
  'op=>operation: 处理数据',
  'cond=>condition: 是否通过?',
  'io=>inputoutput: 写入结果',
  'e=>end: 结束',
  '',
  'st->op->cond',
  'cond(yes)->io->e',
  'cond(no)->op',
  '```',
  '',
  '图之间的说明段落。',
  '',
  '```flowchart',
  'a=>start: A',
  'b=>end: B',
  'a->|分支|->b',
  '```',
  '',
  '```flow',
  'a=>start: A',
  'a->ghost',
  '```',
  '',
  '```javascript',
  'const a = 1;',
  '```',
  ''
].join('\n');

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0 }).length;
    window.__report = 'FLOW ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:680px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 60000);
    await sleep(400);

    Editor.load(${JSON.stringify(DOC)}, null, 'flow.md');
    await sleep(600);   // 同步渲染，给一帧余量

    var ed = $('editor');
    R.push('STEP 1 成功的图');
    var figs = qa('.flow-fig', ed);
    ok('两个合法图都产出了 SVG 容器', figs.length === 2, String(figs.length));
    ok('渲染成功的块打上 flow-on', qa('.blk.flow-on', ed).length === 2,
      String(qa('.blk.flow-on', ed).length));
    var svg1 = figs[0] ? figs[0].querySelector('svg') : null;
    ok('SVG 真的画出来了', !!svg1);
    ok('图里含节点文字「开始」', !!svg1 && String(svg1.textContent).indexOf('开始') >= 0,
      svg1 ? String(svg1.textContent).slice(0, 40) : 'null');
    ok('菱形判断节点用 polygon', !!svg1 && svg1.querySelectorAll('polygon').length >= 1);
    ok('起止节点是圆角矩形', !!svg1 && svg1.querySelectorAll('rect[rx]').length >= 2,
      svg1 ? String(svg1.querySelectorAll('rect[rx]').length) : 'null');
    ok('边是 path 且带箭头', !!svg1 && svg1.querySelectorAll('path[marker-end]').length >= 4,
      svg1 ? String(svg1.querySelectorAll('path[marker-end]').length) : 'null');
    ok('分支标签 yes 在图上', !!svg1 && String(svg1.textContent).indexOf('yes') >= 0);
    var svg2 = figs[1] ? figs[1].querySelector('svg') : null;
    ok('flowchart 别名也渲染', !!svg2);
    ok('管道标签「分支」在图上', !!svg2 && String(svg2.textContent).indexOf('分支') >= 0);

    R.push('STEP 2 源码必须保留');
    var codes = qa('#editor pre > code.language-flow, #editor pre > code.language-flowchart', ed);
    ok('三段流程图源码都还在（隐藏而非删除）', codes.length === 3, String(codes.length));
    ok('隐藏用 CSS 而不是移除节点',
      codes.length > 0 && getComputedStyle(codes[0].parentNode).display === 'none',
      codes.length ? getComputedStyle(codes[0].parentNode).display : 'null');
    ok('模型里源码没被改写', Editor.getText().indexOf('st=>start: 开始') > 0);

    R.push('STEP 3 语法错误不能炸');
    var errBlk = q('.blk.flow-err', ed);
    ok('坏图被标成 flow-err', !!errBlk);
    ok('坏图没有生成 SVG', !!errBlk && !errBlk.querySelector('.flow-fig'));
    ok('坏图的源码仍然可见',
      !!errBlk && getComputedStyle(errBlk.querySelector('pre')).display !== 'none',
      errBlk ? getComputedStyle(errBlk.querySelector('pre')).display : 'null');
    var msg = errBlk ? errBlk.querySelector('.flow-msg') : null;
    ok('给出可读的错误提示', !!msg && msg.textContent.indexOf('Flowchart:') === 0 &&
      msg.textContent.indexOf('ghost') > 0,
      msg ? msg.textContent.slice(0, 60) : 'null');

    R.push('STEP 4 普通代码块不受影响');
    var jsBlk = null;
    qa('#editor .blk.code', ed).forEach(function (b) {
      if (b.querySelector('code.language-javascript')) jsBlk = b;
    });
    ok('javascript 块仍是原样代码块', !!jsBlk && !jsBlk.querySelector('.flow-fig'));
    ok('javascript 块没有 flow-on', !!jsBlk && !jsBlk.classList.contains('flow-on'));
    ok('javascript 块的 pre 可见', !!jsBlk && getComputedStyle(jsBlk.querySelector('pre')).display !== 'none');

    R.push('STEP 5 缓存');
    ok('SVG 进了缓存', Object.keys(Flow._cache).length >= 2, String(Object.keys(Flow._cache).length));

    R.push('STEP 6 换主题要重画');
    var beforeSig = Flow.themeSig();
    var beforeFill = svg1 ? (svg1.querySelector('rect') || {}).getAttribute &&
      svg1.querySelector('rect').getAttribute('fill') : null;
    Editor.setTheme('night');
    try { Flow.refresh(); } catch (e) {}
    await sleep(300);
    var afterSig = Flow.themeSig();
    ok('主题签名变了', beforeSig !== afterSig, beforeSig + ' → ' + afterSig);
    ok('换主题后图还在', qa('#editor .flow-fig', ed).length === 2,
      String(qa('#editor .flow-fig', ed).length));
    var svg1b = q('#editor .flow-fig svg');
    var afterFill = svg1b ? svg1b.querySelector('rect').getAttribute('fill') : null;
    ok('深色主题换了填充色', beforeFill !== afterFill, beforeFill + ' → ' + afterFill);
    ok('坏图换主题后依然标错', qa('#editor .blk.flow-err', ed).length === 1,
      String(qa('#editor .blk.flow-err', ed).length));

    R.push('STEP 7 分栏预览同一套装饰');
    Editor.setTheme('github');
    try { Flow.refresh(); } catch (e) {}
    Split.enter();
    await sleep(600);
    var pv = $('split-prev-inner');
    ok('分栏预览里也画出了图', !!pv && qa('.flow-fig', pv).length >= 1,
      pv ? String(qa('.flow-fig', pv).length) : 'null');
    ok('分栏预览里的图是 SVG', !!pv && !!q('.flow-fig svg', pv));
    ok('分栏预览坏图也标了错', !!pv && qa('.flow-err', pv).length === 1,
      pv ? String(qa('.flow-err', pv).length) : 'null');
    if (Split.isOn()) Split.exit();
    await sleep(300);

    R.push('STEP 8 导出 HTML 带图');
    var html = Editor.exportHTML();
    ok('导出 HTML 里带 SVG', html.indexOf('<svg') > 0);
    // 源码在 DOM 里是转义后存放的（=> 变成 =&gt;）
    ok('导出里仍有源码（便于二次编辑）',
      html.indexOf('st=&gt;start: 开始') > 0 || html.indexOf('st=>start: 开始') > 0,
      html.indexOf('开始') > 0 ? '有节点文字' : '连节点文字都没有');

    clearTimeout(watchdog);
    report();
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) {
        R.push('THROW ' + (e && e.message));
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
