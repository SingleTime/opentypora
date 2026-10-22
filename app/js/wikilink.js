/* ============================================================
 * wikilink.js — wiki 链接的输入辅助与坏链标记
 *
 * 三件事：
 *   1. 在块里敲到 `[[` 时浮出笔记选单，↑↓ 选择、Enter/Tab 插入
 *   2. 渲染后把目标不存在的角标标成虚线（只打开了文件夹时才判断，
 *      否则相对路径本来就可能落在文件夹外）
 *   3. 不做改名跟踪：链接存的是笔记名，文件挪窝后靠「按名字在文件树里找」
 *      兜底（见 ui.js 的 findByTree）
 * ============================================================ */
var WikiPick = (function () {
  'use strict';

  var pop = null, open = false, items = [], idx = 0;
  var ta = null, start = 0, query = '', caret = 0;

  function box() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'wl-pop';
    pop.setAttribute('role', 'listbox');
    document.body.appendChild(pop);
    return pop;
  }

  function notes() {
    var T = window.OpenTyporaCmd;
    if (!T || !T.listNotes) return [];
    try { return T.listNotes() || []; } catch (e) { return []; }
  }

  /* 插入用：相对路径去掉扩展名（子目录里的笔记才不撞名） */
  function titleOf(rec) {
    return String(rec.rel || rec.name || '').replace(/\.(md|markdown|mdown|txt)$/i, '');
  }

  /* 显示用：只要文件名，目录另外一列 */
  function baseOf(rec) {
    return String(rec.name || rec.rel || '').replace(/\.(md|markdown|mdown|txt)$/i, '');
  }

  function filterNotes(q) {
    var all = notes();
    if (!q) return all.slice(0, 8);
    var lo = q.toLowerCase();
    var head = [], mid = [];
    all.forEach(function (r) {
      var t = titleOf(r).toLowerCase();
      if (t.indexOf(lo) === 0) head.push(r);
      else if (t.indexOf(lo) > 0) mid.push(r);
    });
    return head.concat(mid).slice(0, 8);
  }

  function caretPos() {
    var r = ta.getBoundingClientRect();
    var cs = window.getComputedStyle(ta);
    var lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 15) * 1.6;
    var pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var line = (ta.value.slice(0, pos).match(/\n/g) || []).length;
    var vh = window.innerHeight;
    var top = r.top + line * lh - (ta.scrollTop || 0) + lh + 4;
    if (top + 200 > vh) top = Math.max(8, r.top + line * lh - (ta.scrollTop || 0) - 204);
    return { top: top, left: r.left + 6, width: Math.min(Math.max(r.width, 180), 360) };
  }

  function render() {
    var p = box();
    var q = query;
    items = filterNotes(q);
    if (idx >= items.length) idx = Math.max(0, items.length - 1);

    var html = '';
    if (!items.length) {
      html = '<div class="wl-empty">' + (notes().length ? '没有匹配的笔记' : '打开文件夹后可以从这里选笔记') + '</div>';
    } else {
      items.forEach(function (r, i) {
        var rel = String(r.rel || '');
        var dir = rel.indexOf('/') >= 0 ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
        html += '<button type="button" class="wl-item' + (i === idx ? ' on' : '') + '" data-i="' + i + '">' +
          '<span class="wl-title">' + esc(baseOf(r)) + '</span>' +
          (dir ? '<span class="wl-dir">' + esc(dir) + '</span>' : '') + '</button>';
      });
    }
    p.innerHTML = html;

    var pos = caretPos();
    p.style.top = Math.round(pos.top) + 'px';
    p.style.left = Math.round(pos.left) + 'px';
    p.style.width = Math.round(pos.width) + 'px';
    p.classList.add('on');
    open = true;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function close() {
    open = false;
    items = [];
    ta = null;
    if (pop) pop.classList.remove('on');
  }

  function choose(i) {
    var rec = items[i];
    if (!rec || !ta) return;
    var ins = '[[' + titleOf(rec) + ']]';
    var v = ta.value;
    var end = ta.selectionStart == null ? v.length : ta.selectionStart;
    var head = v.slice(0, start) + ins;
    ta.value = head + v.slice(end);
    var caretAt = head.length;
    try { ta.setSelectionRange(caretAt, caretAt); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    try { ta.focus(); } catch (e) {}
  }

  /* ---------- 输入触发 ---------- */
  function onInput(e) {
    var t = e.target;
    if (!t || (t.tagName !== 'TEXTAREA' && !t.__live)) return;
    // 块内编辑与分栏源码都支持；整篇源码模式（#source-area）不介入
    if (!t.classList.contains('src') && t.id !== 'split-src') return;
    var pos = t.selectionStart;
    if (pos == null) return close();
    var before = t.value.slice(0, pos);
    var m = /(?:^|[^\\])\[\[([^\[\]\n|]*)$/.exec(before);
    if (!m) return close();
    ta = t;
    start = pos - m[1].length - 2;
    query = m[1];
    idx = 0;
    render();
  }

  document.addEventListener('input', onInput, true);

  document.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault(); e.stopPropagation();
      idx = (idx + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      // 没匹配就别抢 Enter（回车还是要能正常拆块）
      if (!items.length) return;
      e.preventDefault(); e.stopPropagation();
      choose(idx);
    }
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (!open) return;
    var it = e.target.closest && e.target.closest('.wl-item');
    if (it) {
      e.preventDefault(); e.stopPropagation();
      choose(+it.getAttribute('data-i'));
      return;
    }
    if (pop && pop.contains(e.target)) return;
    close();
  }, true);

  /* ---------- 坏链标记 ---------- */
  function decorateLinks(root) {
    if (!root || !root.querySelectorAll) return 0;
    var all = notes();
    var links = root.querySelectorAll('.wiki-link');
    if (!all.length) {
      // 没打开文件夹：判断不了，别乱标
      Array.prototype.forEach.call(links, function (a) { a.classList.remove('wiki-missing'); });
      return 0;
    }
    var names = {};
    all.forEach(function (r) {
      names[titleOf(r).toLowerCase()] = 1;
      names[String(r.rel || '').replace(/\.(md|markdown|mdown|txt)$/i, '').toLowerCase()] = 1;
    });
    var missing = 0;
    Array.prototype.forEach.call(links, function (a) {
      var t = String(a.getAttribute('data-wiki') || '');
      if (t.charAt(0) === '#') { a.classList.remove('wiki-missing'); return; }
      var key = t.replace(/^\.\//, '').replace(/\.(md|markdown|mdown|txt)$/i, '').toLowerCase();
      var ok = !!names[key];
      if (!ok) {
        // 允许只写文件名后半段：[[子目录/笔记]] 对 [[笔记]]
        Object.keys(names).some(function (n) {
          if (n.length > key.length && n.slice(-key.length - 1) === '/' + key) { ok = true; return true; }
          return false;
        });
      }
      a.classList.toggle('wiki-missing', !ok);
      if (!ok) missing++;
    });
    return missing;
  }

  return {
    close: close,
    isOpen: function () { return open; },
    items: function () { return items.slice(); },
    choose: choose,
    decorateLinks: decorateLinks
  };
})();
