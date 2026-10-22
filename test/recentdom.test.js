// 生成「最近文件固定」集成测试页（WKWebView）。
// 纯函数（排序 / 淘汰 / 切换）在 workbench.test.js 里测；这里测 DOM 那一层：
// 图钉按钮存在与否、点击后的置顶与落盘、以及「点图钉不会顺手把文件打开」。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__recentdom_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__opened = [];
window.__reads = 0;
// 三条：c 最旧、a 最新
try {
  localStorage.setItem('opentypora.recent', JSON.stringify([
    { path: '/ws/b.md', name: 'b.md', ts: Date.now() - 120000 },
    { path: '/ws/a.md', name: 'a.md', ts: Date.now() - 60000 },
    { path: '/ws/c.md', name: 'c.md', ts: Date.now() - 600000 }
  ]));
} catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  readText: function (p) { window.__reads++; window.__opened.push(p); return Promise.resolve('# 标题\\n'); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function rows() { return Array.prototype.slice.call(document.querySelectorAll('#recent .recent-row')); }
  function names() { return rows().map(function (r) { return r.querySelector('.recent-name').textContent; }); }
  function pinnedNames() {
    return rows().filter(function (r) { return r.classList.contains('pinned'); })
      .map(function (r) { return r.querySelector('.recent-name').textContent; });
  }
  function pinOf(name) {
    return rows().filter(function (r) {
      return r.querySelector('.recent-name').textContent === name;
    })[0].querySelector('.recent-pin');
  }
  function stored() {
    try { return JSON.parse(localStorage.getItem('opentypora.recent') || '[]'); } catch (e) { return []; }
  }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'RECENTDOM ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:720px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    await sleep(400);
    document.documentElement.setAttribute('data-theme', 'github');
    Editor.load('# 标题\\n\\n正文\\n', '/ws/a.md', 'a.md');
    await sleep(250);

    // ---------- STEP 1 列表渲染 ----------
    var tab = document.querySelector('.side-tab[data-panel="recent"]');
    ok('有「最近」标签', !!tab);
    tab.click();
    await sleep(200);
    ok('面板切到最近', $('panel-recent').classList.contains('active') ||
      $('panel-recent').style.display !== 'none', $('panel-recent').className);
    ok('渲染出三条', rows().length === 3, String(rows().length));
    ok('按时间倒序（a 最新）', names().join(',') === 'a.md,b.md,c.md', names().join(','));
    ok('每条都有图钉按钮', rows().every(function (r) { return !!r.querySelector('.recent-pin'); }));
    ok('未固定时 aria-pressed=false',
      rows().every(function (r) { return r.querySelector('.recent-pin').getAttribute('aria-pressed') === 'false'; }));
    ok('图钉有 title / aria-label',
      pinOf('a.md').getAttribute('title') === '固定到列表' &&
      pinOf('a.md').getAttribute('aria-label') === '固定到列表');
    var beforeReads = window.__reads;

    // ---------- STEP 2 固定 ----------
    pinOf('c.md').click();
    await sleep(200);
    ok('固定后置顶', names()[0] === 'c.md', names().join(','));
    ok('有 pinned 类', pinnedNames().join(',') === 'c.md', pinnedNames().join(','));
    ok('aria-pressed 变 true', pinOf('c.md').getAttribute('aria-pressed') === 'true');
    ok('title 变「取消固定」', pinOf('c.md').getAttribute('title') === '取消固定');
    ok('点图钉没有打开文件', window.__reads === beforeReads,
      beforeReads + ' → ' + window.__reads);
    var s1 = stored();
    ok('落盘带 pinned', s1.some(function (x) { return x.path === '/ws/c.md' && x.pinned === true; }),
      JSON.stringify(s1.map(function (x) { return [x.path, x.pinned]; })));
    ok('落盘顺序也是固定在前', s1[0].path === '/ws/c.md', s1.map(function (x) { return x.path; }).join(','));

    // ---------- STEP 3 再固定一条 ----------
    pinOf('b.md').click();
    await sleep(200);
    ok('两条固定都在前面', names().slice(0, 2).sort().join(',') === 'b.md,c.md', names().join(','));
    ok('后固定的排在固定组首', names()[0] === 'b.md', names().join(','));

    // ---------- STEP 4 重新渲染（模拟重开面板） ----------
    Workbench.renderRecent();
    await sleep(120);
    ok('重渲染后固定仍置顶', names()[0] === 'b.md', names().join(','));
    ok('重渲染后固定数不变', pinnedNames().length === 2, String(pinnedNames().length));

    // ---------- STEP 5 取消固定 ----------
    pinOf('c.md').click();
    await sleep(200);
    ok('取消固定后不再置顶', names().indexOf('c.md') === 2, names().join(','));
    ok('取消固定后只剩一条 pinned', pinnedNames().join(',') === 'b.md', pinnedNames().join(','));
    var s2 = stored();
    ok('落盘里 c 的 pinned 已清', !s2.some(function (x) { return x.path === '/ws/c.md' && x.pinned; }));

    // ---------- STEP 6 打开文件后固定状态保留 ----------
    pinOf('a.md').click();
    await sleep(150);
    Workbench.addRecent('/ws/a.md', 'a.md');
    await sleep(150);
    ok('重新打开不丢固定', Workbench.isPinned(stored(), '/ws/a.md') === true);
    ok('重新打开后仍在固定组', names().indexOf('a.md') <= 1, names().join(','));

    // ---------- STEP 7 清空 ----------
    $('recent-clear').click();
    await sleep(200);
    ok('清空后没有行', rows().length === 0, String(rows().length));
    ok('清空后给出空提示', $('recent').textContent.indexOf('还没有打开过文件') >= 0,
      $('recent').textContent.trim());
    ok('清空后 localStorage 是空数组', stored().length === 0, JSON.stringify(stored()));

    report();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) { R.push('THROW ' + e); report(); });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
