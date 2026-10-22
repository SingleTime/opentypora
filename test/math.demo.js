// 生成公式演示页（真实 index.html + mock 桥），用于截图与视觉验证
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__math_demo.html');

const DOC = [
  '# 公式渲染',
  '',
  '行内：质能方程 $E=mc^2$，求和 $\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}$，积分 $\\int_0^1 x\\,dx = \\frac{1}{2}$。',
  '',
  '## 矩阵',
  '',
  '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\begin{pmatrix} ax+by \\\\ cx+dy \\end{pmatrix}$$',
  '',
  '## 多行推导',
  '',
  '$$\\begin{aligned} (a+b)^2 &= a^2 + 2ab + b^2 \\\\ &= a^2 + b^2 + 2ab \\end{aligned}$$',
  '',
  '## 分段函数',
  '',
  '$$|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}$$',
  '',
  '## 极限与希腊字母',
  '',
  '$$\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e, \\quad \\alpha\\beta\\gamma\\Delta\\Omega$$',
  '',
  '## 故意写错',
  '',
  '行内错误 $\\frac{1}{$ 应该显示红字而不是把整篇打挂。',
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
  translate: function () { return Promise.resolve({ text: '' }); },
  status: function () { return Promise.resolve({ languages: [] }); }
};
</script>`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
// replacement 字符串里的 $$ 会被解释成 $，必须用函数形式返回
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () {
  return '<script>\n' + fs.readFileSync(path.join(__dirname, '_math_body.js'), 'utf8') + '\n</script>\n</body>';
});
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
