/* ============================================================
 * table.js — 渲染态表格结构编辑
 *
 * 目标：不改源码也能增删行列、改列对齐（单元格里直接改，不碰源码）。
 * 做法：渲染时 th/td 已带 data-r / data-c；这里在鼠标悬停时把「+」手柄
 *       浮到行左 / 列顶，右键弹菜单。所有操作都走
 *       Editor.replaceRawRange(块, 0, len, 新表文本)，因此撤销、脏标记、
 *       自动保存、字数统计全都是现成的那一套。
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Table = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var EDITOR = null;
  var cellRef = null;          // { i, r, c }
  var rowH = null, colH = null, menuEl = null;
  var hideTimer = null;

  function doc() { return root.document; }
  function MD() { return root.MD; }
  function Ed() { return root.Editor; }

  /* ---------------------------------------------------------- 数据操作
   * 全部是「读块原文 → 改模型 → 序列化写回」，不碰 DOM。
   */

  function modelOf(i) {
    var st = Ed().getState();
    var b = st && st.model && st.model.blocks[i];
    if (!b) return null;
    return MD().tableModel(b.raw);
  }

  function apply(i, m) {
    var st = Ed().getState();
    var b = st && st.model && st.model.blocks[i];
    if (!b) return false;
    var next = MD().serialTable(m);
    if (!next || next === b.raw) return false;
    return Ed().replaceRawRange(i, 0, b.raw.length, next);
  }

  function emptyRow(n) {
    var r = [];
    for (var k = 0; k < n; k++) r.push('');
    return r;
  }

  // r = -1 表示表头行
  function insertRow(i, r, below) {
    var m = modelOf(i);
    if (!m) return false;
    var at = r < 0 ? 0 : (below ? r + 1 : r);
    m.rows.splice(at, 0, emptyRow(m.head.length));
    return apply(i, m);
  }

  function insertCol(i, c, right) {
    var m = modelOf(i);
    if (!m) return false;
    var at = right ? c + 1 : c;
    m.head.splice(at, 0, '');
    m.aligns.splice(at, 0, m.aligns[c] || '');
    m.rows.forEach(function (row) { row.splice(at, 0, ''); });
    return apply(i, m);
  }

  function deleteRow(i, r) {
    if (r < 0) return false;                 // 表头不能删
    var m = modelOf(i);
    if (!m) return false;
    m.rows.splice(r, 1);
    if (!m.rows.length) m.rows.push(emptyRow(m.head.length));  // 至少留一行空数据
    return apply(i, m);
  }

  function deleteCol(i, c) {
    var m = modelOf(i);
    if (!m) return false;
    if (m.head.length <= 1) return deleteTable(i);
    m.head.splice(c, 1);
    m.aligns.splice(c, 1);
    m.rows.forEach(function (row) { row.splice(c, 1); });
    return apply(i, m);
  }

  function setAlign(i, c, a) {
    var m = modelOf(i);
    if (!m) return false;
    if (m.aligns[c] === a) return false;
    m.aligns[c] = a || '';
    return apply(i, m);
  }

  /* ---------------------------------------------------------- 拖动排序
   * moveRow / moveCol 是纯函数：to 是「结果数组里的最终下标」。
   * 表头行（r < 0）不参与拖动；列的头一格就是表头，照常可拖。
   */

  function clampIndex(n, len) {
    if (n < 0) return 0;
    if (n > len - 1) return len - 1;
    return n;
  }

  function moveRow(m, from, to) {
    if (!m || !m.rows || !m.rows.length) return false;
    if (from < 0 || from >= m.rows.length) return false;
    to = clampIndex(to, m.rows.length);
    if (from === to) return false;
    var row = m.rows.splice(from, 1)[0];
    m.rows.splice(to, 0, row);
    return true;
  }

  function moveCol(m, from, to) {
    if (!m || !m.head || !m.head.length) return false;
    if (from < 0 || from >= m.head.length) return false;
    to = clampIndex(to, m.head.length);
    if (from === to) return false;
    m.head.splice(to, 0, m.head.splice(from, 1)[0]);
    var al = (m.aligns || []).splice(from, 1)[0];
    if (m.aligns) m.aligns.splice(to, 0, al);
    m.rows.forEach(function (row) {
      row.splice(to, 0, row.splice(from, 1)[0]);
    });
    if (m.widths && m.widths.length) {
      var w = m.widths.splice(from, 1)[0];
      m.widths.splice(to, 0, w);
    }
    return true;
  }

  // 把「插到原数组第 insertAt 条之前」换成「结果数组的最终下标」
  function dropIndex(from, insertAt) {
    return insertAt > from ? insertAt - 1 : insertAt;
  }

  function dragRow(i, from, to) {
    var m = modelOf(i);
    if (!m) return false;
    if (!moveRow(m, from, to)) return false;
    return apply(i, m);
  }

  function dragCol(i, from, to) {
    var m = modelOf(i);
    if (!m) return false;
    if (!moveCol(m, from, to)) return false;
    return apply(i, m);
  }

  function deleteTable(i) {
    if (typeof Ed().deleteBlock === 'function') return Ed().deleteBlock(i);
    var st = Ed().getState();
    var b = st && st.model && st.model.blocks[i];
    if (!b) return false;
    return Ed().replaceRawRange(i, 0, b.raw.length, '');
  }

  /* ---------------------------------------------------------- DOM 辅助 */

  function cellOf(target) {
    if (!target || !target.closest) return null;
    var el = target.closest('td,th');
    if (!el) return null;
    var table = el.closest('table');
    if (!table || !EDITOR || !EDITOR.contains(table)) return null;
    var blk = table.closest('.blk');
    if (!blk) return null;
    var i = parseInt(blk.getAttribute('data-i'), 10);
    if (isNaN(i)) return null;
    return {
      el: el, table: table, i: i,
      r: parseInt(el.getAttribute('data-r'), 10),
      c: parseInt(el.getAttribute('data-c'), 10)
    };
  }

  function mkHandle(kind) {
    var b = doc().createElement('div');
    b.className = 'tbl-h tbl-h-' + kind;
    b.setAttribute('data-kind', kind);
    b.title = kind === 'row' ? '拖动换行，单击在下方插入一行' : '拖动换列，单击在右侧插入一列';
    b.textContent = '+';
    doc().body.appendChild(b);
    return b;
  }

  function hideHandles() {
    if (rowH) rowH.style.display = 'none';
    if (colH) colH.style.display = 'none';
    cellRef = null;
  }

  function placeHandles(c) {
    var tr = c.el.parentNode;
    var trRect = tr.getBoundingClientRect();
    var tdRect = c.el.getBoundingClientRect();
    var tRect = c.table.getBoundingClientRect();
    var W = root.innerWidth || 1200;

    var rl = Math.min(Math.max(4, tRect.left - 24), W - 24);
    rowH.style.display = 'flex';
    rowH.style.left = rl + 'px';
    rowH.style.top = Math.round(trRect.top + trRect.height / 2 - 9) + 'px';
    rowH.setAttribute('data-i', c.i);
    rowH.setAttribute('data-r', c.r);

    var cl = Math.min(Math.max(4, tdRect.left + tdRect.width / 2 - 9), W - 24);
    colH.style.display = 'flex';
    colH.style.left = cl + 'px';
    colH.style.top = Math.round(tRect.top - 24) + 'px';
    colH.setAttribute('data-i', c.i);
    colH.setAttribute('data-c', c.c);

    cellRef = c;
  }

  /* ---------------------------------------------------------- 单元格原位编辑
   * 点单元格 → 里面直接变成输入框；Enter 下一行、Tab 下一列（到头自动加行/列）。
   * 改完写回块原文，撤销/脏标记/自动保存沿用 Editor.replaceRawRange。
   */
  function cellAt(i, r, c) {
    if (!EDITOR) return null;
    var blk = EDITOR.querySelector('.blk[data-i="' + i + '"]');
    if (!blk) return null;
    var tag = r < 0 ? 'th' : 'td';
    return blk.querySelector(tag + '[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function editCell(c, dir) {
    if (!c || !c.el) return;
    if (c.el.querySelector('.tbl-cell-input')) return;
    var m = modelOf(c.i);
    if (!m) return;
    var val = c.r < 0 ? (m.head[c.c] || '') : ((m.rows[c.r] || [])[c.c] || '');

    var ip = doc().createElement('input');
    ip.type = 'text';
    ip.className = 'tbl-cell-input';
    ip.value = val;
    ip.spellcheck = false;
    c.el.innerHTML = '';
    c.el.appendChild(ip);
    ip.focus();
    ip.select();

    var done = false;
    function cancel() {
      if (done) return; done = true;
      Ed().render();
    }
    function commit(move) {
      if (done) return; done = true;
      var nv = ip.value;
      var mm = modelOf(c.i);
      var changed = false;
      if (mm) {
        if (c.r < 0) { if (mm.head[c.c] !== nv) { mm.head[c.c] = nv; changed = true; } }
        else if (mm.rows[c.r]) { if (mm.rows[c.r][c.c] !== nv) { mm.rows[c.r][c.c] = nv; changed = true; } }
      }
      if (changed) apply(c.i, mm);

      if (!move) { if (!changed) Ed().render(); return; }
      var rows = mm ? mm.rows.length : 0;
      var cols = mm ? mm.head.length : 1;
      var r = c.r, cc = c.c;
      if (move === 'down') {
        r = r + 1;
        if (r >= rows) { insertRow(c.i, rows - 1, true); r = rows; }
      } else if (move === 'right') {
        cc = cc + 1;
        if (cc >= cols) {
          cc = 0; r = r + 1;
          if (r >= rows) { insertRow(c.i, rows - 1, true); r = rows; }
        }
      }
      var nextEl = cellAt(c.i, r, cc);
      if (nextEl) editCell({ el: nextEl, table: nextEl.closest('table'), i: c.i, r: r, c: cc });
    }

    ip.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); commit('down'); return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(e.shiftKey ? null : 'right'); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      e.stopPropagation();           // 别让编辑器把方向键当成跨块移动
    });
    ip.addEventListener('blur', function () { commit(null); });
    ip.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  }

  /* ---------------------------------------------------------- 插入表格对话框 */
  function insertTableDialog(afterIndex) {
    closeDialog();
    var d = doc();
    var mask = d.createElement('div');
    mask.className = 'tbl-dlg-mask';
    mask.innerHTML = '<div class="tbl-dlg">' +
      '<div class="tbl-dlg-title">插入表格</div>' +
      '<label>行数 <input id="tbl-dlg-rows" type="number" min="1" max="50" value="2"></label>' +
      '<label>列数 <input id="tbl-dlg-cols" type="number" min="1" max="12" value="3"></label>' +
      '<div class="tbl-dlg-actions"><button id="tbl-dlg-cancel" class="tbl-dlg-btn">取消</button>' +
      '<button id="tbl-dlg-ok" class="tbl-dlg-btn primary">插入</button></div></div>';
    d.body.appendChild(mask);

    var rowsIp = mask.querySelector('#tbl-dlg-rows');
    var colsIp = mask.querySelector('#tbl-dlg-cols');
    setTimeout(function () { rowsIp.focus(); rowsIp.select(); }, 0);

    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.querySelector('#tbl-dlg-cancel').addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    function ok() {
      var nr = Math.max(1, Math.min(50, parseInt(rowsIp.value, 10) || 2));
      var nc = Math.max(1, Math.min(12, parseInt(colsIp.value, 10) || 3));
      close();
      var head = [], sep = [], empty = [];
      for (var j = 0; j < nc; j++) { head.push('列 ' + (j + 1)); sep.push('---'); empty.push(''); }
      var raw = '| ' + head.join(' | ') + ' |\n| ' + sep.join(' | ') + ' |';
      for (var i = 0; i < nr; i++) raw += '\n| ' + empty.join(' | ') + ' |';
      if (typeof Ed().insertBlockAfter === 'function') Ed().insertBlockAfter(afterIndex, raw, 'table');
      else Ed().insertAtCaret('\n' + raw + '\n');
    }
    mask.querySelector('#tbl-dlg-ok').addEventListener('click', ok);
    mask.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    return mask;
  }

  function closeDialog() {
    var el = doc().querySelector('.tbl-dlg-mask');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ---------------------------------------------------------- 菜单 */

  var ALIGN_LABEL = { '': '默认（左）', left: '左对齐', center: '居中', right: '右对齐' };

  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }

  function menuItem(label, act, cls) {
    var b = doc().createElement('button');
    b.className = 'tbl-item' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      closeMenu(); hideHandles();
      act();
    });
    return b;
  }

  function sep() {
    var d = doc().createElement('div');
    d.className = 'tbl-sep';
    return d;
  }

  function openMenu(c, x, y) {
    closeMenu();
    var m = modelOf(c.i);
    if (!m) return;

    var el = doc().createElement('div');
    el.className = 'tbl-menu';

    el.appendChild(menuItem('编辑单元格', function () {
      var cell = cellAt(c.i, c.r, c.c);
      if (cell) editCell({ el: cell, table: cell.closest('table'), i: c.i, r: c.r, c: c.c });
    }));
    el.appendChild(sep());
    el.appendChild(menuItem('在上方插入行', function () { insertRow(c.i, c.r, false); }));
    el.appendChild(menuItem('在下方插入行', function () { insertRow(c.i, c.r, true); }));
    if (c.r >= 0) el.appendChild(menuItem('删除本行', function () { deleteRow(c.i, c.r); }, 'danger'));
    el.appendChild(sep());
    el.appendChild(menuItem('在左侧插入列', function () { insertCol(c.i, c.c, false); }));
    el.appendChild(menuItem('在右侧插入列', function () { insertCol(c.i, c.c, true); }));
    el.appendChild(menuItem('删除本列', function () { deleteCol(c.i, c.c); }, 'danger'));
    el.appendChild(sep());

    var titles = doc().createElement('div');
    titles.className = 'tbl-label';
    titles.textContent = '第 ' + (c.c + 1) + ' 列对齐';
    el.appendChild(titles);
    [['left', '左对齐'], ['center', '居中'], ['right', '右对齐'], ['', '默认（左）']].forEach(function (pair) {
      var cur = (m.aligns[c.c] || '') === pair[0];
      el.appendChild(menuItem((cur ? '✓ ' : '　') + pair[1], function () { setAlign(c.i, c.c, pair[0]); }));
    });

    el.appendChild(sep());
    el.appendChild(menuItem('删除整张表格', function () { deleteTable(c.i); }, 'danger'));

    doc().body.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight;
    var W = root.innerWidth, H = root.innerHeight;
    el.style.left = Math.max(6, Math.min(W - w - 6, x)) + 'px';
    el.style.top = Math.max(6, Math.min(H - h - 6, y)) + 'px';
    menuEl = el;
  }

  /* ---------------------------------------------------------- 事件 */

  function onMove(e) {
    var c = cellOf(e.target);
    if (!c) return;                       // 不移出时就保持，避免手柄闪烁
    if (cellRef && cellRef.i === c.i && cellRef.r === c.r && cellRef.c === c.c) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    placeHandles(c);
  }

  function onLeave(e) {
    if (!e.relatedTarget) { scheduleHide(); return; }
    if (rowH && rowH.contains(e.relatedTarget)) return;
    if (colH && colH.contains(e.relatedTarget)) return;
    scheduleHide();
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { hideHandles(); hideTimer = null; }, 260);
  }

  /* ---------------------------------------------------------- 手柄拖拽排序
   * 按住手柄拖动：到目标行/列的上半 → 插到它前面，下半 → 插到它后面。
   * 拖动过（位移 > 4px）就吃掉随后的 click，避免又插一行。
   */
  var dragState = null;
  var swallowClick = false;

  function dropLine() {
    if (dragState && dragState.line) return dragState.line;
    var el = doc().createElement('div');
    el.className = 'tbl-drop';
    el.style.display = 'none';
    doc().body.appendChild(el);
    return el;
  }

  function showDropLine(kind, c, before) {
    var line = dropLine();
    var rect = c.el.getBoundingClientRect();
    if (kind === 'row') {
      var tr = c.el.parentNode.getBoundingClientRect();
      var y = before ? tr.top : tr.bottom;
      line.className = 'tbl-drop tbl-drop-row';
      line.style.left = Math.round(tr.left) + 'px';
      line.style.width = Math.round(tr.width) + 'px';
      line.style.top = Math.round(y - 1) + 'px';
      line.style.height = '2px';
    } else {
      var tbl = c.table.getBoundingClientRect();
      var x = before ? rect.left : rect.right;
      line.className = 'tbl-drop tbl-drop-col';
      line.style.top = Math.round(tbl.top) + 'px';
      line.style.height = Math.round(tbl.height) + 'px';
      line.style.left = Math.round(x - 1) + 'px';
      line.style.width = '2px';
    }
    line.style.display = 'block';
  }

  function clearDropLine() {
    if (dragState && dragState.line) dragState.line.style.display = 'none';
  }

  function startDrag(e, kind, h) {
    var i = parseInt(h.getAttribute('data-i'), 10);
    var from = parseInt(h.getAttribute(kind === 'row' ? 'data-r' : 'data-c'), 10);
    if (isNaN(i) || isNaN(from)) return;
    if (kind === 'row' && from < 0) return;      // 表头行不动
    var m = modelOf(i);
    if (!m) return;
    var limit = kind === 'row' ? m.rows.length : m.head.length;
    if (limit < 2) return;

    var sx = e.clientX, sy = e.clientY, moved = false;
    var target = null;      // { c, before }

    dragState = { i: i, kind: kind, from: from, line: null, target: null };

    function onDrag(ev) {
      if (!moved) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
        moved = true;
        h.classList.add('dragging');
        doc().body.classList.add('tbl-dragging');
      }
      var el = doc().elementFromPoint(ev.clientX, ev.clientY);
      var c = el ? cellOf(el) : null;
      if (!c || c.i !== i) { clearDropLine(); target = null; return; }
      var rect = c.el.getBoundingClientRect();
      var before = kind === 'row'
        ? ev.clientY < rect.top + rect.height / 2
        : ev.clientX < rect.left + rect.width / 2;
      target = { r: c.r, c: c.c, before: before };
      showDropLine(kind, c, before);
    }

    function onUp() {
      doc().removeEventListener('mousemove', onDrag, true);
      doc().removeEventListener('mouseup', onUp, true);
      h.classList.remove('dragging');
      doc().body.classList.remove('tbl-dragging');
      clearDropLine();
      if (moved) swallowClick = true;
      var st = dragState;
      dragState = null;
      if (!moved || !target) return;
      if (kind === 'row') {
        if (target.r < 0 && !target.before) return;
        var insertAt = target.r < 0 ? 0 : (target.before ? target.r : target.r + 1);
        dragRow(i, st.from, dropIndex(st.from, insertAt));
      } else {
        var insertAt2 = target.before ? target.c : target.c + 1;
        dragCol(i, st.from, dropIndex(st.from, insertAt2));
      }
    }

    doc().addEventListener('mousemove', onDrag, true);
    doc().addEventListener('mouseup', onUp, true);
  }

  function bindHandle(h, kind) {
    h.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      startDrag(e, kind, h);
    });
    h.addEventListener('mouseenter', function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
    h.addEventListener('mouseleave', scheduleHide);
    h.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (swallowClick) { swallowClick = false; return; }
      var i = parseInt(h.getAttribute('data-i'), 10);
      if (kind === 'row') insertRow(i, parseInt(h.getAttribute('data-r'), 10), true);
      else insertCol(i, parseInt(h.getAttribute('data-c'), 10), true);
      hideHandles();
    });
  }

  function attach(editorEl) {
    if (!editorEl || EDITOR) return;
    var d = doc();
    EDITOR = editorEl;
    rowH = mkHandle('row');
    colH = mkHandle('col');
    hideHandles();
    bindHandle(rowH, 'row');
    bindHandle(colH, 'col');

    // 单击单元格 → 原位编辑（点在链接上时不抢）
    EDITOR.addEventListener('click', function (e) {
      if (e.target.closest && (e.target.closest('a') || e.target.closest('.tbl-cell-input'))) return;
      var c = cellOf(e.target);
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      editCell(c);
    }, true);

    // 列宽拖拽：命中单元格右边缘 6px 内
    EDITOR.addEventListener('mousedown', function (e) {
      var c = cellOf(e.target);
      if (!c) return;
      if (e.target.closest && e.target.closest('.tbl-cell-input')) return;
      var rect = c.el.getBoundingClientRect();
      if (rect.right - e.clientX > 6 || e.clientX - rect.left < 10) return;
      e.preventDefault();
      e.stopPropagation();
      var m = modelOf(c.i);
      if (!m) return;
      var table = c.table, tblRect = table.getBoundingClientRect();
      var startX = e.clientX, startW = tblRect.width || 1;
      var startChars = (m.widths && m.widths[c.c]) || 8;
      var colW = rect.width || 40;

      function onDrag(ev) {
        var delta = ev.clientX - startX;
        var next = Math.max(24, colW + delta);
        var cols = table.querySelectorAll('colgroup col');
        if (!cols.length) {
          var cg = doc().createElement('colgroup');
          for (var k = 0; k < m.head.length; k++) cg.appendChild(doc().createElement('col'));
          table.insertBefore(cg, table.firstChild);
          cols = table.querySelectorAll('colgroup col');
        }
        if (cols[c.c]) cols[c.c].style.width = next + 'px';
        table.style.tableLayout = 'fixed';
        table.style.width = '100%';
      }
      function onUp() {
        doc().removeEventListener('mousemove', onDrag, true);
        doc().removeEventListener('mouseup', onUp, true);
        var delta = 0;
        try { delta = (table.querySelectorAll('colgroup col')[c.c].style.width.replace('px', '') | 0) - colW; } catch (err) {}
        if (!delta) return;
        var perChar = startW / Math.max(1, startChars * m.head.length);
        m.widths = m.widths || [];
        m.widths[c.c] = Math.max(3, Math.round(startChars + delta / Math.max(4, perChar)));
        apply(c.i, m);
      }
      doc().addEventListener('mousemove', onDrag, true);
      doc().addEventListener('mouseup', onUp, true);
    }, true);

    EDITOR.addEventListener('mousemove', onMove);
    EDITOR.addEventListener('mouseleave', onLeave);

    EDITOR.addEventListener('contextmenu', function (e) {
      var c = cellOf(e.target);
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      hideHandles();
      openMenu(c, e.clientX, e.clientY);
    });

    d.addEventListener('mousedown', function (e) {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    }, true);
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuEl) { closeMenu(); e.stopPropagation(); }
    }, true);
    root.addEventListener('scroll', function () { closeMenu(); hideHandles(); }, true);
    root.addEventListener('blur', function () { closeMenu(); hideHandles(); });
  }

  // 页面里自动挂载；Node（单测 require）下没有 document，直接跳过
  if (typeof document !== 'undefined') {
    var boot = function () {
      var el = document.getElementById('editor');
      if (el) attach(el);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return {
    attach: attach,
    insertRow: insertRow,
    insertCol: insertCol,
    deleteRow: deleteRow,
    deleteCol: deleteCol,
    setAlign: setAlign,
    moveRow: moveRow,
    moveCol: moveCol,
    dropIndex: dropIndex,
    dragRow: dragRow,
    dragCol: dragCol,
    editCell: editCell,
    insertTableDialog: insertTableDialog,
    closeDialog: closeDialog,
    deleteTable: deleteTable,
    modelOf: modelOf,
    openMenu: openMenu,
    closeMenu: closeMenu
  };
});
