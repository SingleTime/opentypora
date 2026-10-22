// 生成「[TOC] / 标题锚点 / 脚注」集成测试页。
// 在真实 WKWebView 里跑（build/shot），测的是渲染后的真实 DOM。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__doc_harness.html');

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
  '[TOC]',
  '',
  '# 第一章 概述',
  '',
  '跳到底部的[脚注](#fn-def-b) 或 [第二章](#第二章-安装)。',
  '',
  '## 1.1 小节',
  '',
  '正文甲[^b]，正文乙[^a]。',
  '',
  '# 第二章 安装',
  '',
  '## 安装',
  '',
  '重复标题测试段落，用来把页面撑高一些。',
  '',
  '# 安装',
  '',
  '第二个同名标题。',
  '',
  '[^a]: 甲的说明文字',
  '',
  '[^b]: 乙的说明文字，带 **粗体** 与 `代码`',
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
    window.__report = 'DOC ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:680px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 180000);
    await sleep(600);

    R.push('STEP 1 slugify 单元');
    ok('中文标题保留', Doc.slugify('第二章 安装') === '第二章-安装', Doc.slugify('第二章 安装'));
    ok('去标点与行内标记', Doc.slugify('Hello, **World**!') === 'hello-world', Doc.slugify('Hello, **World**!'));
    ok('链接只留文字', Doc.slugify('[标题](http://x)') === '标题', Doc.slugify('[标题](http://x)'));
    ok('空标题有兜底', Doc.slugify('!!!') === 'section', Doc.slugify('!!!'));
    ok('多空格折叠为一个 -', Doc.slugify('a   b') === 'a-b', Doc.slugify('a   b'));

    Editor.load(${JSON.stringify(DOC)}, null, 'doc.md');
    await sleep(300);

    var ed = $('editor');
    R.push('STEP 2 标题锚点');
    var heads = qa('.blk.h1, .blk.h2, .blk.h3', ed);
    ok('识别到 5 个标题', heads.length === 5, String(heads.length));
    var ids = heads.map(function (h) {
      var a = h.querySelector('.h-anchor');
      return a ? a.id : '(none)';
    });
    ok('中文标题拿到 id', ids[0] === '第一章-概述', ids[0]);
    ok('编号里的点被去掉（GitHub 口径）', ids[1] === '11-小节', ids[1]);
    ok('同名标题加 -1 后缀', ids[3] === '安装' && ids[4] === '安装-1', ids[3] + ',' + ids[4]);
    ok('块上打了 data-slug', heads[0].getAttribute('data-slug') === '第一章-概述',
      heads[0].getAttribute('data-slug'));
    ok('锚点不污染标题文本', Doc.textOf(heads[0]) === '第一章 概述', Doc.textOf(heads[0]));

    R.push('STEP 3 [TOC] 目录');
    var body = q('.blk.toc .toc-body', ed);
    ok('[TOC] 已填充', !!body && body.querySelectorAll('a.toc-link').length === 5,
      body ? String(body.querySelectorAll('a.toc-link').length) : 'null');
    var links = qa('.toc-link', ed);
    ok('目录文字与标题一致', links[0].textContent === '第一章 概述', links[0].textContent);
    ok('目录链接指向锚点', links[0].getAttribute('href') === '#第一章-概述', links[0].getAttribute('href'));
    ok('层级嵌套：h2 在 h1 的子 ul 里', !!q('.toc-body > ul > li > ul > li > a', ed));
    var deep = qa('.toc-body > ul > li > ul > li > a', ed);
    ok('子层级第一项是 1.1 小节', deep.length && deep[0].textContent === '1.1 小节',
      deep.length ? deep[0].textContent : 'none');

    R.push('STEP 4 内链跳转');
    var scroller = $('editor-scroll');
    scroller.scrollTop = 0;
    var target = Doc.findAnchor(ed, '第二章-安装');
    ok('findAnchor 能定位到标题', !!target);
    links[2].click();
    await sleep(120);
    ok('点击目录项给目标加高亮', !!target && target.closest('.blk').classList.contains('jump-flash'));
    await sleep(900);
    ok('点击目录项产生滚动', scroller.scrollTop > 0, String(scroller.scrollTop));

    R.push('STEP 5 脚注');
    var refs = qa('.fn-ref', ed);
    ok('识别到 2 个脚注角标', refs.length === 2, String(refs.length));
    ok('按出现顺序编号：先 b 后 a',
      refs[0].getAttribute('data-fn') === 'b' && refs[0].textContent === '1' &&
      refs[1].getAttribute('data-fn') === 'a' && refs[1].textContent === '2',
      refs.map(function (r) { return r.getAttribute('data-fn') + '=' + r.textContent; }).join(' '));
    ok('角标 title 带定义正文', (refs[0].getAttribute('title') || '').indexOf('乙的说明文字') >= 0,
      refs[0].getAttribute('title'));
    var defB = q('#fn-def-b', ed), defA = q('#fn-def-a', ed);
    ok('定义块有 id', !!defB && !!defA);
    ok('定义序号跟随引用顺序', defB.querySelector('.fn-num').textContent === '1' &&
      defA.querySelector('.fn-num').textContent === '2',
      defB.querySelector('.fn-num').textContent + ',' + defA.querySelector('.fn-num').textContent);
    ok('定义正文支持行内格式', !!defB.querySelector('.fn-text strong'));
    defA.scrollTop = 0;
    refs[1].click();
    await sleep(120);
    ok('点角标跳到定义', defA.closest('.blk').classList.contains('jump-flash'));

    R.push('STEP 6 分栏预览一致性');
    Split.enter();
    await sleep(400);
    var pv = $('split-prev-inner');
    var pvLinks = pv ? qa('.toc-link', pv) : [];
    ok('分栏预览也生成目录', pvLinks.length === 5, String(pvLinks.length));
    var pvIds = pv ? qa('.h-anchor', pv).map(function (a) { return a.id; }) : [];
    ok('分栏预览锚点与主编辑器一致',
      pvIds.join(',') === ids.join(','), pvIds.join(',') + ' vs ' + ids.join(','));
    var pvRef = pv ? q('.fn-ref', pv) : null;
    ok('分栏预览脚注也编号', !!pvRef && pvRef.textContent === '1',
      pvRef ? pvRef.textContent : 'null');
    // 预览里点目录项：应当在预览容器内部滚动并高亮，而不是跳去改左侧光标
    var pvLink = pv ? qa('.toc-link', pv)[3] : null;
    ok('分栏目录项可点', !!pvLink);
    if (pvLink) {
      var taBefore = $('split-src').selectionStart;
      pvLink.click();
      await sleep(120);
      ok('分栏预览点目录会高亮目标块',
        !!q('#split-prev-inner .blk.jump-flash', document));
      ok('分栏预览点目录不会抢走左侧光标',
        $('split-src').selectionStart === taBefore,
        taBefore + ' → ' + $('split-src').selectionStart);
    }

    if (Split.isOn()) Split.exit();
    await sleep(200);

    R.push('STEP 6b 导出');
    var exRender = Editor.exportHTML();
    ok('导出 HTML 带填好的目录', exRender.indexOf('toc-link') > 0);
    ok('导出 HTML 带标题锚点', exRender.indexOf('class="h-anchor"') > 0);
    Split.enter();
    await sleep(400);
    var exSplit = Editor.exportHTML();
    ok('分栏状态下导出也带目录（不是空壳）', exSplit.indexOf('toc-link') > 0);
    ok('分栏导出含脚注编号', exSplit.indexOf('fn-ref') > 0 && exSplit.indexOf('fn-def-') > 0);
    Split.exit();
    await sleep(250);

    R.push('STEP 7 源码态与文档变化');
    var tocBlk = q('.blk.toc', $('editor'));
    ok('目录块可被点开', !!tocBlk);
    tocBlk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300 }));
    await sleep(220);
    var taSrc = q('#editor .src');
    ok('点目录块进入源码态并显示 [TOC]', !!taSrc && taSrc.value === '[TOC]',
      taSrc ? JSON.stringify(taSrc.value) : 'null');

    Editor.load('[TOC]\\n\\n# 旧标题\\n\\n正文\\n', null, 'doc2.md');
    await sleep(300);
    ok('重新载入后目录只有 1 项', qa('.toc-link', $('editor')).length === 1);
    ok('目录文字已更新', q('.toc-link', $('editor')).textContent === '旧标题');
    Editor.load('没有标题的文档\\n', null, 'doc3.md');
    await sleep(250);
    ok('无标题时目录给空态提示', qa('.toc-link', $('editor')).length === 0);

    R.push('STEP 8 样式');
    Editor.load(${JSON.stringify(DOC)}, null, 'doc.md');
    await sleep(300);
    var r0 = q('.fn-ref', $('editor'));
    var cs = getComputedStyle(r0);
    ok('角标用强调色', cs.color === 'rgb(9, 105, 218)', cs.color);
    ok('角标是上标且缩小', cs.verticalAlign === 'super' && parseFloat(cs.fontSize) < 14,
      cs.verticalAlign + ' / ' + cs.fontSize);
    var tl = q('.toc-link', $('editor'));
    ok('目录项无下划线', getComputedStyle(tl).textDecorationLine === 'none',
      getComputedStyle(tl).textDecorationLine);
    var fd = q('.fn-def', $('editor'));
    ok('脚注定义是真 flex 行', getComputedStyle(fd).display === 'flex', getComputedStyle(fd).display);
    ok('脚注定义字号小于正文', parseFloat(getComputedStyle(fd).fontSize) < 15,
      getComputedStyle(fd).fontSize);

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
