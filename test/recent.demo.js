// recent.demo.js —— 最近文件「固定到列表」演示页（出 docs/opentypora-recent-pin.png）
// 一张图说明三件事：固定项带图钉并置顶、未固定项按打开时间排、清空按钮在面板条上。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__recent_demo.html');

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
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 12 分钟前 / 3 小时前 这类文案由 timeAgo 现算，所以时间戳都相对当前时刻给
  var now = Date.now();
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var seed = [
    { path: '/Users/fw/notes/网关限流改造.md', name: '网关限流改造.md', ts: now - 8 * MIN, pinned: true, pinTs: now - 2 * DAY },
    { path: '/Users/fw/notes/2026-Q4-读书记录.md', name: '2026-Q4-读书记录.md', ts: now - 3 * HOUR, pinned: true, pinTs: now - 5 * DAY },
    { path: '/Users/fw/work/db-migration.md', name: 'db-migration.md', ts: now - 26 * HOUR, pinned: true, pinTs: now - 9 * DAY },
    { path: '/Users/fw/notes/周报-第41周.md', name: '周报-第41周.md', ts: now - 12 * MIN, pinned: false, pinTs: 0 },
    { path: '/Users/fw/notes/随手记.md', name: '随手记.md', ts: now - 47 * MIN, pinned: false, pinTs: 0 },
    { path: '/Users/fw/work/api-设计草稿.md', name: 'api-设计草稿.md', ts: now - 2 * HOUR, pinned: false, pinTs: 0 },
    { path: '/Users/fw/notes/踩坑合集.md', name: '踩坑合集.md', ts: now - 6 * HOUR, pinned: false, pinTs: 0 },
    { path: '/Users/fw/work/上线检查单.md', name: '上线检查单.md', ts: now - 1 * DAY, pinned: false, pinTs: 0 },
    { path: '/Users/fw/notes/读书笔记-财富自由之路.md', name: '读书笔记-财富自由之路.md', ts: now - 3 * DAY, pinned: false, pinTs: 0 }
  ];
  try { localStorage.setItem('opentypora.recent', JSON.stringify(seed)); } catch (e) {}

  async function run() {
    await sleep(350);
    document.documentElement.setAttribute('data-theme', 'github');

    Editor.load('# 网关限流改造\\n\\n限流器改成令牌桶，超时按上游 P99 再留 20% 余量。\\n',
      '/Users/fw/notes/网关限流改造.md', '网关限流改造.md');
    await sleep(300);

    // 侧边栏默认收起（collapsed + body.side-hidden），演示页要把它展开
    var sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('collapsed');
    document.body.classList.remove('side-hidden');

    // 切到「最近」面板：ui.js 的 switchPanel 没导出，这里照它的三件事做一遍
    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-panel') === 'recent');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('active', p.id === 'panel-recent');
    });
    if (window.Workbench) Workbench.renderRecent();
    await sleep(300);

    // 图钉在未固定行上是 hover 才出现（CSS 里 .recent-row:hover .recent-pin），
    // 截图没有鼠标，手动给两行加个 transient 的 hover 类来展示「未固定也能固定」
    var rows = document.querySelectorAll('#recent .recent-row');
    if (rows[3]) rows[3].classList.add('demo-hover');
    var st = document.createElement('style');
    st.textContent = '.recent-row.demo-hover{background:rgba(127,127,127,.12)}' +
      '.recent-row.demo-hover .recent-pin{opacity:1}';
    document.head.appendChild(st);
    await sleep(250);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
