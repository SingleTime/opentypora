/* ============================================================
 * split.js — 分栏模式：左边源码，右边实时预览
 *
 * 数据流：左侧 textarea 是唯一真源（Editor.getSplitValue()），
 *   输入 → 防抖 90ms → Editor.setSplitSource() 更新模型（大纲/字数/自动保存）
 *                    → 重渲染右侧预览 + 行号
 * 交互：
 *   - 滚动任一侧，另一侧按滚动比例跟随（可关掉）
 *   - 点右侧某一块 → 光标跳到左侧对应位置
 *   - 中缝可拖动改比例，比例与开关记忆在 localStorage
 * ============================================================ */
var Split = (function () {
  'use strict';

  var VIEW, LEFT, TA, PREV, PREVIN, GUTTER, GUTTERIN, CODE, POS, WRAPBTN, SYNCBOX, DIVIDER;
  var on = false;
  var blocks = [];
  var renderTimer = null, posTick = null;
  var lockUntil = 0;
  var ratio = 0.5;
  var wrap = true;

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }

  /* ------------------------------------------------ 渲染 */
  function buildHTML(src) {
    var m = MD.parse(src == null ? '' : src);
    blocks = m.blocks || [];
    if (!blocks.length) return '';
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      var r = MD.renderBlock(blocks[i]);
      // 注意：这里 parse 的是整篇源码，所以行内 data-s 本身就是整篇的绝对偏移
      // （主编辑器按块 re-parse，那边的 data-s 才是块内相对偏移）
      out += '<div class="blk ' + r.cls + '" data-i="' + i + '">' + r.html + '</div>';
    }
    return out;
  }

  function refresh(scrollKeep) {
    if (!on || !TA) return;
    var src = TA.value;
    var html = buildHTML(src);
    PREVIN.innerHTML = html || '<div class="split-empty">这里会实时显示排版结果 —— 在左侧开始写吧。</div>';
    // 标题锚点 / [TOC] / 脚注编号
    try { if (window.Doc) Doc.decorate(PREVIN); } catch (e) {}
    try { if (window.WikiPick) WikiPick.decorateLinks(PREVIN); } catch (e) {}
    drawGutter();
    updatePos();
    // 任务清单在预览里只读
    Array.prototype.forEach.call(PREVIN.querySelectorAll('input.task'), function (b) { b.disabled = true; });
    if (scrollKeep) syncFromTextarea();
  }

  function drawGutter() {
    var n = (TA.value.match(/\n/g) || []).length + 1;
    if (GUTTERIN.getAttribute('data-n') === String(n)) return;
    var arr = new Array(n);
    for (var i = 0; i < n; i++) arr[i] = i + 1;
    GUTTERIN.textContent = arr.join('\n');
    GUTTERIN.setAttribute('data-n', String(n));
  }

  function lineColOf(text, pos) {
    var head = text.slice(0, pos);
    var line = (head.match(/\n/g) || []).length + 1;
    var col = pos - (head.lastIndexOf('\n') + 1) + 1;
    return { line: line, col: col };
  }

  function updatePos() {
    if (!on || !POS) return;
    var lc = lineColOf(TA.value, TA.selectionEnd);
    POS.textContent = '行 ' + lc.line + ' · 列 ' + lc.col;
  }

  /* ------------------------------------------------ 滚动同步 */
  function movingRatio(el) {
    var max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return 0;
    return el.scrollTop / max;
  }

  function applyRatio(el, r) {
    var max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    el.scrollTop = Math.round(r * max);
  }

  function syncFromTextarea() {
    if (!SYNCBOX.checked) return;
    if (lockUntil > Date.now()) return;
    lockUntil = Date.now() + 70;
    applyRatio(PREV, movingRatio(TA));
    GUTTERIN.style.transform = 'translateY(' + (-TA.scrollTop) + 'px)';
  }

  function syncFromPreview() {
    if (lockUntil > Date.now()) return;
    lockUntil = Date.now() + 70;
    applyRatio(TA, movingRatio(PREV));
  }

  /* ------------------------------------------------ 预览点击 → 跳到源码 */
  function jumpToSource(i) {
    var b = blocks[i];
    if (!b) return;
    var pos = b.start || 0;
    TA.focus();
    TA.setSelectionRange(pos, pos);
    var r = Editor.caretRectInTextarea(TA, pos);
    if (r) {
      var box = TA.getBoundingClientRect();
      var offset = r.top - box.top + TA.scrollTop;
      TA.scrollTop = Math.max(0, offset - TA.clientHeight / 3);
    }
    updatePos();
    var el = PREVIN.querySelector('.blk[data-i="' + i + '"]');
    if (el) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  /* ------------------------------------------------ 进入 / 退出 */
  function enter() {
    if (on) return true;
    var text = Editor.getValue();        // 必须在切模式前取（取的是当前真实全文）
    Editor.setSplitMode(true);
    on = true;
    VIEW.hidden = false;
    document.body.classList.add('split-mode');
    setWrap(wrap, true);
    applyRatioToDom(ratio);
    TA.value = text;
    TA.scrollTop = 0;
    PREV.scrollTop = 0;
    refresh();
    setTimeout(function () {
      TA.focus();
      TA.setSelectionRange(0, 0);
      // 布局稳定后再同步一次（行高/宽度此时才准）
      syncFromTextarea();
    }, 0);
    store('opentypora.split', '1');
    return true;
  }

  function exit() {
    if (!on) return false;
    on = false;
    Editor.setSplitMode(false);
    VIEW.hidden = true;
    document.body.classList.remove('split-mode');
    store('opentypora.split', '0');
    return false;
  }

  function toggle(force) {
    var want = force == null ? !on : !!force;
    return want ? enter() : exit();
  }

  /* ------------------------------------------------ 换行 / 行号 / 比例 */
  function setWrap(w, silent) {
    wrap = !!w;
    TA.setAttribute('wrap', wrap ? 'soft' : 'off');
    CODE.classList.toggle('wrap', wrap);
    WRAPBTN.classList.toggle('on', wrap);
    if (!silent) {
      store('opentypora.splitWrap', wrap ? '1' : '0');
      if (wrap) {
        GUTTERIN.style.transform = 'translateY(0)';
      } else {
        GUTTERIN.style.transform = 'translateY(' + (-TA.scrollTop) + 'px)';
      }
    }
  }

  function applyRatioToDom(r) {
    ratio = Math.min(0.78, Math.max(0.22, r));
    LEFT.style.flex = '0 0 ' + (ratio * 100).toFixed(2) + '%';
  }

  function initDivider() {
    var dragging = false;
    DIVIDER.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      DIVIDER.classList.add('dragging');
      document.body.classList.add('split-resizing');
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var box = VIEW.getBoundingClientRect();
      applyRatioToDom((e.clientX - box.left) / box.width);
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      DIVIDER.classList.remove('dragging');
      document.body.classList.remove('split-resizing');
      store('opentypora.splitRatio', String(ratio));
      syncFromTextarea();
    });
  }

  /* ------------------------------------------------ 初始化 */
  function init() {
    VIEW = $('split-view');
    LEFT = $('split-left');
    TA = $('split-src');
    PREV = $('split-prev');
    PREVIN = $('split-prev-inner');
    GUTTER = $('split-gutter');
    GUTTERIN = $('split-gutter-inner');
    CODE = $('split-code');
    POS = $('split-pos');
    WRAPBTN = $('split-wrap');
    SYNCBOX = $('split-sync');
    DIVIDER = $('split-divider');
    if (!VIEW) return;

    Editor.attachSplit(TA);
    ratio = parseFloat(load('opentypora.splitRatio', '0.5'));
    if (!isFinite(ratio) || ratio <= 0 || ratio >= 1) ratio = 0.5;
    wrap = load('opentypora.splitWrap', '1') !== '0';

    var schedule = function () {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        renderTimer = null;
        Editor.setSplitSource(TA.value);
        refresh();
      }, 90);
    };

    TA.addEventListener('input', schedule);
    TA.addEventListener('scroll', function () {
      GUTTERIN.style.transform = 'translateY(' + (-TA.scrollTop) + 'px)';
      syncFromTextarea();
    });
    PREV.addEventListener('scroll', syncFromPreview);

    ['keyup', 'click', 'select', 'focus'].forEach(function (ev) {
      TA.addEventListener(ev, function () {
        if (posTick) return;
        posTick = requestAnimationFrame(function () { posTick = null; updatePos(); });
      });
    });

    PREVIN.addEventListener('click', function (e) {
      var t = e.target;
      // 脚注角标 → 滚到定义
      var fref = t.closest ? t.closest('.fn-ref') : null;
      if (fref) {
        e.preventDefault();
        var fdef = PREVIN.querySelector('[id="fn-def-' + (fref.getAttribute('data-fn') || '').replace(/["\\]/g, '\\$&') + '"]');
        if (fdef) Doc.scrollTo(PREV, fdef, { center: true });
        return;
      }
      var wl = t.closest ? t.closest('.wiki-link') : null;
      if (wl) {
        e.preventDefault();
        if (window.OpenTyporaCmd && OpenTyporaCmd.openWiki) OpenTyporaCmd.openWiki(wl.getAttribute('data-wiki') || '');
        return;
      }
      if (t.tagName === 'A') {
        var href = t.getAttribute('href') || '';
        if (href.charAt(0) === '#') {
          // 目录 / 内部锚点：在预览容器内部滚动，别让 WebView 去导航
          e.preventDefault();
          var target = Doc.findAnchor(PREVIN, href.slice(1));
          if (target) Doc.scrollTo(PREV, target, { center: true });
          return;
        }
        if (window.Bridge && window.Bridge.openUrl) {
          e.preventDefault();
          window.Bridge.openUrl(href);
          return;
        }
      }
      // 拖选预览里的文字时不要抢光标：click 会把焦点交给左侧 textarea，
      // 从而收掉 DOM 选区，导致「选中 → 翻译」永远弹不出来
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim() &&
          sel.anchorNode && PREVIN.contains(sel.anchorNode)) return;
      var el = t.closest ? t.closest('.blk') : null;
      if (!el || !PREVIN.contains(el)) return;
      jumpToSource(+el.getAttribute('data-i'));
    });

    WRAPBTN.addEventListener('click', function () {
      setWrap(!wrap);
      refresh();
    });
    SYNCBOX.addEventListener('change', function () {
      store('opentypora.splitSync', SYNCBOX.checked ? '1' : '0');
      if (SYNCBOX.checked) syncFromTextarea();
    });
    SYNCBOX.checked = load('opentypora.splitSync', '1') !== '0';

    // 分栏里也支持 ⌘B / ⌘I / ⌘K / ⌘1-6 这类行内格式：作用在 textarea 选区上
    TA.addEventListener('keydown', onKeyDown);

    initDivider();
    window.addEventListener('resize', function () { if (on) syncFromTextarea(); });
  }

  /* ------------------------------------------------ 快捷键 */
  function wrapSelection(before, after, placeholder) {
    var v = TA.value, s = TA.selectionStart, e = TA.selectionEnd;
    var sel = v.slice(s, e) || placeholder;
    TA.value = v.slice(0, s) + before + sel + after + v.slice(e);
    TA.setSelectionRange(s + before.length, s + before.length + sel.length);
    TA.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onKeyDown(e) {
    var meta = e.metaKey || e.ctrlKey;
    var v = TA.value, s = TA.selectionStart, en = TA.selectionEnd;
    if (!meta) {
      // Tab 在列表里缩进
      if (e.key === 'Tab') {
        var ls = v.lastIndexOf('\n', s - 1) + 1;
        var le = v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s);
        var line = v.slice(ls, le);
        if (/^[ \t]*([-*+]|\d{1,9}[.)])\s/.test(line)) {
          e.preventDefault();
          if (e.shiftKey) {
            var strip = line.match(/^ {1,2}/);
            var n = strip ? strip[0].length : 0;
            TA.value = v.slice(0, ls) + v.slice(ls + n);
            TA.setSelectionRange(Math.max(ls, s - n), Math.max(ls, s - n));
          } else {
            TA.value = v.slice(0, ls) + '  ' + v.slice(ls);
            TA.setSelectionRange(s + 2, s + 2);
          }
          TA.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // 列表续行（源码态里由编辑器自己处理，这里只处理列表自动续号）
        var ls2 = v.lastIndexOf('\n', s - 1) + 1;
        var le2 = v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s);
        var line2 = v.slice(ls2, le2);
        var lm = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line2);
        if (lm && s === le2) {
          var body = line2.slice(lm[0].length);
          if (!body.trim()) {
            e.preventDefault();
            TA.value = v.slice(0, ls2) + v.slice(le2);
            TA.setSelectionRange(ls2, ls2);
            TA.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
          e.preventDefault();
          var marker = lm[2];
          if (/\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.slice(-1);
          var ins = '\n' + lm[1] + marker + lm[3];
          TA.value = v.slice(0, s) + ins + v.slice(en);
          TA.setSelectionRange(s + ins.length, s + ins.length);
          TA.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return;
    }

    var k = e.key.toLowerCase();
    if (k === 'b' && !e.shiftKey) { e.preventDefault(); wrapSelection('**', '**', '粗体'); return; }
    if (k === 'i' && !e.shiftKey) { e.preventDefault(); wrapSelection('*', '*', '斜体'); return; }
    if (k === 'e' && !e.shiftKey) { e.preventDefault(); wrapSelection('`', '`', '代码'); return; }
    if (k === 'x' && e.shiftKey) { e.preventDefault(); wrapSelection('~~', '~~', '删除线'); return; }
    if (k === 'h' && e.shiftKey) { e.preventDefault(); wrapSelection('==', '==', '高亮'); return; }
    if (k === 'k' && !e.shiftKey) {
      e.preventDefault();
      var sel = v.slice(s, en) || '链接文字';
      var nv = v.slice(0, s) + '[' + sel + '](https://)' + v.slice(en);
      TA.value = nv;
      TA.setSelectionRange(s + sel.length + 3, s + sel.length + 11);
      TA.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (/^[0-6]$/.test(k)) {
      e.preventDefault();
      var ls3 = v.lastIndexOf('\n', s - 1) + 1;
      var le3 = v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s);
      var l3 = v.slice(ls3, le3);
      var stripped = l3.replace(/^ {0,3}#{1,6}\s+/, '');
      var head = k === '0' ? '' : '#'.repeat(+k) + ' ';
      TA.value = v.slice(0, ls3) + head + stripped + v.slice(le3);
      var caret = Math.max(ls3, s + head.length - (l3.length - stripped.length));
      TA.setSelectionRange(caret, caret);
      TA.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  return {
    init: init,
    toggle: toggle,
    enter: enter,
    exit: exit,
    isOn: function () { return on; },
    refresh: refresh,
    // 供 ui.js 在刷新状态时同步按钮
    syncButton: function (btn) { if (btn) btn.classList.toggle('on', on); }
  };
})();
