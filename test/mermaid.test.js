// 生成「Mermaid 图表」集成测试页。
// mermaid 需要真实布局与 DOM 测量，node 里跑不了，必须在 WKWebView 里测。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__mmd_harness.html');

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
  '# 图表示例',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[结束]',
  '  B -->|否| D[循环]',
  '```',
  '',
  '两个图之间的说明段落。',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  Alice->>Bob: 你好',
  '  Bob-->>Alice: 收到',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  '  X --> ',
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
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'MMD ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:680px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function figOf(i) {
    var blks = qa('#editor .blk');
    for (var k = 0; k < blks.length; k++) {
      if (blks[k].querySelector('code.language-mermaid') &&
          !blks[k].classList.contains('mermaid-err')) {
        if (i === 0) return blks[k];
        i--;
      }
    }
    return null;
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 180000);
    await sleep(500);

    R.push('STEP 0 库是懒加载的');
    ok('初始没有注入 mermaid 脚本',
      !qa('script[src*="mermaid"]').length,
      String(qa('script[src*="mermaid"]').length));

    Editor.load(${JSON.stringify(DOC)}, null, 'mmd.md');
    await sleep(2200);   // 首次要注入 3.4MB 脚本并解析

    var ed = $('editor');
    R.push('STEP 1 成功的图');
    var figs = qa('.mermaid-fig', ed);
    ok('两个合法图都产出了 SVG 容器', figs.length === 2, String(figs.length));
    ok('渲染成功的块打上 mermaid-on',
      qa('.blk.mermaid-on', ed).length === 2,
      String(qa('.blk.mermaid-on', ed).length));
    ok('SVG 真的画出来了', !!q('.mermaid-fig svg', ed));
    var svg1 = figs[0] ? figs[0].querySelector('svg') : null;
    ok('图里含节点文字「开始」',
      !!svg1 && String(svg1.textContent).indexOf('开始') >= 0,
      svg1 ? String(svg1.textContent).slice(0, 40) : 'null');
    ok('含连线路径', !!svg1 && svg1.querySelectorAll('path').length > 0,
      svg1 ? String(svg1.querySelectorAll('path').length) : 'null');
    ok('SVG 用 viewBox 缩放而不是靠改 width',
      !!svg1 && !!svg1.getAttribute('viewBox'),
      svg1 ? svg1.getAttribute('viewBox') : 'null');

    R.push('STEP 2 源码必须保留');
    var codes = qa('#editor pre > code.language-mermaid', ed);
    ok('三段 mermaid 源码都还在（隐藏而非删除）', codes.length === 3, String(codes.length));
    ok('第一段源码内容完好',
      codes.length > 0 && codes[0].textContent.indexOf('flowchart LR') === 0,
      codes.length ? JSON.stringify(codes[0].textContent.slice(0, 18)) : 'null');
    ok('隐藏用 CSS 而不是移除节点',
      codes.length > 0 && getComputedStyle(codes[0].parentNode).display === 'none',
      codes.length ? getComputedStyle(codes[0].parentNode).display : 'null');
    ok('模型里源码没被改写',
      Editor.getText().indexOf('flowchart LR') > 0);

    R.push('STEP 3 语法错误不能炸');
    var errBlk = q('.blk.mermaid-err', ed);
    ok('坏图被标成 mermaid-err', !!errBlk);
    ok('坏图没有生成 SVG', !!errBlk && !errBlk.querySelector('.mermaid-fig'));
    ok('坏图的源码仍然可见',
      !!errBlk && getComputedStyle(errBlk.querySelector('pre')).display !== 'none',
      errBlk ? getComputedStyle(errBlk.querySelector('pre')).display : 'null');
    var msg = errBlk ? errBlk.querySelector('.mermaid-msg') : null;
    ok('给出可读的错误提示', !!msg && msg.textContent.indexOf('Mermaid:') === 0,
      msg ? msg.textContent.slice(0, 60) : 'null');
    ok('报错不影响其它块渲染', qa('.mermaid-fig', ed).length === 2);

    R.push('STEP 4 普通代码块不受影响');
    var jsBlk = null;
    qa('#editor .blk.code', ed).forEach(function (b) {
      if (b.querySelector('code.language-javascript')) jsBlk = b;
    });
    ok('javascript 块仍是原样代码块', !!jsBlk && !jsBlk.querySelector('.mermaid-fig'));
    ok('javascript 块没有 mermaid-on', !!jsBlk && !jsBlk.classList.contains('mermaid-on'));

    R.push('STEP 5 缓存');
    var keys = Object.keys(Diagram._cache).length;
    ok('两个图的 SVG 进了缓存', keys >= 2, String(keys));

    R.push('STEP 6 换主题要重画');
    var beforeSig = Diagram.themeSig();
    Editor.setTheme('night');
    try { Diagram.refresh(); } catch (e) {}
    await sleep(1800);
    var afterSig = Diagram.themeSig();
    ok('主题签名变了', beforeSig !== afterSig, beforeSig + ' → ' + afterSig);
    ok('换主题后图还在', qa('#editor .mermaid-fig', ed).length === 2,
      String(qa('#editor .mermaid-fig', ed).length));
    ok('换主题后依然是 SVG', !!q('#editor .mermaid-fig svg', ed));

    R.push('STEP 7 分栏预览同一套装饰');
    Editor.setTheme('github');
    Split.enter();
    await sleep(2000);
    var pv = $('split-prev-inner');
    ok('分栏预览里也画出了图', !!pv && qa('.mermaid-fig', pv).length >= 1,
      pv ? String(qa('.mermaid-fig', pv).length) : 'null');
    ok('分栏预览里的图是 SVG', !!pv && !!q('.mermaid-fig svg', pv));
    ok('分栏预览坏图也标了错', !!pv && qa('.mermaid-err', pv).length === 1,
      pv ? String(qa('.mermaid-err', pv).length) : 'null');
    // 退出分栏，后面按单栏继续
    if (Split.isOn()) Split.exit();
    await sleep(400);

    R.push('STEP 8 导出');
    var html = Editor.exportHTML();
    ok('导出 HTML 里带 SVG', html.indexOf('<svg') > 0);
    // 源码现在被高亮了，'flowchart LR' 不再连续（关键字被 span 包住），
    // 所以按「language-mermaid 的 code 里仍有 flowchart 与 LR 两个词」来判
    ok('导出里仍有源码（便于二次编辑）',
      /<code class="language-mermaid">/.test(html) &&
      html.indexOf('flowchart') > 0 && html.indexOf('>LR</span>') > 0);

    clearTimeout(watchdog);
    report();

    var imgs = qa('.mermaid-fig svg').length;
    window.__report += '\\n(页面内 SVG 数：' + imgs + ')';
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
