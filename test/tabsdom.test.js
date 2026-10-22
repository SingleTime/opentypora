// 标签页 · 真 WKWebView 验证（build/shot 跑）
// 纯函数在 tabs.test.js；这里验的是「切过去之后现场还在不在」：
// 正文、撤销栈、滚动位置、路径与 <base>、脏标记、关闭后谁接管。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__tabs_harness.html');

const MOCK = `
<script>
// 自动保存会走 700ms 定时器，把脏标记在测试中途抹掉 —— 这里关掉它
try {
  localStorage.clear();
  localStorage.setItem('opentypora.prefs', JSON.stringify({ autosave: false }));
} catch (e) {}
window.addEventListener('error', function (e) { window.__report = 'SCRIPT ERROR ' + e.message + ' @line ' + e.lineno; });
window.__confirm = [];
window.__confirmOK = true;
window.__setFile = [];
var LONG = [];
for (var i = 0; i < 40; i++) LONG.push('第 ' + i + ' 段：' + new Array(20).join('长正文 ') + '。');
window.__FILES = {
  '/ws/a.md': ['# A 文档', '', '第一段 alpha。', '', '第二段 beta。'].join('\\n'),
  '/ws/b.md': ['# B 文档', '', 'B 的正文。'].join('\\n'),
  '/ws/long.md': ['# 长文档', ''].concat(LONG).join('\\n')
};
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function (p) { window.__setFile.push(p); return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  readFile: function (p) {
    if (!window.__FILES[p]) return Promise.reject(new Error('no such file: ' + p));
    return Promise.resolve({ path: p, name: p.split('/').pop(), content: window.__FILES[p] });
  },
  readText: function (p) { return Promise.resolve({ path: p, content: window.__FILES[p] || '' }); },
  confirm: function (m, i) { window.__confirm.push(m); return Promise.resolve(window.__confirmOK); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  saveImage: function () { return Promise.resolve({ path: '/ws/x.png' }); }
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
  function eq(name, got, want) {
    ok(name + '（期望 ' + JSON.stringify(String(want)) + '）', String(got) === String(want), 'got ' + JSON.stringify(String(got)));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function info() { return OpenTyporaCmd.tabInfo(); }
  function n() { return info().list.length; }
  function active() {
    var t = info();
    for (var i = 0; i < t.list.length; i++) if (t.list[i].id === t.active) return t.list[i];
    return null;
  }
  function tabEls() { return Array.prototype.slice.call(document.querySelectorAll('#tab-list .tab')); }
  function domNames() {
    return tabEls().map(function (e) { return e.querySelector('.tab-name').textContent; });
  }
  function elOf(name) {
    var els = tabEls();
    for (var i = 0; i < els.length; i++) {
      if (els[i].querySelector('.tab-name').textContent === name) return els[i];
    }
    return null;
  }
  function idOf(name) {
    var v = info().list;
    for (var i = 0; i < v.length; i++) if (v[i].name === name) return v[i].id;
    return null;
  }
  function key(k, opt) {
    var o = { key: k, bubbles: true, cancelable: true, metaKey: true };
    for (var j in opt) o[j] = opt[j];
    document.dispatchEvent(new KeyboardEvent('keydown', o));
  }
  function typeIn(i, text) {
    Editor.enterEdit(i, 0);
    var ta = document.querySelector('#editor .src');
    if (!ta) return false;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    Editor.exitEdit();
    return true;
  }
  function scroller() { return $('editor-scroll'); }

  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n2 = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'TABS ' + n2 + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:860px;max-height:84vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
    console.log(window.__report);
  }

  async function run() {
    await sleep(420);

    // ---------- STEP 1 启动：一张标签，标签栏不出现 ----------
    eq('启动后只有一个标签', n(), 1);
    eq('启动标签是欢迎页', active().name, '欢迎.md');
    ok('只有一个标签时不显示标签栏', $('tabbar').hidden === true);
    ok('body 上没有 has-tabs', !document.body.classList.contains('has-tabs'));

    // ---------- STEP 2 ⌘T 开第二个 ----------
    key('t');
    await sleep(150);
    eq('⌘T 之后两个标签', n(), 2);
    eq('新标签叫未命名.md', active().name, '未命名.md');
    eq('标签栏顺序对', domNames().join(','), '欢迎.md,未命名.md');
    ok('两个标签时标签栏出现', $('tabbar').hidden === false);
    ok('body 上有 has-tabs', document.body.classList.contains('has-tabs'));
    ok('新标签是空的', Editor.getValue() === '', JSON.stringify(Editor.getValue()));

    // ---------- STEP 3 打字 → 脏点 ----------
    ok('能进块输入', typeIn(0, '# 草稿标题'));
    await sleep(120);
    eq('正文落进模型', Editor.getValue(), '# 草稿标题');
    ok('文档脏了', Editor.isDirty());
    ok('background 里有未保存的标签 → __appDirty 为真', window.__appDirty === true);
    ok('标签上有脏点', elOf('未命名.md').classList.contains('dirty'));

    // ---------- STEP 4 打开 a.md（新标签） ----------
    await OpenTyporaCmd.openPath('/ws/a.md');
    await sleep(150);
    eq('打开文件后三个标签', n(), 3);
    eq('活动页是 a.md', active().name, 'a.md');
    eq('编辑器路径跟着切', Editor.getPath(), '/ws/a.md');
    eq('状态栏显示路径', $('sb-path').textContent, '/ws/a.md');
    ok('正文是 a.md 的内容', Editor.getValue().indexOf('第一段 alpha') > 0);
    ok('<base> 指到文件目录', /\\/ws\\/$/.test(document.querySelector('base').getAttribute('href')),
      document.querySelector('base').getAttribute('href'));
    ok('打开新文件不再问「丢弃当前修改」', window.__confirm.length === 0, JSON.stringify(window.__confirm));

    // ---------- STEP 5 切回未命名：内容还在 ----------
    OpenTyporaCmd.switchTab(idOf('未命名.md'));
    await sleep(200);
    eq('切回去正文原样', Editor.getValue(), '# 草稿标题');
    eq('编辑器路径变 null', Editor.getPath(), null);
    ok('脏点还在', elOf('未命名.md').classList.contains('dirty'));
    ok('切到干净标签后 __appDirty 仍为真（后台标签没保存）', window.__appDirty === true);
    eq('tabInfo 里的 active 跟着变', active().name, '未命名.md');

    // ---------- STEP 6 撤销栈跨切换保留 ----------
    OpenTyporaCmd.switchTab(idOf('a.md'));
    await sleep(150);
    var beforeA = Editor.getValue();
    // undo 是「800ms 内的连续输入合成一条」，先停一下再打字，才保证这次输入有自己的快照
    await sleep(900);
    ok('能改 a.md', typeIn(0, '# A 改过的标题'));
    await sleep(80);
    ok('a.md 脏了', Editor.isDirty());
    OpenTyporaCmd.switchTab(idOf('未命名.md'));
    await sleep(150);
    OpenTyporaCmd.switchTab(idOf('a.md'));
    await sleep(200);
    ok('切回来改动还在', Editor.getValue().indexOf('# A 改过的标题') === 0, Editor.getValue().split('\\n')[0]);
    Editor.undo();
    await sleep(160);
    eq('撤销栈跟着标签走（能撤回到切换前）', Editor.getValue().split('\\n')[0], beforeA.split('\\n')[0]);
    Editor.redo();
    await sleep(120);

    // ---------- STEP 7 滚动位置跨切换保留 ----------
    await OpenTyporaCmd.openPath('/ws/long.md');
    await sleep(200);
    scroller().scrollTop = 600;
    await sleep(120);
    var sc = scroller().scrollTop;
    ok('确实滚下去了', sc > 500, String(sc));
    OpenTyporaCmd.switchTab(idOf('a.md'));
    await sleep(150);
    OpenTyporaCmd.switchTab(idOf('long.md'));
    await sleep(250);
    ok('切回来滚动位置还在', Math.abs(scroller().scrollTop - sc) <= 2,
      'want ' + Math.round(sc) + ' got ' + Math.round(scroller().scrollTop));

    // ---------- STEP 8 同一个文件不重复开 ----------
    var beforeCount = n();
    await OpenTyporaCmd.openPath('/ws/a.md');
    await sleep(150);
    eq('再开一次同一个文件不新增标签', n(), beforeCount);
    eq('而是切到已开着的那个', active().name, 'a.md');

    // ---------- STEP 9 关掉脏的后台标签要问 ----------
    window.__confirm.length = 0;
    window.__confirmOK = true;
    await OpenTyporaCmd.closeTabById(idOf('未命名.md'));
    await sleep(200);
    eq('关脏标签问了一次', window.__confirm.length, 1);
    ok('问的是那个标签的名字', String(window.__confirm[0]).indexOf('未命名') >= 0, String(window.__confirm[0]));
    ok('未命名.md 没了', idOf('未命名.md') === null);
    eq('关后台标签时活动页不动', active().name, 'a.md');

    // ---------- STEP 10 关干净标签不问 ----------
    window.__confirm.length = 0;
    await OpenTyporaCmd.closeTabById(idOf('long.md'));
    await sleep(180);
    eq('关干净的标签不问', window.__confirm.length, 0);
    eq('关掉之后剩的数量对', n(), beforeCount - 2);
    ok('活动页还在', !!active());

    // ---------- STEP 11 关最后一个 → 换成空白文档，标签栏收起 ----------
    window.__confirm.length = 0;
    while (n() > 1) {
      await OpenTyporaCmd.closeTabById(active().id);
      await sleep(120);
    }
    eq('只剩一个', n(), 1);
    await OpenTyporaCmd.closeTabById(active().id);
    await sleep(180);
    eq('关掉最后一个还是一个（不关窗口）', n(), 1);
    eq('换成了空白未命名', active().name, '未命名.md');
    eq('正文清空', Editor.getValue(), '');
    ok('标签栏收起', $('tabbar').hidden === true);
    ok('has-tabs 也摘掉了', !document.body.classList.contains('has-tabs'));

    // ---------- STEP 12 键盘：⌃⇥ / ⌘⇧] / ⌘W ----------
    // 上一步剩下一张空白页，再开两个文件 → 三个标签：[未命名.md, a.md, b.md]
    await OpenTyporaCmd.openPath('/ws/a.md');
    await sleep(120);
    await OpenTyporaCmd.openPath('/ws/b.md');
    await sleep(160);
    var all = info().list.map(function (t) { return t.name; });
    eq('三个标签', n(), 3);
    eq('顺序对', all.join(','), '未命名.md,a.md,b.md');
    eq('活动页是最后打开的 b.md', active().name, 'b.md');

    key('Tab', { metaKey: false, ctrlKey: true });
    await sleep(160);
    eq('⌃⇥ 从头绕回第一个', active().name, '未命名.md');
    key('Tab', { metaKey: false, ctrlKey: true, shiftKey: true });
    await sleep(160);
    eq('⌃⇧⇥ 回到最后一个', active().name, 'b.md');
    key(']');
    await sleep(160);
    eq('⌘⇧] 从头绕回第一个', active().name, '未命名.md');
    key('[');
    await sleep(160);
    eq('⌘⇧[ 回到最后一个', active().name, 'b.md');

    var beforeW = n();
    window.__confirm.length = 0;
    key('w', { shiftKey: false });
    await sleep(220);
    eq('⌘W 关掉当前标签', n(), beforeW - 1);
    eq('⌘W 之后由左边那个接管', active().name, 'a.md');
    ok('b.md 真的没了', idOf('b.md') === null);

    // ---------- STEP 13 中键关标签 ----------
    await OpenTyporaCmd.openPath('/ws/b.md');
    await sleep(160);
    eq('又开了 b.md', n(), beforeW);
    elOf('b.md').dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    await sleep(220);
    eq('中键点一下就关了', n(), beforeW - 1);
    ok('关的是 b.md', idOf('b.md') === null);

    // ---------- STEP 14 关闭后的重开 ----------
    OpenTyporaCmd.reopenClosed();
    await sleep(280);
    eq('⌘⇧T 重新打开刚才关掉的 b.md', active().name, 'b.md');

    // ---------- STEP 15 标签栏 DOM 与状态一致 ----------
    eq('DOM 顺序与状态一致', domNames().join(','), info().list.map(function (t) { return t.name; }).join(','));
    eq('活动样式只有一个', document.querySelectorAll('#tab-list .tab.active').length, 1);
    eq('活动样式落在当前页上', document.querySelector('#tab-list .tab.active .tab-name').textContent, active().name);
    ok('最后一个 setFile 是当前路径', window.__setFile[window.__setFile.length - 1] === '/ws/b.md',
      JSON.stringify(window.__setFile));

    // ---------- STEP 16 会话写盘：只记有落点的标签 ----------
    OpenTyporaCmd.saveSession();
    var rawS = OpenTyporaCmd.sessionRaw();
    ok('localStorage 里写了会话', !!rawS, String(rawS));
    var S0 = JSON.parse(rawS);
    eq('会话里只有磁盘文件', S0.paths.join(','), '/ws/a.md,/ws/b.md');
    eq('未命名标签不进会话', S0.paths.length, 2);
    eq('会话记住前台那篇', S0.active, '/ws/b.md');
    eq('会话带版本号', S0.v, 1);

    // ---------- STEP 17 模拟重启：整排标签回来，正文以磁盘为准 ----------
    localStorage.setItem('opentypora.session', JSON.stringify({
      v: 1, paths: ['/ws/a.md', '/ws/b.md'], active: '/ws/a.md'
    }));
    var okRestore = await OpenTyporaCmd.restoreSession();
    await sleep(220);
    ok('还原成功', okRestore === true);
    eq('两个标签都回来了', n(), 2);
    eq('顺序按存盘顺序', info().list.map(function (t) { return t.name; }).join(','), 'a.md,b.md');
    eq('活动页是会话里记的那篇', active().name, 'a.md');
    eq('编辑器路径跟上', Editor.getPath(), '/ws/a.md');
    ok('正文重新从磁盘读（此前改过的未保存内容不跨重启）',
      Editor.getValue().indexOf('第一段 alpha') > 0 && Editor.getValue().indexOf('改过的标题') < 0,
      Editor.getValue().split('\\n')[0]);
    ok('标签栏出现', $('tabbar').hidden === false);
    ok('<base> 指到活动文件的目录', /\\/ws\\/$/.test(document.querySelector('base').getAttribute('href')),
      document.querySelector('base').getAttribute('href'));
    eq('setFile 收到活动文件', window.__setFile[window.__setFile.length - 1], '/ws/a.md');
    ok('还原出来的标签都是干净的', !document.querySelector('#tab-list .tab.dirty'));

    // ---------- STEP 18 打不开的文件跳过；相对路径不认 ----------
    localStorage.setItem('opentypora.session', JSON.stringify({
      v: 1, paths: ['/ws/a.md', '/ws/gone.md'], active: '/ws/gone.md'
    }));
    await OpenTyporaCmd.restoreSession();
    await sleep(200);
    eq('被删掉的文件跳过', n(), 1);
    eq('活动页兜底到还活着的那篇', active().name, 'a.md');

    localStorage.setItem('opentypora.session', JSON.stringify({ v: 1, paths: ['rel/x.md'] }));
    var okRel = await OpenTyporaCmd.restoreSession();
    await sleep(150);
    ok('只有相对路径 → 不还原', okRel === false);
    eq('标签没被动过', n(), 1);
    eq('还是 a.md', active().name, 'a.md');

    // ---------- STEP 19 未命名标签不污染会话 ----------
    key('t');
    await sleep(160);
    eq('⌘T 之后两个', n(), 2);
    eq('新的是未命名', active().name, '未命名.md');
    OpenTyporaCmd.saveSession();
    var S1 = JSON.parse(OpenTyporaCmd.sessionRaw());
    eq('未命名不写进会话', S1.paths.join(','), '/ws/a.md');
    eq('前台是未命名 → active 为 null', S1.active, null);
    await OpenTyporaCmd.closeTabById(active().id);
    await sleep(200);
    OpenTyporaCmd.saveSession();
    var S2 = JSON.parse(OpenTyporaCmd.sessionRaw());
    eq('关掉之后会话回到 a.md', S2.paths.join(','), '/ws/a.md');
    eq('active 也回到 a.md', S2.active, '/ws/a.md');

    report();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) { R.push('THROW ' + e + '\\n' + (e && e.stack)); report(); });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
