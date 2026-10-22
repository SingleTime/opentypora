// 生成「文件操作撤销」集成测试页（WKWebView）。
// 纯函数部分由 fsundo.test.js 覆盖；这里验证真实 DOM 链路：
// 打开文件夹 → 右键菜单 → 操作 → 文件树刷新 → toast 撤销按钮 → 撤销后树/编辑器状态。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__fsundo_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
var __FS = { '/ws/a.md': 1, '/ws/b.md': 1, '/ws/notes/c.md': 1 };
var __chooseTarget = '/ws';
function __snap() {
  var root = { name: 'ws', path: '/ws', type: 'dir', children: [] };
  var notes = { name: 'notes', path: '/ws/notes', type: 'dir', children: [] };
  Object.keys(__FS).sort().forEach(function (p) {
    var node = { name: p.split('/').pop(), path: p, type: 'file', mtime: 1, size: 10 };
    if (p.indexOf('/ws/notes/') === 0) notes.children.push(node);
    else root.children.push(node);
  });
  root.children.push(notes);
  return { root: '/ws', tree: [root] };
}
window.__FS = __FS;
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/ws/a.md' }); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve(__snap()); },
  openFolderAt: function (p) { return Promise.resolve(__snap()); },
  readFile: function (p) {
    return Promise.resolve({ path: p, name: p.split('/').pop(), content: '# ' + p.split('/').pop() + '\\n' });
  },
  readText: function (p) { return Promise.resolve('# ' + p.split('/').pop() + '\\n'); },
  confirm: function () { return Promise.resolve(true); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  fsList: function () { return Promise.resolve(__snap()); },
  fsStat: function (p) { return Promise.resolve({ path: p, mtime: 1, size: 1 }); },
  chooseFolder: function () { return Promise.resolve(__chooseTarget); },
  fsNew: function (dir, name, isFolder) {
    var p = dir + '/' + name;
    if (__FS[p]) return Promise.reject(new Error('同名文件已存在'));
    __FS[p] = 1;
    return Promise.resolve({ path: p });
  },
  fsRename: function (p, name) {
    if (!__FS[p]) return Promise.reject(new Error('文件不存在'));
    var to = p.replace(/\\/[^/]+$/, '') + '/' + name;
    if (__FS[to]) return Promise.reject(new Error('同名文件已存在'));
    delete __FS[p]; __FS[to] = 1;
    return Promise.resolve({ path: to });
  },
  fsDuplicate: function (p) {
    if (!__FS[p]) return Promise.reject(new Error('文件不存在'));
    var to = p.replace(/(\\.[^.]+)?$/, function (e) { return '-副本' + (e || ''); });
    __FS[to] = 1;
    return Promise.resolve({ path: to });
  },
  fsTrash: function (p) {
    if (!__FS[p]) return Promise.reject(new Error('文件不存在'));
    delete __FS[p];
    return Promise.resolve({ path: p, trashPath: '/.Trash/' + p.split('/').pop() });
  },
  fsRestore: function (t, p) {
    if (__FS[p]) return Promise.reject(new Error('原位置已有同名文件'));
    __FS[p] = 1;
    return Promise.resolve({ path: p });
  },
  fsMoveTo: function (p, dir) {
    if (!__FS[p]) return Promise.reject(new Error('文件不存在'));
    var to = dir + '/' + p.split('/').pop();
    delete __FS[p]; __FS[to] = 1;
    return Promise.resolve({ path: to });
  }
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
  function treeHas(p) { return !!document.querySelector('#tree [data-path="' + p + '"]'); }
  function toastAct() { return document.querySelector('#toast .toast-act'); }
  function fillPrompt(v) {
    var ip = document.getElementById('wb-prompt');
    if (!ip) return false;
    ip.value = v;
    document.getElementById('wb-ok').click();
    return true;
  }
  function ctxClick(path, label) {
    var el = document.querySelector('#tree [data-path="' + path + '"]');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ctxmenu .ctx-item'));
    var b = btns.filter(function (x) { return x.textContent === label; })[0];
    if (!b) return false;
    b.click();
    return true;
  }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'FSUNDO ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:680px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 60000);
    await sleep(400);

    /* ---------- STEP 1 打开文件夹 ---------- */
    R.push('STEP 1 打开文件夹');
    OpenTyporaCmd.openFolder();
    await sleep(300);
    ok('文件夹名显示 ws', $('folder-name').textContent === 'ws', $('folder-name').textContent);
    ok('树里有 a.md / b.md', treeHas('/ws/a.md') && treeHas('/ws/b.md'));
    ok('树里有 notes 目录', treeHas('/ws/notes'));
    ok('notes 里的 c.md 也展开了', treeHas('/ws/notes/c.md'));
    ok('文章列表渲染了', document.querySelectorAll('#articles .art-item').length === 3,
      String(document.querySelectorAll('#articles .art-item').length));

    /* ---------- STEP 2 右键 → 废纸篓 → toast 撤销 ---------- */
    R.push('STEP 2 废纸篓 + toast 撤销');
    ok('右键菜单点得到废纸篓', ctxClick('/ws/a.md', '移到废纸篓'));
    await sleep(250);
    ok('树里没有 a.md 了', !treeHas('/ws/a.md'));
    ok('内存 FS 里也没有', !window.__FS['/ws/a.md']);
    ok('出现带撤销按钮的 toast', !!toastAct(), toastAct() ? toastAct().textContent : 'null');
    ok('撤销按钮文字是「撤销」', !!toastAct() && toastAct().textContent === '撤销');
    ok('toast 处于显示状态', $('toast').classList.contains('show'));
    ok('canUndoFileOp 为真', Workbench.canUndoFileOp());
    ok('标签是「废纸篓 a.md」', Workbench.lastUndoLabel() === '废纸篓 a.md', Workbench.lastUndoLabel());

    toastAct().click();
    await sleep(250);
    ok('撤销后树里恢复 a.md', treeHas('/ws/a.md'));
    ok('撤销后 FS 恢复', !!window.__FS['/ws/a.md']);
    ok('撤销后 toast 变成「已撤销」', $('toast').textContent.indexOf('已撤销') === 0,
      $('toast').textContent.slice(0, 20));
    ok('撤销后栈空', !Workbench.canUndoFileOp());

    /* ---------- STEP 3 重命名（prompt 流程） + 菜单入口撤销 ---------- */
    R.push('STEP 3 重命名 + 菜单撤销');
    Workbench.renameEntry('/ws/b.md');
    await sleep(150);
    ok('弹出了命名输入框', !!document.getElementById('wb-prompt'));
    ok('填好名字点了确定', fillPrompt('b2.md'));
    await sleep(250);
    ok('树里出现 b2.md', treeHas('/ws/b2.md'));
    ok('树里没有 b.md 了', !treeHas('/ws/b.md'));
    ok('标签是「重命名 b.md」', Workbench.lastUndoLabel() === '重命名 b.md', Workbench.lastUndoLabel());

    OpenTyporaCmd.undoFileOp();
    await sleep(250);
    ok('菜单撤销后树里回到 b.md', treeHas('/ws/b.md'));
    ok('菜单撤销后 b2.md 消失', !treeHas('/ws/b2.md'));

    /* ---------- STEP 4 目录右键 → 新建文件 ---------- */
    R.push('STEP 4 新建文件');
    ok('目录右键菜单可点新建', ctxClick('/ws/notes', '新建 Markdown 文件'));
    await sleep(150);
    ok('新建弹框出现', !!document.getElementById('wb-prompt'));
    ok('填了名字', fillPrompt('fresh.md'));
    await sleep(300);
    ok('树里出现 fresh.md', treeHas('/ws/notes/fresh.md'));
    ok('编辑器打开了新文件', Editor.getText().indexOf('fresh.md') >= 0,
      Editor.getText().slice(0, 30));
    ok('标签是「新建 fresh.md」', Workbench.lastUndoLabel() === '新建 fresh.md', Workbench.lastUndoLabel());
    ok('又有撤销按钮', !!toastAct());

    toastAct().click();
    await sleep(250);
    ok('撤销后 fresh.md 从树里消失', !treeHas('/ws/notes/fresh.md'));
    ok('撤销后 FS 里也没有', !window.__FS['/ws/notes/fresh.md']);
    ok('b.md 不受影响', treeHas('/ws/b.md'));

    /* ---------- STEP 5 移动到别的文件夹 ---------- */
    R.push('STEP 5 移动到文件夹');
    ok('右键菜单有「移动到…」', (function () {
      var el = document.querySelector('#tree [data-path="/ws/notes/c.md"]');
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      return Array.prototype.slice.call(document.querySelectorAll('#ctxmenu .ctx-item'))
        .some(function (x) { return x.textContent === '移动到…'; });
    })());
    __chooseTarget = '/ws';
    Workbench.moveEntry('/ws/notes/c.md');
    await sleep(300);
    ok('文件搬到了 /ws', treeHas('/ws/c.md') && !treeHas('/ws/notes/c.md'));
    ok('标签是「移动 c.md」', Workbench.lastUndoLabel() === '移动 c.md', Workbench.lastUndoLabel());

    toastAct().click();
    await sleep(250);
    ok('撤销搬回 notes', treeHas('/ws/notes/c.md') && !treeHas('/ws/c.md'));

    /* ---------- STEP 6 目标目录没变 ---------- */
    R.push('STEP 6 目标目录没变');
    __chooseTarget = '/ws/notes';
    Workbench.moveEntry('/ws/notes/c.md');
    await sleep(250);
    ok('没有产生撤销项', !Workbench.canUndoFileOp());
    ok('文件原地不动', treeHas('/ws/notes/c.md') && !treeHas('/ws/c.md'));
    ok('提示「文件夹没变」', $('toast').textContent.indexOf('文件夹没变') >= 0,
      $('toast').textContent.slice(0, 20));
    __chooseTarget = '/ws';

    clearTimeout(watchdog);
    report();
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) {
        R.push('THROW ' + (e && e.message));
        report();
      });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
