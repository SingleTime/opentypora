// 生成「翻译浮标贴合选区」的演示页（无断言，仅用于截图归档对比）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__selbar_demo.html');

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
  translate: function () { return Promise.resolve({ text: 'x' }); }
};
</script>
`;

const DOC = [
  '# 公式推导',
  '',
  '行内公式 $E = mc^2$，独立公式：',
  '',
  '$$',
  '\\frac{\\partial L}{\\partial \\theta} = \\sum_{i=1}^{n} \\left( y_i - \\hat{y}_i \\right)',
  '$$',
  '',
  '最后一段说明文字。'
].join('\n');

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  window.addEventListener('load', async function () {
    try { localStorage.clear(); } catch (e) {}
    await sleep(500);
    window.OpenTyporaCmd.toggleSplit();
    await sleep(250);
    var ta = document.getElementById('split-src');
    ta.value = ${JSON.stringify(DOC)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(250);
    // 选中公式行的中段
    var line = '\\\\frac{\\\\partial L}{\\\\partial \\\\theta}';
    var i = ta.value.indexOf(line);
    ta.focus();
    ta.setSelectionRange(i, i + 34);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(300);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
