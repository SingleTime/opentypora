// 生成查找替换条的展示截图（无断言）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__find_demo.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/x.md' }); },
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
  '# 查找与替换',
  '',
  '全文按字符偏移匹配，渲染态直接落到块内选区，源码态与分栏态落到 textarea 原生选区。',
  '',
  '支持区分大小写、正则表达式、上下跳转与循环，以及替换当前 / 全部替换。',
  '',
  '替换与撤销共用同一套快照栈，所以替换错了按 ⌘Z 就能回来。'
].join('\n');

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  window.addEventListener('load', async function () {
    try { localStorage.clear(); } catch (e) {}
    await sleep(500);
    Editor.load(${JSON.stringify(DOC)}, null, 'find.md');
    await sleep(250);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, altKey: true, bubbles: true }));
    await sleep(120);
    var q = document.getElementById('fb-q');
    q.value = '替换';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('fb-r').value = '查找并替换';
    await sleep(400);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
