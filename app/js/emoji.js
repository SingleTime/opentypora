/* ============================================================
 * emoji.js — `:smile` 输入补全下拉
 *
 * 与 wikilink.js 同一套交互：在块内 textarea 敲 `:名字` → 浮层列出候选，
 * ↑↓ 选择、Enter/Tab 插入、Esc 关掉；插入的是 Emoji 字形本身
 * （直接给字符，不留 `:smile:` 字面量）。
 *
 * 判定规则刻意保守，避免误触发：
 *   - `:` 前面不能是字母数字 / `:` / `/`（挡掉 12:30、http://、a::b）
 *   - 必须在 `[a-z0-9_+-]` 里，长度 1–30，且不含空格
 *   - 行内代码 `…` 与围栏块里不弹
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EmojiPick = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var pop = null, open = false, items = [], idx = 0;
  var ta = null, start = 0, query = '';

  /* ---------------------------------------------------------- 纯函数
   * match(q, names, limit) → [{ name, ch, score }]
   * 打分：0 前缀命中 / 1 词段命中（`_q`）/ 2 中间命中；
   * 同分按名字短的优先（`:sm` 时 smile 排 smiling_face 前），再按字典序。
   */
  function score(name, q) {
    var n = name.toLowerCase();
    if (n.indexOf(q) === 0) return 0;
    if (n.indexOf('_' + q) >= 0) return 1;
    return 2;
  }

  function match(q, names, limit) {
    q = String(q == null ? '' : q).toLowerCase();
    names = names || [];
    if (!q) return [];
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name.toLowerCase().indexOf(q) < 0) continue;
      out.push({ name: name, score: score(name, q) });
    }
    out.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return limit ? out.slice(0, limit) : out;
  }

  /* 从「光标前的文本」里找出正在输入的 shortcode；
   * 返回 { start, query }（start 是那个 `:` 的绝对位置）或 null。 */
  function triggerAt(text, pos) {
    var before = String(text == null ? '' : text).slice(0, pos);
    var m = /(^|[^A-Za-z0-9_:/])(:)([A-Za-z0-9_+\-]{1,30})$/.exec(before);
    if (!m) return null;
    return { start: pos - m[3].length - 1, query: m[3] };
  }

  /* 不支持的写法：行内代码 / 围栏块。
   * 围栏要「从文档开头逐行扫」才知道光标在不在块内——只看当前行会漏掉
   * 「```js 下一行正在输入」这种情况。 */
  function inCode(text, pos) {
    var t = String(text == null ? '' : text);
    pos = pos == null ? t.length : pos;
    var before = t.slice(0, pos);
    var lineStart = before.lastIndexOf('\n') + 1;
    var lines = t.slice(0, lineStart).split('\n');
    var fence = null;
    for (var i = 0; i < lines.length; i++) {
      var fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (!fm) continue;
      var ch = fm[1].charAt(0);
      if (fence === null) fence = ch;
      else if (ch === fence) fence = null;
    }
    if (fence !== null) return true;
    var cur = before.slice(lineStart);
    if (/^ {0,3}(`{3,}|~{3,})/.test(cur)) return true;
    return (cur.match(/`/g) || []).length % 2 === 1;
  }

  /* ---------------------------------------------------------- 数据 */
  function names() {
    var M = root.MD;
    if (M && M.emojiNames) {
      try { return M.emojiNames(); } catch (e) { return []; }
    }
    return [];
  }

  function glyph(name) {
    var M = root.MD;
    if (!M) return '';
    try { return M.emojiOf(name) || ''; } catch (e) { return ''; }
  }

  /* ---------------------------------------------------------- 视图 */
  function doc() { return root.document; }

  function box() {
    if (pop) return pop;
    pop = doc().createElement('div');
    pop.className = 'emoji-pop';
    pop.setAttribute('role', 'listbox');
    doc().body.appendChild(pop);
    return pop;
  }

  function caretPos() {
    var r = ta.getBoundingClientRect();
    var cs = root.getComputedStyle(ta);
    var lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 15) * 1.6;
    var pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var line = (ta.value.slice(0, pos).match(/\n/g) || []).length;
    var top = r.top + line * lh - (ta.scrollTop || 0) + lh + 4;
    if (top + 240 > root.innerHeight) {
      top = Math.max(8, r.top + line * lh - (ta.scrollTop || 0) - 244);
    }
    return { top: top, left: r.left + 6, width: Math.min(Math.max(r.width, 200), 320) };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render() {
    var p = box();
    if (idx >= items.length) idx = Math.max(0, items.length - 1);
    var html = '';
    if (!items.length) {
      html = '<div class="emoji-empty">没有匹配的表情</div>';
    } else {
      items.forEach(function (it, i) {
        html += '<button type="button" class="emoji-item' + (i === idx ? ' on' : '') +
          '" data-i="' + i + '">' +
          '<span class="emoji-ch">' + esc(glyph(it.name)) + '</span>' +
          '<span class="emoji-name">:' + esc(it.name) + ':</span></button>';
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

  function close() {
    open = false;
    items = [];
    ta = null;
    if (pop) pop.classList.remove('on');
  }

  /* 插入字形：替换掉 `:查询` 这一段 */
  function choose(i) {
    var it = items[i];
    if (!it || !ta) return;
    var ch = glyph(it.name);
    if (!ch) return;
    var v = ta.value;
    var end = ta.selectionStart == null ? v.length : ta.selectionStart;
    var head = v.slice(0, start) + ch;
    ta.value = head + v.slice(end);
    var at = head.length;
    try { ta.setSelectionRange(at, at); } catch (e) {}
    ta.dispatchEvent(new root.Event('input', { bubbles: true }));
    close();
    try { ta.focus(); } catch (e) {}
  }

  /* ---------------------------------------------------------- 输入 */
  function onInput(e) {
    var t = e.target;
    if (!t || (t.tagName !== 'TEXTAREA' && !t.__live)) return;
    if (!t.classList.contains('src') && t.id !== 'split-src') return;
    // 严格模式关掉了 emoji 渲染，补全也没意义
    var M = root.MD;
    if (M && M.isStrict && M.isStrict()) return close();
    // wiki 选单占着的时候别抢（两者不会同时出现，但保守处理）
    if (root.WikiPick && root.WikiPick.isOpen && root.WikiPick.isOpen()) return close();

    var pos = t.selectionStart;
    if (pos == null) return close();
    if (inCode(t.value, pos)) return close();
    var tr = triggerAt(t.value, pos);
    if (!tr) return close();
    var hits = match(tr.query, names(), 8);
    if (!hits.length) return close();
    ta = t; start = tr.start; query = tr.query; idx = 0;
    items = hits;
    render();
  }

  /* 只在浏览器里挂事件；Node 单测只 require 纯函数 */
  if (root.document && root.document.addEventListener) boot();

  function boot() {
    doc().addEventListener('input', onInput, true);

    doc().addEventListener('keydown', function (e) {
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
        if (!items.length) return;
        e.preventDefault(); e.stopPropagation();
        choose(idx);
      }
    }, true);

    doc().addEventListener('mousedown', function (e) {
      if (!open) return;
      var it = e.target.closest && e.target.closest('.emoji-item');
      if (it) {
        e.preventDefault(); e.stopPropagation();
        choose(+it.getAttribute('data-i'));
        return;
      }
      if (pop && pop.contains(e.target)) return;
      close();
    }, true);
  }

  return {
    match: match,
    triggerAt: triggerAt,
    inCode: inCode,
    isOpen: function () { return open; },
    items: function () { return items.slice(); },
    choose: choose,
    close: close
  };
});
