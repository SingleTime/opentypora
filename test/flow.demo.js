// 生成 flowchart 演示页（真实 index.html + mock 桥），用于截图与视觉验证
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__flow_demo.html');

const DOC = [
  '# flowchart.js 图表',
  '',
  '用 `flow` 或 `flowchart` 围栏即可，纯本地渲染，不需要 mermaid 那 3.4 MB。',
  '',
  '## 基本流程',
  '',
  '```flow',
  'st=>start: 开始',
  'input=>inputoutput: 读取输入',
  'op=>operation: 处理数据',
  'cond=>condition: 校验通过?',
  'fix=>operation: 记录错误',
  'sub=>subroutine: 调用子流程',
  'io=>inputoutput: 写入结果',
  'e=>end: 结束',
  '',
  'st->input->op->cond',
  'cond(yes)->sub->io->e',
  'cond(no)->fix',
  'fix->input',
  '```',
  '',
  '## 分支与环',
  '',
  '```flowchart',
  'a=>start: 接收请求',
  'b=>operation: 查询缓存',
  'c=>condition: 命中?',
  'd=>operation: 回源查询',
  'f=>end: 返回结果',
  '',
  'a->b->c',
  'c(yes)->f',
  'c(no)->d->f',
  '```',
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
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: '' }); }
};
</script>`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () {
  return '<script>\n' +
    'var DOC = JSON.parse(document.getElementById("__doc").textContent);\n' +
    'setTimeout(function () { Editor.load(DOC, "/tmp/flow-demo.md", "flow-demo.md"); }, 600);\n' +
    '</script>\n</body>';
});
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
