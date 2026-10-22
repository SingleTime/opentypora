// 生成分栏模式的集成测试页：复制 app/index.html，注入 mock 桥 + 断言脚本。
// 在真实 WKWebView 里跑（借助 build/shot），所以测的是真的 DOM/布局/事件。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__split_harness.html');

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

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function visible(el) { return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; }
  function type(text) {
    var ta = $('split-src');
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function prevText() { return $('split-prev-inner').textContent || ''; }
  function prevBlk(re) {
    var bs = document.querySelectorAll('#split-prev-inner .blk');
    for (var i = 0; i < bs.length; i++) if (re.test(bs[i].textContent)) return bs[i];
    return null;
  }
  function report() {
    window.__report = 'SPLIT ' + R.filter(function (s) { return s.indexOf('PASS') === 0; }).length +
      '/' + R.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;background:#fff;color:#111;' +
      'font:11px/1.5 monospace;padding:8px;border:1px solid #ccc;max-height:40vh;overflow:auto;white-space:pre-wrap';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 40000);
    await sleep(700);

    // 1. 初始不是分栏
    ok('初始为所见即所得模式', !Editor.isSplitMode() && !visible($('split-view')));

    // 2. 进入分栏
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    ok('⌘⇧L 入口可进入分栏', Editor.isSplitMode() && visible($('split-view')));
    ok('分栏时隐藏单栏视图', getComputedStyle($('editor-scroll')).display === 'none');
    ok('状态栏按钮高亮', $('tb-split').classList.contains('on'));
    ok('开关状态已记忆', (function () { try { return localStorage.getItem('opentypora.split') === '1'; } catch (e) { return false; } })());

    // 3. 左侧内容 = 当前文档
    var ta = $('split-src');
    ok('左侧装载了当前文档源码', ta.value.indexOf('# OpenTypora') === 0, clip(ta.value, 24));

    // 4. 右侧已渲染
    ok('右侧渲染出标题/表格/代码块',
      !!prevBlk(/一个从零开始写的 Markdown 编辑器/) && !!document.querySelector('#split-prev-inner table') &&
      !!document.querySelector('#split-prev-inner pre code'),
      'blocks=' + document.querySelectorAll('#split-prev-inner .blk').length);

    // 5. 实时预览
    type(ta.value + '\\n\\n### 新增小节\\n\\n这是边写边看的新段落，含 **粗体** 和 ===高亮===。\\n');
    await sleep(320);
    ok('输入后右侧实时出现新标题', !!prevBlk(/新增小节/) && !!document.querySelector('#split-prev-inner .blk.h3'));
    var mark = document.querySelector('#split-prev-inner .blk.para strong');
    ok('行内解析正常（粗体）', !!mark, mark ? mark.textContent : 'no-strong');

    // 6. 左侧编辑同步进文档模型
    ok('文档内容同步（保存/导出能取到）', Editor.getValue().indexOf('新增小节') >= 0);
    ok('字数统计跟随', /\\d+ 字/.test($('sb-count').textContent), $('sb-count').textContent);

    // 7. 行号
    $('split-wrap').click();          // 关掉软换行 → 显示行号
    await sleep(200);
    var n = ta.value.split('\\n').length;
    var gutterN = $('split-gutter-inner').getAttribute('data-n');
    ok('关换行后显示行号且行数一致', String(n) === String(gutterN) && visible($('split-gutter')), n + ' vs ' + gutterN);
    $('split-wrap').click();          // 恢复到软换行（默认更适合作文）
    await sleep(150);

    // 8. 点预览 → 光标跳到左侧对应位置
    var target = prevBlk(/新增小节/);
    var expected = ta.value.indexOf('### 新增小节');
    target.click();
    await sleep(150);
    ok('点预览块跳到左侧源码位置',
      Math.abs(ta.selectionStart - expected) <= 1,
      ta.selectionStart + ' vs ' + expected);

    // 9. 继续在左侧改，右侧跟随
    ta.value = ta.value.replace('这是边写边看的新段落', '这是**改写后**的段落');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    ok('二次编辑后预览更新', prevText().indexOf('改写后') >= 0 && prevText().indexOf('这是边写边看') < 0);

    // 10. 退出分栏 → 排版视图已是最新
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    ok('退出分栏回到单栏', !Editor.isSplitMode() && !visible($('split-view')));
    ok('单栏内容与分栏里改的一致',
      $('editor').textContent.indexOf('改写后') >= 0 && $('editor').textContent.indexOf('新增小节') >= 0);

    // 11. 分栏下导出 HTML 用左侧源码现渲染
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    var html = Editor.exportHTML();
    ok('分栏状态下导出 HTML 内容正确', html.indexOf('新增小节') >= 0 && html.indexOf('blk h3') >= 0, clip(html.length, 8));

    // 12. ⌘/ 从分栏直接切源码
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
    await sleep(250);
    ok('⌘/ 从分栏切到源码模式',
      !Editor.isSplitMode() && Editor.isSourceMode() && !visible($('split-view')) &&
      $('source-area').value.indexOf('新增小节') >= 0);

    // 13. 源码模式再切回分栏，内容不丢
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    ok('源码模式内容带入分栏',
      Editor.isSplitMode() && $('split-src').value.indexOf('新增小节') >= 0 &&
      !Editor.isSourceMode() && getComputedStyle($('source-area')).display === 'none');

    // 14. 同步滚动开关
    ok('默认开启同步滚动', $('split-sync').checked);
    $('split-sync').click();
    await sleep(80);
    ok('同步滚动可关闭并记忆', !$('split-sync').checked &&
      (function () { try { return localStorage.getItem('opentypora.splitSync') === '0'; } catch (e) { return false; } })());
    $('split-sync').click();
    await sleep(80);

    // 15. 新建文档时分栏内容清空
    window.OpenTyporaCmd.newDoc();
    await sleep(250);
    ok('新建文档同步清空分栏', $('split-src').value === '' && $('split-prev-inner').textContent.indexOf('开始写') >= 0);

    // 16. 分栏里的行内格式快捷键
    type('# 标题\\n\\n选中我');
    await sleep(200);
    ta.setSelectionRange(ta.value.indexOf('选中我'), ta.value.indexOf('选中我') + 3);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
    await sleep(280);
    ok('分栏内 ⌘B 生效', $('split-src').value.indexOf('**选中我**') >= 0, clip(ta.value, 30));

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
