// tabs.demo.js —— 标签页
// 出两张图：docs/opentypora-tabs.png（浅色，四个标签、其中一个有未保存圆点）
//           docs/opentypora-tabs-night.png（夜间主题同一状态）
//
// 走真 UI 路径：OpenTyporaCmd.openPath 打开文件、切到一个标签打上脏标记再切回来，
// 所以图上那条标签栏就是用户真会看到的样子。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__tabs_demo.html');
const MODE = process.argv[2] || 'light';

const FILES = {
  '/Users/fw/笔记/index.md': [
    '# 多标签页',
    '',
    '一个窗口里同时开着几篇文档，切过去就接着写 —— 正文、撤销栈、滚动位置、光标在哪一块，' +
    '全都留在各自的标签里，回来还是走的时候的样子。',
    '',
    '## 有哪些操作',
    '',
    '- `⌘T` 新建标签页；`⌘W` 关掉当前这个（关最后一个不关窗口，换成空白文档）',
    '- `⌃⇥` / `⌃⇧⇥` 或 `⌘⇧]` / `⌘⇧[` 前后切换',
    '- 点标签上的 `✕`，或者中键点一下，都能关掉',
    '- 文件名后面那个小圆点表示这篇还有没保存的修改',
    '',
    '> 打开文件不再需要问「要不要丢弃当前修改」—— 当前这篇原样留在它自己的标签里。',
    '',
    '再打开同一个文件不会开出第二个标签，而是直接切过去。'
  ].join('\n'),
  '/Users/fw/笔记/发布计划.md': [
    '# 发布计划',
    '',
    '这篇改到一半，标签上还亮着未保存的圆点。',
    '',
    '- [x] 打包脚本',
    '- [ ] 写更新日志'
  ].join('\n'),
  '/Users/fw/笔记/会议记录.md': [
    '# 会议记录',
    '',
    '切换文档时滚动位置也要记住 —— 长文里这一点比什么都重要。'
  ].join('\n'),
  '/Users/fw/笔记/剪藏/如何写得更清楚.md': [
    '# 如何写得更清楚',
    '',
    '剪藏目录里的另一篇，路径不一样但一样是一个标签。'
  ].join('\n')
};

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__FILES = ${JSON.stringify(FILES)};
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  readFile: function (p) {
    if (!window.__FILES[p]) return Promise.reject(new Error('no file'));
    return Promise.resolve({ path: p, name: p.split('/').pop(), content: window.__FILES[p] });
  },
  readText: function (p) { return Promise.resolve({ path: p, content: window.__FILES[p] || '' }); },
  confirm: function () { return Promise.resolve(true); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve({ root: '/Users/fw/笔记', tree: [] }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  spellCheck: function () { return Promise.resolve('[]'); },
  spellGuesses: function () { return Promise.resolve('[]'); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function run() {
    await sleep(420);
    var mode = '${MODE}';
    if (mode === 'night') { try { Editor.setTheme('night'); } catch (e) {} await sleep(200); }

    await OpenTyporaCmd.openPath('/Users/fw/笔记/发布计划.md');
    await sleep(120);
    await OpenTyporaCmd.openPath('/Users/fw/笔记/会议记录.md');
    await sleep(120);
    await OpenTyporaCmd.openPath('/Users/fw/笔记/剪藏/如何写得更清楚.md');
    await sleep(120);
    await OpenTyporaCmd.openPath('/Users/fw/笔记/index.md');
    await sleep(220);

    // 让「发布计划」带一个未保存圆点：切过去标记脏，再切回 index.md
    var t = OpenTyporaCmd.tabInfo();
    var plan = null;
    for (var i = 0; i < t.list.length; i++) if (t.list[i].name === '发布计划.md') plan = t.list[i].id;
    OpenTyporaCmd.switchTab(plan);
    await sleep(120);
    Editor.markDirty();
    await sleep(120);
    OpenTyporaCmd.switchTab(t.list[t.list.length - 1].id);
    await sleep(260);
    try { document.getElementById('editor-scroll').scrollTop = 0; } catch (e) {}
    await sleep(160);
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
