// 表格结构编辑集成测试：真实 WKWebView 里跑（build/shot）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__table_harness.html');

const DOC = [
  '# 表格',
  '',
  '| 名称 | 数量 | 备注 |',
  '|:-----|-----:|:----:|',
  '| 苹果 | 3 | 红 |',
  '| 梨 | 12 | |',
  '',
  '表格后面的段落。',
  ''
].join('\n');

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__t.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__t.md' }); },
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
  translate: function () { return Promise.resolve({ text: '' }); }
};
</script>`;

const TEST = String.raw`
(function () {
  var pass = 0, fail = 0, bad = [];
  function ok(c, m) { if (c) pass++; else { fail++; bad.push(m); } }
  function eq(a, b, m) { ok(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }

  var DOC = JSON.parse(document.getElementById('__doc').textContent);
  var TBL_I = 1;   // 文档里第 2 个块是表格

  function load(raw) {
    Editor.load(raw, '/tmp/t.md', 't.md');
    return Editor.getState().model.blocks;
  }
  function raw() { return Editor.getState().model.blocks[TBL_I].raw; }
  function model() { return MD.tableModel(raw()); }

  function cellEl(r, c) {
    var sel = r < 0 ? 'th[data-c="' + c + '"]' : 'td[data-r="' + r + '"][data-c="' + c + '"]';
    return document.querySelector('#editor ' + sel);
  }

  setTimeout(function () {
    /* ---------- 渲染 ---------- */
    load(DOC);
    ok(document.querySelectorAll('#editor .blk.table table').length === 1, '表格渲染出来');
    ok(!!cellEl(-1, 0), '表头有 data-c');
    ok(!!cellEl(0, 1), '数据单元格有 data-r/data-c');
    eq(document.querySelectorAll('#editor td').length, 6, '2 行 × 3 列 = 6 个 td');
    var th1 = cellEl(-1, 1);
    eq(th1.getAttribute('data-r'), '-1', '表头行用 -1 标记');
    eq(getComputedStyle(th1).textAlign, 'right', '第 2 列右对齐已生效');
    eq(getComputedStyle(cellEl(-1, 2)).textAlign, 'center', '第 3 列居中已生效');

    /* ---------- 插入行 ---------- */
    Table.insertRow(TBL_I, 0, true);          // 第 1 行下方
    var m = model();
    eq(m.rows.length, 3, '下方插入行后 3 行');
    eq(m.rows[1].join('|'), '||', '新行是空的且列数正确');
    eq(m.rows[2][0], '梨', '原来的第 2 行被推到后面');
    ok(raw().indexOf('表格后面的段落') === -1, '只改了表格块，没碰后面的段落');
    ok(Editor.getValue().indexOf('表格后面的段落') > 0, '整篇内容里后文还在');

    load(DOC);
    Table.insertRow(TBL_I, 0, false);         // 第 1 行上方
    eq(model().rows[0].join('|'), '||', '上方插入的行在最前');
    load(DOC);
    Table.insertRow(TBL_I, -1, true);         // 表头 → 落到第一行
    eq(model().rows.length, 3, '表头行插入行也是 3 行');

    /* ---------- 插入列 ---------- */
    load(DOC);
    Table.insertCol(TBL_I, 1, true);          // 第 2 列右侧
    var m2 = model();
    eq(m2.head.length, 4, '插入列后 4 列');
    eq(m2.head.join('|'), '名称|数量||备注', '新列插在第 2 列之后');
    eq(m2.aligns[2], 'right', '新列继承左侧列的对齐');
    eq(m2.rows[0].length, 4, '每行都补了新列');
    eq(m2.rows[0].join('|'), '苹果|3||红', '单元格内容位置正确');

    /* ---------- 删除 ---------- */
    load(DOC);
    Table.deleteRow(TBL_I, 0);
    eq(model().rows.length, 1, '删除一行后剩 1 行');
    eq(model().rows[0][0], '梨', '删的是指定的那一行');

    load(DOC);
    Table.deleteRow(TBL_I, -1);
    eq(model().rows.length, 2, '表头行不允许删除');

    load(DOC);
    Table.deleteCol(TBL_I, 0);
    eq(model().head.length, 2, '删除一列后 2 列');
    eq(model().head.join('|'), '数量|备注', '删的是第 1 列');
    eq(model().rows[1].join('|'), '12|', '数据也同步删列');

    /* ---------- 对齐 ---------- */
    load(DOC);
    Table.setAlign(TBL_I, 0, 'center');
    eq(model().aligns[0], 'center', '改对齐写入模型');
    ok(raw().indexOf(':---:') > 0 || raw().indexOf(':----:') > 0, '分隔行出现居中标记');
    eq(getComputedStyle(cellEl(-1, 0)).textAlign, 'center', '重渲染后单元格居中');

    /* ---------- 删最后一列 = 删表 ---------- */
    load(DOC);
    Table.deleteCol(TBL_I, 0);
    Table.deleteCol(TBL_I, 0);
    Table.deleteCol(TBL_I, 0);
    ok(Editor.getState().model.blocks[TBL_I].type !== 'table', '删到最后一列时整表被移除');

    /* ---------- 往返一致 ---------- */
    load(DOC);
    var before = MD.tableModel(raw());
    var ser = MD.serialTable(before);
    eq(JSON.stringify(MD.tableModel(ser)), JSON.stringify(before), '序列化后重新解析结构一致');
    ok(ser.split('\n').length === 4, '序列化行数 = 表头 + 分隔 + 2 行');

    /* ---------- 撤销 ---------- */
    load(DOC);
    var n0 = model().rows.length;
    Table.insertRow(TBL_I, 0, true);
    eq(model().rows.length, n0 + 1, '插入后行数 +1');
    Editor.undo();
    setTimeout(function () {
      eq(document.querySelectorAll('#editor td').length, 6, '撤销后回到 2 行');

      /* ---------- 手柄 ---------- */
      load(DOC);
      var td = cellEl(0, 0);
      var r = td.getBoundingClientRect();
      td.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: r.left + 6, clientY: r.top + 6
      }));
      var rh = document.querySelector('.tbl-h-row');
      var ch = document.querySelector('.tbl-h-col');
      ok(rh && getComputedStyle(rh).display !== 'none', '悬停单元格出现行手柄');
      ok(ch && getComputedStyle(ch).display !== 'none', '悬停单元格出现列手柄');
      if (rh) eq(rh.getAttribute('data-r'), '0', '行手柄记住当前行');
      if (ch) eq(ch.getAttribute('data-c'), '0', '列手柄记住当前列');

      // 点行手柄 → 下方插一行
      if (rh) {
        rh.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        rh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      eq(model().rows.length, 3, '点行手柄插入了一行');

      /* ---------- 右键菜单 ---------- */
      load(DOC);
      var td2 = cellEl(1, 2);
      var r2 = td2.getBoundingClientRect();
      td2.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r2.left + 4, clientY: r2.top + 4
      }));
      var menu = document.querySelector('.tbl-menu');
      ok(!!menu, '右键弹出菜单');
      var labels = menu ? Array.prototype.map.call(menu.querySelectorAll('.tbl-item'), function (b) {
        return b.textContent.replace('✓ ', '').replace('　', '');
      }) : [];
      ok(labels.indexOf('在下方插入行') >= 0, '菜单有「在下方插入行」');
      ok(labels.indexOf('在右侧插入列') >= 0, '菜单有「在右侧插入列」');
      ok(labels.indexOf('删除本行') >= 0, '数据行菜单有「删除本行」');
      ok(labels.indexOf('删除整张表格') >= 0, '菜单有「删除整张表格」');

      // 点「在下方插入行」
      var target = null;
      menu.querySelectorAll('.tbl-item').forEach(function (b) {
        if (!target && b.textContent.indexOf('在下方插入行') >= 0) target = b;
      });
      if (target) target.click();
      eq(model().rows.length, 3, '菜单执行后插入了一行');
      eq(document.querySelectorAll('.tbl-menu').length, 0, '执行后菜单关闭');

      // 表头行不应有「删除本行」
      load(DOC);
      var th = cellEl(-1, 0);
      var r3 = th.getBoundingClientRect();
      th.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r3.left + 4, clientY: r3.top + 4
      }));
      var menu2 = document.querySelector('.tbl-menu');
      var labels2 = menu2 ? Array.prototype.map.call(menu2.querySelectorAll('.tbl-item'), function (b) {
        return b.textContent.replace('✓ ', '').replace('　', '');
      }) : [];
      ok(labels2.indexOf('删除本行') === -1, '表头行没有「删除本行」');
      Table.closeMenu();

      window.__report = 'TABLE ' + pass + '/' + (pass + fail) +
        (fail ? ' | ' + bad.join(' ; ') : '');
    }, 260);
  }, 600);
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
