/* ============================================================
 * fnpop.js — 脚注角标的悬停预览（替代原生 title tooltip）
 *
 * 为什么不用 title：
 *   原生 tooltip 会等一秒、样式跟系统走、不能换行也不能带格式。
 *   这里做一个跟主题同色的浮层，正文直接复用 .fn-def .fn-text 的
 *   DOM（行内代码、公式、链接都是现成的）。
 *
 * 约定：
 *   - 角标 sup.fn-ref[data-fn] 由 md.js 产出、doc.js 负责编号
 *   - 定义块 id 为 fn-def-<id>，可能在主编辑器或分栏预览里
 * ============================================================ */
var FnPop = (function () {
  'use strict';

  var pop = null, cur = null, showTimer = null, hideTimer = null;
  var savedTitle = null;

  function box() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'fn-pop';
    pop.setAttribute('role', 'tooltip');
    document.body.appendChild(pop);
    return pop;
  }

  function rootOf(node) {
    var ed = document.getElementById('editor');
    if (ed && ed.contains(node)) return ed;
    var pv = document.getElementById('split-prev-inner');
    if (pv && pv.contains(node)) return pv;
    return null;
  }

  function defOf(root, id) {
    var safe = String(id == null ? '' : id).replace(/["\\]/g, '\\$&');
    try { return root.querySelector('[id="fn-def-' + safe + '"]'); } catch (e) { return null; }
  }

  function place(ref) {
    var p = box();
    var r = ref.getBoundingClientRect();
    var pr = p.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var gap = 8;
    var top = r.top - pr.height - gap;
    if (top < gap) top = Math.min(vh - pr.height - gap, r.bottom + gap);
    var left = r.left + r.width / 2 - pr.width / 2;
    left = Math.max(gap, Math.min(left, vw - pr.width - gap));
    p.style.top = Math.round(top) + 'px';
    p.style.left = Math.round(left) + 'px';
  }

  function show(ref) {
    var root = rootOf(ref);
    if (!root) return false;
    var id = ref.getAttribute('data-fn') || '';
    var def = defOf(root, id);
    var body = def && def.querySelector('.fn-text');
    if (!body) return false;

    var numEl = def.querySelector('.fn-num');
    var p = box();
    p.innerHTML = '<span class="fn-pop-n">' + (numEl ? String(numEl.textContent || '') : '') +
      '</span><span class="fn-pop-body">' + body.innerHTML + '</span>';
    p.classList.add('on');
    cur = ref;
    // 原生 tooltip 会跟浮层同时出现，先摘掉，关掉时再还回去
    savedTitle = ref.getAttribute('title');
    if (savedTitle != null) ref.removeAttribute('title');
    place(ref);
    return true;
  }

  function hide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (cur && savedTitle != null && !cur.getAttribute('title')) cur.setAttribute('title', savedTitle);
    cur = null;
    savedTitle = null;
    if (pop) pop.classList.remove('on');
  }

  function schedule(ref) {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (cur === ref && pop && pop.classList.contains('on')) return;
    showTimer = setTimeout(function () { showTimer = null; show(ref); }, 90);
  }

  function refOf(node) {
    return node && node.closest ? node.closest('.fn-ref') : null;
  }

  document.addEventListener('mouseover', function (e) {
    var ref = refOf(e.target);
    if (ref) { schedule(ref); return; }
    // 移到别处（含浮层自己，浮层 pointer-events 是 none）就收起
    if (cur && !(pop && pop.contains(e.target))) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 120);
    }
  });
  document.addEventListener('mousedown', hide, true);
  // 任何容器滚动都会让固定定位的浮层错位，直接收起
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  return {
    show: show,
    hide: hide,
    isOpen: function () { return !!(pop && pop.classList.contains('on')); }
  };
})();
