// fsundo.test.js —— 文件操作撤销（Node：mock Bridge，不碰 DOM）
// 覆盖：新建/重命名/副本/废纸篓/移动的逆操作、撤销失败、栈上限。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'app/js/workbench.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra) : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + '  want ' + JSON.stringify(b)); }

/* ---------------- 内存文件系统 mock ---------------- */
const FS = { files: {}, ops: [], failRestore: false };
function reset() {
  FS.files = {};
  FS.ops = [];
  FS.failRestore = false;
}
function seed(p) { FS.files[p] = 1; }
function has(p) { return !!FS.files[p]; }
function dirOf(p) { return p.replace(/\/[^/]+$/, ''); }
function nameOf(p) { return p.split('/').pop(); }

globalThis.Bridge = {
  available: true,
  confirm: function () { return Promise.resolve(true); },
  chooseFolder: function () { return Promise.resolve('/tmp/other'); },
  fsNew: function (dir, name) {
    var p = dir + '/' + name;
    if (FS.files[p]) return Promise.reject(new Error('同名文件已存在'));
    FS.files[p] = 1; FS.ops.push(['new', p]);
    return Promise.resolve({ path: p });
  },
  fsRename: function (p, name) {
    if (!FS.files[p]) return Promise.reject(new Error('文件不存在'));
    var to = dirOf(p) + '/' + name;
    if (FS.files[to]) return Promise.reject(new Error('同名文件已存在'));
    delete FS.files[p]; FS.files[to] = 1; FS.ops.push(['rename', p, to]);
    return Promise.resolve({ path: to });
  },
  fsDuplicate: function (p) {
    if (!FS.files[p]) return Promise.reject(new Error('文件不存在'));
    var to = dirOf(p) + '/' + nameOf(p).replace(/(\.[^.]+)?$/, '-副本$1');
    FS.files[to] = 1; FS.ops.push(['duplicate', to]);
    return Promise.resolve({ path: to });
  },
  fsTrash: function (p) {
    if (!FS.files[p]) return Promise.reject(new Error('文件不存在'));
    delete FS.files[p];
    var t = '/.Trash/' + nameOf(p);
    FS.ops.push(['trash', p, t]);
    return Promise.resolve({ path: p, trashPath: t });
  },
  fsRestore: function (t, p) {
    if (FS.failRestore) return Promise.reject(new Error('废纸篓里已经找不到这个文件'));
    if (FS.files[p]) return Promise.reject(new Error('原位置已有同名文件'));
    FS.files[p] = 1; FS.ops.push(['restore', t, p]);
    return Promise.resolve({ path: p });
  },
  fsMoveTo: function (p, dir) {
    if (!FS.files[p]) return Promise.reject(new Error('文件不存在'));
    var to = dir + '/' + nameOf(p);
    delete FS.files[p]; FS.files[to] = 1; FS.ops.push(['move', p, to]);
    return Promise.resolve({ path: to });
  }
};

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  /* ---------------- 栈的基本语义 ---------------- */
  console.log('撤销栈：基本语义');
  reset();
  eq('初始没有可撤销项', W.canUndoFileOp(), false);
  eq('初始标签为空', W.lastUndoLabel(), '');
  eq('空栈撤销返回 false', await W.undoFileOp(), false);

  W.pushUndo({ label: '测试项', run: function () { FS.ops.push(['custom']); return Promise.resolve(); } });
  eq('pushUndo 后可撤销', W.canUndoFileOp(), true);
  eq('标签可取到', W.lastUndoLabel(), '测试项');
  eq('撤销返回 true', await W.undoFileOp(), true);
  eq('run 被执行', FS.ops.filter(function (o) { return o[0] === 'custom'; }).length, 1);
  eq('撤销后栈空', W.canUndoFileOp(), false);

  W.pushUndo(null);
  W.pushUndo({ label: '没有 run' });
  eq('非法条目被忽略', W.canUndoFileOp(), false);

  /* ---------------- 废纸篓 + 恢复 ---------------- */
  console.log('撤销：移到废纸篓');
  reset();
  seed('/d/note.md');
  await W.trashEntry('/d/note.md');
  await sleep(10);
  eq('文件进了「废纸篓」', has('/d/note.md'), false);
  eq('记录了撤销项', W.canUndoFileOp(), true);
  eq('标签可读', W.lastUndoLabel(), '废纸篓 note.md');
  eq('trash 带回了真实落点', FS.ops[0][2], '/.Trash/note.md');

  eq('撤销成功', await W.undoFileOp(), true);
  await sleep(10);
  eq('文件回到原位置', has('/d/note.md'), true);
  eq('走的是 restore', FS.ops[1][0], 'restore');
  eq('撤销后栈空', W.canUndoFileOp(), false);

  /* ---------------- 撤销失败要把原因说清楚 ---------------- */
  console.log('撤销：失败路径');
  reset();
  seed('/d/a.md');
  await W.trashEntry('/d/a.md');
  await sleep(10);
  FS.failRestore = true;
  eq('失败时返回 false', await W.undoFileOp(), false);
  eq('失败的条目已出栈（不卡死后续撤销）', W.canUndoFileOp(), false);

  /* ---------------- 副本 ---------------- */
  console.log('撤销：创建副本');
  reset();
  seed('/d/a.md');
  await W.dupEntry('/d/a.md');
  await sleep(10);
  eq('副本已创建', has('/d/a-副本.md'), true);
  eq('撤销把副本送回废纸篓', await W.undoFileOp(), true);
  await sleep(10);
  eq('副本没了', has('/d/a-副本.md'), false);
  eq('原文件还在', has('/d/a.md'), true);

  /* ---------------- 移动 ---------------- */
  console.log('撤销：移动到文件夹');
  reset();
  seed('/d/a.md');
  await W.moveEntry('/d/a.md');
  await sleep(10);
  eq('文件搬走了', has('/d/a.md'), false);
  eq('新位置有文件', has('/tmp/other/a.md'), true);
  eq('撤销搬回原处', await W.undoFileOp(), true);
  await sleep(10);
  eq('原位置恢复', has('/d/a.md'), true);
  eq('新位置清空', has('/tmp/other/a.md'), false);

  console.log('撤销：目标目录没变则不操作');
  reset();
  seed('/d/a.md');
  globalThis.Bridge.chooseFolder = function () { return Promise.resolve('/d'); };
  await W.moveEntry('/d/a.md');
  await sleep(10);
  eq('没产生撤销项', W.canUndoFileOp(), false);
  eq('文件原地不动', has('/d/a.md'), true);
  globalThis.Bridge.chooseFolder = function () { return Promise.resolve('/tmp/other'); };

  /* ---------------- 栈上限 ---------------- */
  console.log('撤销：栈上限 20');
  reset();
  for (var i = 0; i < 25; i++) {
    W.pushUndo({ label: '项' + i, run: function () { return Promise.resolve(); } });
  }
  eq('超出上限丢掉最旧的', W.lastUndoLabel(), '项24');

  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
