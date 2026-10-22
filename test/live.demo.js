// live.demo.js —— 行内实时预览
// 出两张图：docs/opentypora-live.png（浅色）/ docs/opentypora-live-night.png（夜间）
//
// 图的重点是同一块里三种强调同时存在：光标停在斜体里，只有那一对 * 露出来，
// 粗体和删除线仍然是渲染结果 —— 这正是「光标进的段才显形」的意思。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__live_demo.html');
const MODE = process.argv[2] || 'light';

const DOC = [
  '# 行内实时预览',
  '',
  '过去编辑一个块看到的是它的 Markdown 原文：`**粗体**` 就是两颗星。现在标记会被藏起来，',
  '**这一段是粗体**，*这一段是斜体*，~~这一段划掉了~~，看到的就是最终排版的样子。',
  '',
  '光标走进哪一段，那一对标记才重新现身，方便你把它们删掉或者改掉：',
  '',
  '这段**混着来**写，和*别的内容*一起，还有~~划掉的句子~~，光标现在停在斜体里面。',
  '',
  '代码、链接、公式、多行段落仍旧显示原文 —— 那些东西的「标记」里装着真内容，藏了就没法改。',
  '',
  '## 开关',
  '',
  '- 偏好设置 → 编辑 → 行内实时预览'
].join('\n');

const MOCK = `
<script>
try { localStorage.clear(); localStorage.setItem('opentypora.prefs', JSON.stringify({ autosave: false })); } catch (e) {}
window.__DOC = ${JSON.stringify(DOC)};
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/Users/fw/笔记/live.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/Users/fw/笔记/live.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve(null); },
  readFile: function () { return Promise.reject(new Error('x')); },
  listDir: function () { return Promise.resolve({ tree: [] }); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function run() {
    if (${JSON.stringify(MODE)} === 'night') {
      Editor.setTheme('night');
      document.documentElement.setAttribute('data-theme', 'night');
      try { localStorage.setItem('opentypora.theme', 'night'); } catch (e) {}
    }
    Editor.load(window.__DOC, '/Users/fw/笔记/live.md', 'live.md');
    await sleep(200);
    // 按内容找块：空行算 gap，别按行号猜
    var idx = -1, n = Editor.blockCount();
    if (${JSON.stringify(MODE)} === 'head') {
      // 第二张：标题在编辑态、光标停在行首 —— 藏起来的 ## 这时才现形
      for (var j = 0; j < n; j++) {
        if (/^## /.test(Editor.getRaw(j) || '')) { idx = j; break; }
      }
      Editor.enterEdit(idx, 0);
    } else {
      for (var i = 0; i < n; i++) {
        if ((Editor.getRaw(i) || '').indexOf('别的内容') >= 0) { idx = i; break; }
      }
      var raw = Editor.getRaw(idx);
      var at = raw.indexOf('别的内容');
      Editor.enterEdit(idx, at + 2);
    }
    await sleep(260);
    try { document.getElementById('editor-scroll').scrollTop = 60; } catch (e) {}
    await sleep(160);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 80); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (mode=' + MODE + ')');
