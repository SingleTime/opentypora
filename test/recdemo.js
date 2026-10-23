// recdemo.js —— 生成 README 首页演示动画的页面（app/__recdemo.html）
// 用法：node test/recdemo.js  →  app/__recdemo.html → 用 recdemo.swift 开窗录制
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__recdemo.html');

const NOTES = '/Users/fw/笔记';

const DOC = [
  '# OpenTypora',
  '',
  '块级所见即所得：标题、列表、表格、公式、代码都是排版后的样子，',
  '光标走到哪一段，那一段的 Markdown 标记才现身。',
  '',
  '## 支持的写法',
  '',
  '- **粗体**、*斜体*、~~删除线~~、`行内代码`、==高亮==',
  '- 任务列表、脚注、上下标、emoji :smile:',
  '- 表格、流程图、KaTeX 公式',
  '',
  '| 导出 | 格式 |',
  '| --- | --- |',
  '| 文档 | Word / ODT / ePub / RTF |',
  '| 排版 | LaTeX / PDF / HTML |',
  '',
  '$$ e^{i\\pi} + 1 = 0 $$',
  '',
  '> 编辑、导出、图片管理都在同一个窗口里完成。',
  ''
].join('\n');

const TREE = {
  root: NOTES,
  tree: [
    {
      type: 'dir', name: '项目', path: NOTES + '/项目', children: [
        { type: 'file', name: '发布清单.md', path: NOTES + '/项目/发布清单.md' },
        { type: 'file', name: '接口设计.md', path: NOTES + '/项目/接口设计.md' }
      ]
    },
    { type: 'file', name: '演示.md', path: NOTES + '/演示.md' },
    { type: 'file', name: '读书笔记.md', path: NOTES + '/读书笔记.md' },
    { type: 'file', name: '周报.md', path: NOTES + '/周报.md' }
  ]
};

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
try {
  localStorage.setItem('opentypora.prefs', JSON.stringify({
    size: 16, width: 720, autosave: true, spellcheck: false, base: 'github',
    autoPair: true, smart: true, lineno: false, zoom: 100, followSystem: false
  }));
} catch (e) {}
window.__TREE = ${JSON.stringify(TREE)};
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '${NOTES}/演示.md' }); },
  saveAs: function () { return Promise.resolve({ path: '${NOTES}/演示.md' }); },
  saveImage: function () { return Promise.resolve('${NOTES}/assets/x.png'); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve(window.__TREE); },
  openFolderAt: function () { return Promise.resolve(window.__TREE); },
  listDir: function () { return Promise.resolve(window.__TREE); },
  readFile: function () { return Promise.reject(new Error('x')); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: '' }); }
};
</script>
`;

const DEMO = `<script>
(function () {
  var DOC = ${JSON.stringify(DOC)};
  var PATH = '${NOTES}/演示.md';
  var TYPE = ' 在这里敲字：**标记先现身，松手就藏起来**';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ta() { return document.querySelector('#editor textarea'); }

  async function typeInto(el, text, per) {
    for (var i = 0; i < text.length; i++) {
      el.value = el.value + text.charAt(i);
      var n = el.value.length;
      try { el.setSelectionRange(n, n); } catch (e) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(per);
    }
  }

  async function run() {
    Editor.load(DOC, PATH, '演示.md');

    // 侧边栏铺一棵笔记树（Bridge 是假的，走一遍真实的「打开文件夹」流程）
    var btn = document.getElementById('btn-open-folder');
    if (btn) btn.click();

    await sleep(1600);

    // 找这一行，光标放到行尾往里打字
    var idx = -1;
    for (var i = 0; i < Editor.blockCount(); i++) {
      if ((Editor.getRaw(i) || '').indexOf('光标走到') >= 0) { idx = i; break; }
    }
    if (idx < 0) { window.__demoDone = true; return; }
    Editor.enterEdit(idx, 999);
    await sleep(450);

    var el = ta();
    if (el) {
      el.focus();
      await typeInto(el, TYPE, 70);
      await sleep(1200);   // 停手，标记还露着
      Editor.exitEdit();   // 离开这一段 → ** 被藏起来，文字变成粗体
    }
    await sleep(1400);

    // 分栏：点工具栏上的「分栏」，左边源码、右边预览
    var sp = document.getElementById('tb-split');
    if (sp) sp.click();
    await sleep(2600);
    if (sp) sp.click();
    await sleep(700);

    // 夜间主题
    Editor.setTheme('night');
    document.documentElement.setAttribute('data-theme', 'night');
    try { localStorage.setItem('opentypora.theme', 'night'); } catch (e) {}
    await sleep(2100);

    window.__demoDone = true;
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) {
        document.documentElement.setAttribute('data-report', 'ERR ' + (e && e.stack || e));
      });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
html = html.replace(/<title>[^<]*<\/title>/, '<title>演示.md — OpenTypora</title>');
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
