// typo.demo.js —— 版式三件套（字体 / 行距 / 背景）
// 出两张图：docs/opentypora-typography.png（宋体 + 松开行距 + 暖纸背景，面板开着）
//           docs/opentypora-typography-night.png（夜间 + 楷体，面板关着看正文）
//
// 走的是真 UI 路径（改表单控件 → 触发 input 事件），不是直接写变量，
// 所以图上看到的就是用户点出来的结果。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__typo_demo.html');
const MODE = process.argv[2] || 'light';

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  spellCheck: function () { return Promise.resolve('[]'); },
  spellGuesses: function () { return Promise.resolve('[]'); }
};
</script>
`;

const DOC = [
  '# 版式是可以调的',
  '',
  '字号和正文宽度早就有了，但真正决定「读起来累不累」的是另外三样：' +
  '字体、行距、背景。它们现在都能在偏好设置里直接看效果，不用去翻 CSS。',
  '',
  '宋体的横细竖粗，在长文里比黑体更像纸；行距松开到 1.9 到 2.0，' +
  '眼睛从行尾折回行首时不容易串行；背景换成偏暖的纸色，' +
  '晚上看白底久了不至于发涩。',
  '',
  '## 三个旋钮各管什么',
  '',
  '- **字体** 只管正文；代码块永远走等宽，不会跟着变。',
  '- **行距** 正文与标题同比缩放，代码块不参与 —— 行号是按固定行高对齐的。',
  '- **背景** 只管正文与面板底色，代码块、侧边栏、选区各有各的颜色。',
  '',
  '```css',
  ':root {',
  '  --font-body: "Songti SC", serif;',
  '  --leading: 1.95;',
  '  --bg: #f7f3ea;',
  '}',
  '```',
  '',
  '调过之后导出的单页 HTML 会带上同一组变量，' +
  '所以「编辑器里长什么样，发出去就是什么样」。',
  ''
].join('\n');

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

  async function run() {
    await sleep(420);
    var mode = '${MODE}';
    if (mode === 'night') {
      try { Editor.setTheme('night'); } catch (e) {}
      await sleep(200);
    }
    Editor.load(${JSON.stringify(DOC)}, '/Users/fw/版式.md', '版式.md');
    await sleep(320);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
    await sleep(280);

    $('prefs-font').value = mode === 'night' ? 'kaiti' : 'songti';
    fire($('prefs-font'), 'change');
    await sleep(120);
    // 滑块 step 是 0.02（从 1.3 起），1.95 会被吸附到 1.96 —— 直接用对齐值
    $('prefs-leading').value = mode === 'night' ? '1.86' : '1.96';
    fire($('prefs-leading'), 'input');
    await sleep(120);
    if (mode !== 'night') {
      $('prefs-bg').value = '#f7f3ea';
      fire($('prefs-bg'), 'input');
      await sleep(120);
    }

    if (mode !== 'panel') {
      // 正文图不留面板：关掉才看得见排版
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(220);
      try { $('editor-scroll').scrollTop = 0; } catch (e) {}
    } else {
      // 面板图把「外观」这一段停在最上面，三个控件都在画面里
      try { document.querySelector('.prefs-body').scrollTop = 0; } catch (e) {}
    }
    await sleep(200);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (mode=' + MODE + ')');
