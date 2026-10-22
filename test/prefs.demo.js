// 生成偏好面板的展示截图（无断言）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__prefs_demo.html');

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
  translate: function () { return Promise.resolve({ text: 'x' }); },
  listThemes: function () {
    return Promise.resolve({ dir: '/Users/me/Library/Application Support/OpenTypora/themes',
      themes: [{ id: 'cobalt.css', name: 'cobalt' }, { id: 'solarized.css', name: 'solarized' }] });
  },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  window.addEventListener('load', async function () {
    try { localStorage.clear(); } catch (e) {}
    await sleep(500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
    await sleep(600);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
