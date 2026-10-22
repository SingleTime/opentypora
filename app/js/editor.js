/* ============================================================
 * editor.js — 块级 WYSIWYG 编辑引擎
 *
 * 模型：{ blocks: [{raw}], gaps: [String] }  gaps.length = blocks.length + 1
 *   raw  = 块自身的 Markdown 源码
 *   gaps = 块与块之间（含首尾）的原始间隔串，保证序列化无损
 *
 * 渲染：每个块套 <div class="blk {type}" data-i="n">。
 *   当光标进入某块时，该块内容替换为 <textarea class="src">，
 *   文字外框继承该块样式（标题仍是标题的视觉大小），失焦后回渲染态。
 *   行内文本片段带 data-s（块内相对偏移），用于「点击渲染内容 → 精确定位光标」。
 * ============================================================ */
var Editor = (function () {
  'use strict';

  var ED = null;          // #editor
  var SCROLL = null;      // #editor-scroll
  var SRCAREA = null, SRCHL = null;     // 源码模式 textarea
  var SPLITAREA = null;   // 分栏模式的源码 textarea（由 split.js 注入）
  var hooks = {};

  var st = {
    model: { blocks: [{ raw: '' }], gaps: ['', ''] },
    path: null,
    name: '未命名.md',
    dirty: false,
    editing: -1,
    theme: 'github',
    focus: false,
    typewriter: false,
    sourceMode: false,
    splitMode: false,
    undo: [],
    redo: [],
    lastTyping: 0,
    savedAt: 0,
    spellcheck: false,
    autoPair: true,
    smart: false,
    codeLineNo: false,
    livePreview: true
  };

  /* ------------------------------------------------ 工具 */
  function blockEl(i) {
    return ED.querySelector('.blk[data-i="' + i + '"]');
  }
  function srcArea() {
    // 行内实时预览态下这块是 contenteditable 的 div（也带 .src），
    // 两者共用同一套 .value / .selectionStart 的接口，见 liveSurface()
    return ED.querySelector('textarea.src, .src');
  }
  function getValue() {
    if (st.splitMode && SPLITAREA) return SPLITAREA.value;
    if (st.sourceMode && SRCAREA) return SRCAREA.value;
    return MD.serialize(st.model);
  }

  function starts() {
    var pos = (st.model.gaps[0] || '').length, arr = [];
    for (var i = 0; i < st.model.blocks.length; i++) {
      arr.push(pos);
      pos += st.model.blocks[i].raw.length + (st.model.gaps[i + 1] || '').length;
    }
    return arr;
  }

  function locate(abs) {
    var s = starts();
    for (var i = s.length - 1; i >= 0; i--) {
      if (abs >= s[i]) return { i: i, off: Math.min(abs - s[i], st.model.blocks[i].raw.length) };
    }
    return { i: 0, off: 0 };
  }

  function fit(ta) {
    if (!ta || ta.__live) return;      // live 态是普通流布局，自己撑高
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 22) + 'px';
  }

  function guessCls(raw) {
    var first = String(raw).split('\n')[0];
    var hm = /^ {0,3}(#{1,6})\s/.exec(first);
    if (hm) return 'h' + hm[1].length;
    if (/^ {0,3}(`{3,}|~{3,})/.test(first)) return 'code';
    if (/^ {0,3}>/.test(first)) return 'quote';
    if (/^ {0,3}([-*+]|\d{1,9}[.)])\s/.test(first)) return 'list';
    if (/^ {0,3}\$\$/.test(first)) return 'mathblock';
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})[ \t]*$/.test(first)) return 'hr';
    if (/^ {0,3}[|<]/.test(first)) return '';
    if (!String(raw).trim()) return 'para blank';
    return 'para';
  }

  function retag(el, raw) {
    if (!el) return;
    var cls = guessCls(raw);
    el.className = 'blk' + (cls ? ' ' + cls : '') +
      (el.classList.contains('editing') ? ' editing' : '') +
      (el.classList.contains('live') ? ' live src' : '') +
      (el.classList.contains('near') ? ' near' : '');
  }

  /* ------------------------------------------------ 渲染 */
  function blockHTML(i) {
    var raw = st.model.blocks[i].raw;
    var p = MD.parse(raw);
    if (!p.blocks.length) return '<div class="blk para blank" data-i="' + i + '"><br></div>';
    if (p.blocks.length === 1) {
      var r = MD.renderBlock(p.blocks[0]);
      return '<div class="blk ' + r.cls + '" data-i="' + i + '">' + r.html + '</div>';
    }
    var inner = p.blocks.map(function (b) {
      var rr = MD.renderBlock(b);
      return '<div class="blk ' + rr.cls + '">' + rr.html + '</div>';
    }).join('');
    return '<div class="blk multi" data-i="' + i + '">' + inner + '</div>';
  }

  function render() {
    if (st.model.blocks.length === 0) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    var out = '';
    for (var i = 0; i < st.model.blocks.length; i++) out += blockHTML(i);
    ED.innerHTML = out;
    ED.classList.toggle('empty-doc', st.model.blocks.length === 1 && st.model.blocks[0].raw === '');
    lastNear = '';          // 节点全换了，nav 缓存失效
    decorate();
    // 拼写波浪线：只在开关打开时干事，关着时 Spell.paint 直接返回 0
    try { if (window.Spell) Spell.paint(ED); } catch (e) {}
  }

  function decorate() {
    // 文档级装饰：标题锚点 / [TOC] / 脚注编号
    try { if (window.Doc) Doc.decorate(ED); } catch (e) {}
    // wiki 坏链标记（文件树为空时自动跳过）
    try { if (window.WikiPick) WikiPick.decorateLinks(ED); } catch (e) {}
    // 代码块：语言选择 + 复制
    Array.prototype.forEach.call(ED.querySelectorAll('.blk.code'), function (blk) {
      var i = +blk.getAttribute('data-i');
      var sel = blk.querySelector('.code-lang-sel');
      if (sel) {
        sel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        sel.addEventListener('click', function (e) { e.stopPropagation(); });
        sel.addEventListener('change', function () { setCodeLang(i, sel.value); });
      }
      var cp = blk.querySelector('.code-copy');
      if (cp) {
        cp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        cp.addEventListener('click', function (e) {
          e.stopPropagation();
          var code = blk.querySelector('pre code');
          var txt = code ? code.textContent : '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt);
          } else {
            var ta = document.createElement('textarea');
            ta.value = txt; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (err) {}
            document.body.removeChild(ta);
          }
          cp.textContent = '已复制';
          setTimeout(function () { cp.textContent = '复制'; }, 1200);
        });
      }
    });

    // 任务清单勾选
    Array.prototype.forEach.call(ED.querySelectorAll('input.task'), function (box) {
      box.disabled = false;
      box.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      box.addEventListener('change', function (e) {
        e.stopPropagation();
        toggleTask(box);
      });
    });
  }

  // 改代码块语言：只动第一行围栏，其余原文不变
  function setCodeLang(i, lang) {
    var b = st.model.blocks[i];
    if (!b || b.type !== 'code') return;
    var lines = b.raw.split('\n');
    var m = /^(\s*(?:`{3,}|~{3,}))(.*)$/.exec(lines[0] || '');
    if (!m) return;
    lines[0] = m[1] + (lang && lang !== 'text' ? lang : '');
    b.raw = lines.join('\n');
    b.lang = lang === 'text' ? '' : lang;
    snapshot();
    render();
    bumpDirty();
  }

  function toggleTask(box) {
    var el = box.closest('.blk');
    if (!el) return;
    var i = +el.getAttribute('data-i');
    var idx = Array.prototype.indexOf.call(ED.querySelectorAll('input.task'), box);
    var line = 0, seen = -1;
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var parts = raw.split('\n');
    for (var k = 0; k < parts.length; k++) {
      if (/^\s*[-*+]\s+\[[ xX]\]/.test(parts[k])) {
        seen++;
        if (seen === idx) { line = k; break; }
      }
    }
    var checked = box.checked;
    parts[line] = parts[line].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
    st.model.blocks[i].raw = parts.join('\n');
    render();
    bumpDirty();
  }

  /* ------------------------------------------------ 编辑态 */
  function enterEdit(i, offset) {
    if (st.sourceMode) return;
    var el = blockEl(i);
    if (!el) return;
    if (st.editing === i) {
      var ex = srcArea();
      if (ex) {
        var o = offset == null ? ex.value.length : Math.max(0, Math.min(offset, ex.value.length));
        ex.focus();
        ex.setSelectionRange(o, o);
        if (st.typewriter) centerCaret();
        refreshFocus();
      }
      return;
    }
    if (st.editing >= 0) exitEdit();

    var raw = st.model.blocks[i].raw;
    st.editing = i;

    // 行内标记能藏的块走 live（渲染态直接可编辑），其余仍是源码 textarea
    if (liveOK(i, el)) { enterLive(i, el, offset); return; }

    el.className = 'blk ' + (guessCls(raw) || '') + ' editing';
    el.innerHTML = '';
    // 光标行高亮条垫在 textarea 底下（textarea 背景透明，能透出来）
    if (window.Caret) el.appendChild(Caret.makeLine());
    var ta = document.createElement('textarea');
    ta.className = 'src';
    ta.value = raw;
    ta.spellcheck = !!st.spellcheck;
    ta.rows = 1;
    ta.setAttribute('wrap', 'soft');
    el.appendChild(ta);
    fit(ta);
    ta.focus();
    var off = offset == null ? raw.length : Math.max(0, Math.min(offset, raw.length));
    ta.setSelectionRange(off, off);

    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('paste', onPaste);
    ta.addEventListener('keyup', onCaretMove);
    ta.addEventListener('click', onCaretMove);
    ta.addEventListener('select', onCaretMove);
    if (st.typewriter) centerCaret();
    refreshFocus();

    // 空块占位提示
    var ph = document.getElementById('block-hint');
    if (ph) ph.style.display = 'none';
  }

  function exitEdit() {
    var i = st.editing;
    if (i < 0) return;
    st.editing = -1;
    var el = blockEl(i);
    refreshFocus();
    if (!el) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = blockHTML(i);
    var node = tmp.firstChild;
    if (node) {
      el.parentNode.replaceChild(node, el);
      // 只重画这一块：整篇重画在长文档里会白扫一遍所有文本节点
      try { if (window.Spell) Spell.paint(node); } catch (e) {}
    }
  }

  /* ------------------------------------------------ 行内实时预览（live）
   *
   * 做法：把「渲染好的这个块」直接变成 contenteditable，标记不在 DOM 里；
   * 光标进到某一段标记区间时，再把开闭标记作为文本插回那一段的首尾。
   *
   * 为什么不是「textarea 里把标记删掉」：textarea 是纯文本控件，删掉 ** 之后
   * 那两个字也不会变成粗体 —— 只是少了两颗星，信息更少，不如不删。要真的
   * 看见粗体，输入面就得是渲染态，这是唯一的路。
   *
   * 原文始终是唯一真源：DOM 里改了什么，按「文本前后差异」翻译回 raw，
   * 再按 raw 决定要不要重画。接口对齐 textarea（.value / .selectionStart /
   * .setSelectionRange），所以上面那一整套按键、自动配对、撤销逻辑不用动。
   */

  /* 这些原子在 live 态里没法藏标记（链接的 URL 在括号里、公式是渲染出来的），
   * 出现就退回 textarea。 */
  var LIVE_BAD = 'code, a, img, .math-inline, .fn-ref, .wiki-link, .raw-html, .emoji,' +
                 ' input, .mermaid-slot, .toc-item';

  function escHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function liveOK(i, el) {
    if (!st.livePreview || !el || !window.Live) return false;
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    if (!Live.canLive(raw)) return false;
    if (el.querySelector(LIVE_BAD)) return false;
    return true;
  }

  /* 前缀要不要露出来：只有标题的前缀会藏，且光标落在行首（正文最前面）时才露。
   * 光标在正文里时藏起来 —— 这时看到的就是渲染态，`## ` 不占视觉位置；
   * 一按左键 / 点行首就现形，删掉它标题就变回正文（和 Typora 一个手感）。 */
  function wantPrefix(raw, caret) {
    if (!window.Live) return false;
    if (Live.prefixKind(raw) !== 'heading') return false;
    var pre = Live.prefix(raw);
    return pre > 0 && caret != null && caret <= pre;
  }

  /* 块内渲染：标题的 `## ` 一律不进 DOM（要露的时候由 syncReveal 以标记节点的
   * 形式插回去），列表 `- ` / 引用 `> ` 的前缀带缩进语义，照原样作为正文渲染。
   * 前缀那截也套 data-s，文本节点的原文偏移才算得对。 */
  function liveInner(raw) {
    var pre = window.Live ? Live.prefix(raw) : 0;
    var hid = window.Live && Live.prefixKind(raw) === 'heading' ? pre : 0;
    var head = raw.slice(hid, pre);
    var body = raw.slice(pre);
    var out = '';
    if (head) out += '<span data-s="' + hid + '">' + escHTML(head) + '</span>';
    if (body) out += MD.renderInline(body, pre);
    else if (!head) out += '<br>';
    return out;
  }

  /* DOM 里的文本节点 → {node, disp（显示偏移）, len, rs（原文偏移）, mk}
   * rs 由 data-s 锚点算：文本片段本身带 data-s，插进去的标记文本挂在
   * 标记元素上、按「该元素内第几个字符」自然落在正确的原文位置。
   *
   * disp 只累加非标记节点 —— 标记是「临时露出来的」，它不占显示坐标，
   * 否则同一段文字在有标记/没标记两种状态下会算出两套偏移。 */
  function textMap(el) {
    var out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
    var disp = 0, last = 0;
    while ((n = w.nextNode())) {
      var len = n.nodeValue.length;
      if (!len) continue;
      var p = n.parentNode;
      var mk = !!(p && p.getAttribute && p.getAttribute('data-mk'));
      var rs = spanOffsetIn(el, n, 0);
      if (rs == null || rs < 0) rs = last;      // 没有 data-s 的野节点：接在上一个后面
      if (rs < last) rs = last;
      out.push({ node: n, disp: disp, len: len, rs: rs, mk: mk });
      if (!mk) disp += len;
      last = rs + len;
    }
    return out;
  }

  /* 显示偏移 → 原文偏移。
   * 边界上是有歧义的：「一段」和「粗体」之间那一点，对应原文的 2（** 之前）
   * 还是 4（** 之后）？看调用方要干什么：
   *   bias='start' 插入点 / 选区起点 → 算到后一个片段的开头（字打在这里）
   *   bias='end'   选区终点 → 算到前一个片段的末尾（删到这儿为止） */
  function rawAtDisplay(el, disp, rawLen, bias, map) {
    map = map || textMap(el);
    if (!map.length) return disp <= 0 ? 0 : rawLen;
    for (var i = 0; i < map.length; i++) {
      var m = map[i];
      if (m.mk) continue;
      if (disp < m.disp + m.len) return Math.min(m.rs + Math.max(0, disp - m.disp), rawLen);
      if (disp === m.disp + m.len) {
        if (bias === 'end') return Math.min(m.rs + m.len, rawLen);
        var nx = null;
        for (var j = i + 1; j < map.length; j++) if (!map[j].mk) { nx = map[j]; break; }
        return Math.min(nx ? nx.rs : m.rs + m.len, rawLen);
      }
    }
    return rawLen;
  }

  function domOfRaw(el, off, rawLen) {
    var map = textMap(el);
    if (!map.length) return { node: el, off: 0 };
    // 正好落在露出来的标记里：把光标留在标记里，否则删不掉那两颗星
    for (var k = 0; k < map.length; k++) {
      var mk = map[k];
      if (mk.mk && off > mk.rs && off < mk.rs + mk.len) return { node: mk.node, off: off - mk.rs };
    }
    var best = null;
    for (var i = 0; i < map.length; i++) if (!map[i].mk && map[i].rs <= off) best = map[i];
    if (!best) {
      for (var j = 0; j < map.length; j++) if (!map[j].mk) { best = map[j]; break; }
    }
    if (!best) best = map[0];
    var inner = off - best.rs;
    return { node: best.node, off: Math.max(0, Math.min(inner, best.len)) };
  }

  /* DOM 位置（节点 + 偏移）→ 原文偏移 */
  function rawAtPoint(el, node, off, rawLen) {
    if (node === el) return off === 0 ? 0 : rawLen;      // 整块选中
    if (node.nodeType === 3) {
      var map = textMap(el);
      for (var i = 0; i < map.length; i++) {
        if (map[i].node === node) return Math.min(map[i].rs + off, rawLen);
      }
      // 文本节点换了但不在表里（正在组字时常见）：按位置就近取
    }
    var host = node.nodeType === 1 ? node : node.parentNode;
    if (!host || !el.contains(host)) return rawLen;
    // 元素节点：取它里面第一个文本节点的起点
    var w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null), t;
    while ((t = w.nextNode())) {
      var map2 = textMap(el);
      for (var k = 0; k < map2.length; k++) if (map2[k].node === t) return map2[k].rs;
    }
    return rawLen;
  }

  function liveCaret(el) {
    var i = +el.getAttribute('data-i');
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var a0 = el.__caret == null ? raw.length : el.__caret;
    var b0 = el.__caretEnd == null ? a0 : el.__caretEnd;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { start: a0, end: b0 };
    var r = sel.getRangeAt(0);
    // 焦点跑到查找框/别的块上时选区会收起来 —— 记住上一次的区间，
    // 选区在失焦后仍然算数（textarea 就是这个行为，别让上层逻辑察觉差异）
    if (!el.contains(r.startContainer) && r.startContainer !== el) return { start: a0, end: b0 };
    var a = rawAtPoint(el, r.startContainer, r.startOffset, raw.length);
    var b = rawAtPoint(el, r.endContainer, r.endOffset, raw.length);
    if (a > b) { var t = a; a = b; b = t; }
    el.__caret = a;
    el.__caretEnd = b;
    return { start: a, end: b };
  }

  function setLiveCaret(el, s, e) {
    var i = +el.getAttribute('data-i');
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var a = Math.max(0, Math.min(s == null ? raw.length : s, raw.length));
    var b = Math.max(a, Math.min(e == null ? a : e, raw.length));
    var pa = domOfRaw(el, a, raw.length);
    var pb = b === a ? pa : domOfRaw(el, b, raw.length);
    var sel = window.getSelection();
    if (!sel) return;
    try {
      var r = document.createRange();
      r.setStart(pa.node, pa.node.nodeType === 3 ? Math.min(pa.off, pa.node.nodeValue.length) : 0);
      r.setEnd(pb.node, pb.node.nodeType === 3 ? Math.min(pb.off, pb.node.nodeValue.length) : 0);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (err) { /* 节点刚被换掉之类，下一次同步会纠正 */ }
    el.__caret = a;
    el.__caretEnd = b;
  }

  /* 把标记插回/拆下，让 DOM 与「光标在哪」一致 */
  function spliceMarkers(el, raw, tok) {
    var host = null;
    var list = el.querySelectorAll(tok.tag + '[data-s="' + tok.start + '"]');
    for (var i = 0; i < list.length; i++) {
      if (el.contains(list[i])) { host = list[i]; break; }
    }
    if (!host) return false;
    var open = raw.slice(tok.start, tok.innerStart);
    var close = raw.slice(tok.innerEnd, tok.end);
    function mk(t) {
      var s = document.createElement('span');
      s.setAttribute('data-mk', '1');
      s.setAttribute('contenteditable', 'false');
      s.className = 'live-mk';
      s.textContent = t;
      return s;
    }
    if (open) host.insertBefore(mk(open), host.firstChild);
    if (close) host.appendChild(mk(close));
    return true;
  }

  function clearMarkers(el) {
    var old = el.querySelectorAll('[data-mk]');
    for (var i = old.length - 1; i >= 0; i--) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }
  }

  /* 把标题前缀（`## `）作为一段标记插到块首。和行内标记同一套：data-mk=1，
   * 不占显示坐标（textMap 里 disp 只累加非标记节点），原文偏移由排在它后面
   * 的正文 data-s 顶着 —— 它自己没锚点，落在表里就是 [0, pre) 这段。 */
  function splicePrefix(el, raw) {
    var pre = Live.prefix(raw);
    if (pre <= 0 || !el.firstChild) return false;
    var s = document.createElement('span');
    s.setAttribute('data-mk', '1');
    s.setAttribute('contenteditable', 'false');
    s.className = 'live-mk live-mk-pre';
    s.textContent = raw.slice(0, pre);
    el.insertBefore(s, el.firstChild);
    return true;
  }

  /* 光标紧贴一段露出来的标记时，浏览器会整块吃掉那个 contenteditable=false
   * 的 span，而原文一个字没变 —— 界面和原文就脱节了。这种边界上的退格 /
   * 前删改成直接在原文上删，并且一次删掉整串连续的标记：退格一次去掉一对
   * `**`、或整个 `## `，不用逐字符按三下。 */
  function mkDelete(el, s, en, dir) {
    if (s !== en) return null;
    var i = +el.getAttribute('data-i');
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    // 标题前缀藏着的时候 DOM 里根本没有那段 span，但光标同样退不进原文，
    // 所以按「前缀长度」补一条同样的规则
    var pre = Live.prefix(raw);
    if (wantPrefix(raw, s) && dir === 'back' && s > 0) {
      return { raw: raw.slice(pre), caret: 0 };
    }
    var map = textMap(el), a = s, b = s, hit = false;
    for (var k = 0; k < map.length; k++) {
      var m = map[k];
      if (!m.mk) continue;
      var lo = m.rs, hi = m.rs + m.len;
      if (dir === 'back' && s > lo && s <= hi) { a = Math.min(a, lo); hit = true; }
      if (dir === 'fwd' && s >= lo && s < hi) { b = Math.max(b, hi); hit = true; }
    }
    if (!hit) return null;
    var next = raw.slice(0, a) + raw.slice(b);
    return { raw: next, caret: a };
  }

  function syncReveal(el, i) {
    if (!el || !el.__live || !window.Live) return;
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var c = liveCaret(el);
    var toks = Live.reveal(raw, c.start);
    var pre = wantPrefix(raw, c.start);
    var sig = pre ? 'P' : '';
    for (var k = 0; k < toks.length; k++) sig += toks[k].start + ':' + toks[k].end + ',';
    if (sig === el.__mkSig) return;
    clearMarkers(el);
    if (pre) splicePrefix(el, raw);
    for (var j = 0; j < toks.length; j++) spliceMarkers(el, raw, toks[j]);
    el.__mkSig = sig;
    setLiveCaret(el, c.start, c.end);
    el.__lastText = null;              // 显示串变了，下一次差分重新取基准
    el.__lastText = collapsedText(el);
    el.__map = textMap(el);            // 标记进出的只是节点，偏移表跟着换
  }

  /* DOM 里除标记之外的正文（用来判断「结构要不要重画」） */
  function collapsedText(el) {
    var out = '', w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var p = n.parentNode;
      if (p && p.getAttribute && p.getAttribute('data-mk')) continue;
      out += n.nodeValue;
    }
    return out;
  }

  /* 给 Caret.measure 用的两个量（惰性函数，谁调都是新鲜值）：
   * 折叠后的显示文本 + 光标在显示层的偏移。有它们，打字机居中与专注模式
   * 的高亮条就能沿用同一套镜像量法，不用为 live 再写一套几何。 */
  function liveCollapsed(el) { return collapsedText(el); }
  function liveDisplayPos(el) {
    var i = +el.getAttribute('data-i');
    var b = st.model.blocks[i];
    var raw = b ? b.raw : '';
    return rawAtDisplay(el, liveCaret(el).start, raw.length, 'start');
  }

  function appendCaretLine(el) {
    if (!window.Caret) return null;
    var old = el.querySelector('.caret-line');
    if (old) old.parentNode.removeChild(old);
    var line = Caret.makeLine();
    line.setAttribute('contenteditable', 'false');
    el.appendChild(line);
    return line;
  }

  /* 按 raw 重画这个块（标记只在对的位置出现），光标按原文偏移还原 */
  function resyncLive(el, i, caret) {
    if (!el || !el.__live) return;
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var c = caret == null ? liveCaret(el).start : caret;
    el.innerHTML = liveInner(raw);
    appendCaretLine(el);
    el.__mkSig = '';
    setLiveCaret(el, c);
    syncReveal(el, i);
    el.__lastText = collapsedText(el);
    el.__map = textMap(el);
        fit(el);
  }

  /* 编辑中形状变了（插进换行、`[`、`$` 之类）就不再适合 live：
   * 当场换回源码 textarea，别让渲染态去硬扛多行原文/原子。 */
  function demoteLive(el, i, caret) {
    if (!el || !el.__live) return false;
    var c = caret == null ? liveCaret(el).start : caret;
    var tmp = document.createElement('div');
    tmp.innerHTML = blockHTML(i);
    var node = tmp.firstChild;
    if (!node || !el.parentNode) return false;
    el.parentNode.replaceChild(node, el);
    st.editing = -1;
    enterEdit(i, c);
    return true;
  }

  /* DOM 里改了什么 → 翻成原文层的编辑。
   *
   * 两个必须点：
   *  1. 差异要用**上一次同步时**的映射表算。编辑已经把 DOM 的文本改掉了，
   *     而 data-s 还是上一版渲染写下的绝对偏移，拿改后的 DOM 重算映射，
   *     位置会整体错一段（删中间的词，结果删掉末尾的词）。
   *  2. 落完立刻重画：重画会把所有 data-s 重写成与 raw 一致的新值。 */
  function liveTranslate(el, i) {
    var raw = st.model.blocks[i] ? st.model.blocks[i].raw : '';
    var now = collapsedText(el);
    var prev = el.__lastText;
    var map = el.__map || textMap(el);
    el.__lastText = now;
    if (prev == null || !window.Live) return;
    var d = Live.diff(prev, now);
    if (!d) return;
    var s = rawAtDisplay(el, d.a, raw.length, 'start', map);
    var e2 = d.removed ? rawAtDisplay(el, d.a + d.removed, raw.length, 'end', map) : s;
    var r = Live.applyEdit(raw, s, e2, d.ins);
    if (r.raw === raw) { el.__lastText = now; return; }
    st.model.blocks[i].raw = r.raw;
    retag(el, r.raw);
    bumpDirty();
    if (window.Live && !Live.canLive(r.raw)) { demoteLive(el, i, r.caret); return; }
    resyncLive(el, i, r.caret);
  }

  /* 元素上装一套与 textarea 同名的接口，上面的逻辑就完全不用分叉 */
  var selBound = false;
  function liveSurface(el, i) {
    el.__live = true;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', st.spellcheck ? 'true' : 'false');
    el.classList.add('live', 'src');

    function rawNow() {
      var b = st.model.blocks[+el.getAttribute('data-i')];
      return b ? b.raw : '';
    }

    Object.defineProperty(el, 'value', {
      configurable: true,
      get: rawNow,
      set: function (v) {
        var idx = +el.getAttribute('data-i');
        if (!st.model.blocks[idx]) return;
        var nv = String(v == null ? '' : v);
        if (nv === st.model.blocks[idx].raw) return;
        // 与 textarea 的赋值语义对齐：赋值前的状态先进撤销栈
        if (Date.now() - (st.lastSnap || 0) > 5) snapshot();
        st.model.blocks[idx].raw = nv;
        el.__programmatic = true;
        el.__setting = true;
        if (window.Live && !Live.canLive(nv)) {
          el.__setting = false;
          demoteLive(el, idx, null);
          return;
        }
        resyncLive(el, idx, null);
        el.__setting = false;
        retag(el, nv);
      }
    });
    Object.defineProperty(el, 'selectionStart', {
      configurable: true,
      get: function () { return liveCaret(el).start; },
      set: function (v) { setLiveCaret(el, v); }
    });
    Object.defineProperty(el, 'selectionEnd', {
      configurable: true,
      get: function () { return liveCaret(el).end; },
      set: function (v) { setLiveCaret(el, liveCaret(el).start, v); }
    });
    el.setSelectionRange = function (s, e) { setLiveCaret(el, s, e); };
    el.__liveCollapsed = function () { return collapsedText(el); };
    el.__liveDisplayPos = function () { return liveDisplayPos(el); };
    el.focus = function () { HTMLElement.prototype.focus.call(el); };

    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('paste', onPaste);
    el.addEventListener('keyup', onCaretMove);
    el.addEventListener('click', onCaretMove);
    el.addEventListener('select', onCaretMove);
    el.addEventListener('compositionstart', function () { el.__composing = true; });
    el.addEventListener('compositionend', function () {
      el.__composing = false;
      var idx = +el.getAttribute('data-i');
      if (st.editing === idx) liveTranslate(el, idx);
    });
    if (!selBound) {
      selBound = true;
      document.addEventListener('selectionchange', onLiveSelChange);
    }
    return el;
  }

  function onLiveSelChange() {
    if (st.editing < 0) return;
    var el = blockEl(st.editing);
    if (!el || !el.__live) return;
    syncReveal(el, st.editing);
    if (st.focus || st.typewriter) refreshFocus();
  }

  function enterLive(i, el, offset) {
    var raw = st.model.blocks[i].raw;
    el.className = 'blk ' + (guessCls(raw) || '') + ' editing live src';
    if (!el.__live) liveSurface(el, i);
    el.__mkSig = '';
    el.innerHTML = liveInner(raw);
    appendCaretLine(el);
    el.__lastText = collapsedText(el);
    el.focus();
    setLiveCaret(el, offset == null ? raw.length : offset);
    syncReveal(el, i);
    el.__map = textMap(el);
    el.__lastText = collapsedText(el);
        if (st.typewriter) centerCaret();
    refreshFocus();
    var ph = document.getElementById('block-hint');
    if (ph) ph.style.display = 'none';
  }

  /* 光标移动后：打字机重新居中，专注模式刷新近邻与高亮条。
   * 两个开关都关着时直接返回，别在每次按键上做无用的量测。 */
  function onCaretMove() {
    if (st.editing < 0) return;
    if (!st.focus && !st.typewriter) return;
    if (st.typewriter) centerCaret();
    refreshFocus();
  }

  function centerBlock(el) {
    var r = el.getBoundingClientRect(), sr = SCROLL.getBoundingClientRect();
    var target = SCROLL.scrollTop + (r.top - sr.top) - (sr.height / 2 - r.height / 2);
    SCROLL.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /* 打字机：按「光标行」居中，不是按整块。
   * 多行块里整块居中会让光标一路往下漂（块首在中间，块尾跑到屏幕底下），
   * 所以位置算到光标那一行；软换行交给 Caret.measure 的镜像去量。 */
  function caretLineLayer() {
    var el = st.editing >= 0 ? blockEl(st.editing) : null;
    return el ? el.querySelector('.caret-line') : null;
  }

  function centerCaret() {
    var ta = srcArea();
    if (!ta) return;
    if (window.Caret) Caret.center(ta, SCROLL);
    else centerBlock(blockEl(st.editing));
  }

  /* live 态的真实光标矩形：选区的屏幕矩形（选区浮标、表情浮层要用屏幕坐标） */
  function liveRect(el) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var rr = sel.getRangeAt(0);
      if (el.contains(rr.startContainer) || rr.startContainer === el) {
        var rect = rr.getBoundingClientRect();
        if (rect && (rect.height || rect.width)) return rect;
      }
    }
    return el.getBoundingClientRect();
  }

  /* 专注模式的近邻块标记 + 光标行高亮条，两件都在「光标动了」时刷一次 */
  var lastNear = '';
  function refreshFocus() {
    if (!ED) return;
    // 两个开关都关时不做量测；顺手把缓存清掉，等下次打开重新算一遍
    if (!st.focus && !st.typewriter) { lastNear = ''; return; }
    var total = st.model.blocks.length;
    var near = window.Caret ? Caret.nearOf(st.editing, total) : [];
    var key = near.join(',');
    if (key !== lastNear) {
      lastNear = key;
      var list = ED.querySelectorAll('.blk[data-i]');
      for (var i = 0; i < list.length; i++) {
        list[i].classList.toggle('near', near.indexOf(+list[i].getAttribute('data-i')) >= 0);
      }
    }
    var layer = caretLineLayer();
    var ta = srcArea();
    if (layer && ta && window.Caret) Caret.markLine(layer, ta);
  }

  /* ------------------------------------------------ 撤销栈 */
  function snapshot() {
    var ta = srcArea();
    var abs = 0;
    if (st.editing >= 0) {
      var s = starts();
      abs = (s[st.editing] || 0) + (ta ? ta.selectionStart : 0);
    }
    st.undo.push({ src: getValue(), abs: abs });
    if (st.undo.length > 300) st.undo.shift();
    st.redo.length = 0;
    st.lastSnap = Date.now();
  }

  function restore(snap) {
    // 分栏 / 源码模式下真源是 textarea，撤销要写回它，否则界面不跟着变
    if (st.splitMode && SPLITAREA) {
      SPLITAREA.value = snap.src;
      setSplitSource(snap.src);
      var ps = Math.max(0, Math.min(snap.abs || 0, snap.src.length));
      SPLITAREA.setSelectionRange(ps, ps);
      return;
    }
    if (st.sourceMode && SRCAREA) {
      SRCAREA.value = snap.src;
      st.model = MD.parse(snap.src);
      if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
      st.dirty = true;
      var px = Math.max(0, Math.min(snap.abs || 0, snap.src.length));
      SRCAREA.setSelectionRange(px, px);
      hooks.onChange && hooks.onChange(st);
      scheduleAutosave();
      return;
    }
    st.model = MD.parse(snap.src);
    if (st.model.blocks.length === 0) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    st.editing = -1;
    render();
    var loc = locate(snap.abs);
    enterEdit(loc.i, loc.off);
    hooks.onChange && hooks.onChange(st);
  }

  function undo() {
    if (!st.undo.length) return;
    var ta = srcArea();
    var abs = 0;
    if (st.editing >= 0) abs = (starts()[st.editing] || 0) + (ta ? ta.selectionStart : 0);
    st.redo.push({ src: getValue(), abs: abs });
    restore(st.undo.pop());
  }

  function redo() {
    if (!st.redo.length) return;
    var ta = srcArea();
    var abs = 0;
    if (st.editing >= 0) abs = (starts()[st.editing] || 0) + (ta ? ta.selectionStart : 0);
    st.undo.push({ src: getValue(), abs: abs });
    restore(st.redo.pop());
  }

  /* ------------------------------------------------ 输入处理 */
  function bumpDirty() {
    st.dirty = true;
    hooks.onChange && hooks.onChange(st);
    scheduleAutosave();
  }

  var autosaveTimer = null;
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      if (hooks.onAutosave) hooks.onAutosave(st, getValue());
    }, 700);
  }

  /* ------------------------------------------------ 自动配对 / 智能标点
   * 只在块内 textarea 生效；代码片段（`…` / ``` 围栏）里一律不转换。
   */
  var PAIRS = {
    '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`', '$': '$',
    '*': '*', '_': '_', '~': '~', '=': '='
  };
  var SYMMETRIC = /["'`$*_~=]/;

  function inCodeSpan(v, pos) {
    var lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    var lineEnd = v.indexOf('\n', pos); if (lineEnd < 0) lineEnd = v.length;
    var before = v.slice(lineStart, pos);
    if (/^\s*(```|~~~)/.test(v.slice(lineStart))) return true;      // 围栏块
    return (before.match(/`/g) || []).length % 2 === 1;             // 行内代码
  }

  function tryPair(e, ta, i, v, s, en) {
    var key = e.key;
    if (!PAIRS[key]) return false;
    if (inCodeSpan(v, s)) return false;

    if (s !== en) {                       // 有选区：两侧包起来
      e.preventDefault();
      var sel = v.slice(s, en);
      var wrapped = key + sel + PAIRS[key];
      setValueAndCaret(ta, i, v.slice(0, s) + wrapped + v.slice(en), s + wrapped.length);
      return true;
    }
    var next = v[s] || '', prev = s > 0 ? v[s - 1] : '';
    // 再打一次同一个符号 → 跳过闭合字符
    if (SYMMETRIC.test(key) && next === key) {
      e.preventDefault();
      ta.setSelectionRange(s + 1, s + 1);
      return true;
    }
    // 星号/下划线/波浪线只在词边界补齐，避免把 a_b 拆成 a__b__
    if (SYMMETRIC.test(key)) {
      var atStart = !prev || /[\s([{*_~`$>"'—–]/.test(prev);
      var atEnd = !next || /[\s)\]}>.,;:!?，。；：！？、]/.test(next);
      if (!(atStart && atEnd)) return false;
    }
    e.preventDefault();
    var ins = key + PAIRS[key];
    setValueAndCaret(ta, i, v.slice(0, s) + ins + v.slice(en), s + 1);
    return true;
  }

  function trySmart(e, ta, i, v, s, en) {
    var key = e.key;
    if (s !== en) return false;
    if (inCodeSpan(v, s)) return false;
    var prev = s > 0 ? v[s - 1] : '';
    var openCtx = !prev || /[\s([{“‘"'—–\-*>]/.test(prev);

    if (key === '"') {
      e.preventDefault();
      var q = openCtx ? '“”' : '”';
      setValueAndCaret(ta, i, v.slice(0, s) + q + v.slice(en), s + (openCtx ? 1 : 1));
      return true;
    }
    if (key === "'") {
      // 词内撇号（don't）不配对，直接给右单引号
      e.preventDefault();
      var q2 = openCtx ? '‘’' : '’';
      setValueAndCaret(ta, i, v.slice(0, s) + q2 + v.slice(en), s + 1);
      return true;
    }
    if (key === '-' && prev === '-') {
      e.preventDefault();
      var p2 = s > 1 ? v[s - 2] : '';
      if (p2 === '-') {          // 第三个 - → 破折号
        setValueAndCaret(ta, i, v.slice(0, s - 2) + '—' + v.slice(en), s - 1);
      } else {                   // 第二个 - → en dash
        setValueAndCaret(ta, i, v.slice(0, s - 1) + '–' + v.slice(en), s);
      }
      return true;
    }
    if (key === '.' && prev === '.' && s > 1 && v[s - 2] === '.') {
      e.preventDefault();
      setValueAndCaret(ta, i, v.slice(0, s - 2) + '…' + v.slice(en), s - 1);
      return true;
    }
    return false;
  }

  function onInput() {
    var ta = this, i = st.editing;
    if (i < 0) return;
    var now = Date.now();
    if (ta.__live) {
      // contenteditable：DOM 变了，按差异翻回原文；组字过程中先不动。
      // 程序化赋值（.value = …）已经在 setter 里快照过，这里别再补一刀，
      // 否则一次改动压两条一样的撤销记录。
      if (!ta.__programmatic && now - st.lastTyping > 800) snapshot();
      ta.__programmatic = false;
      st.lastTyping = now;
      if (!ta.__setting && !ta.__composing) liveTranslate(ta, i);
      retag(blockEl(i), st.model.blocks[i].raw);
      if (st.typewriter) centerCaret();
      if (st.focus || st.typewriter) refreshFocus();
      bumpDirty();
      return;
    }
    if (now - st.lastTyping > 800) snapshot();
    st.lastTyping = now;
    st.model.blocks[i].raw = ta.value;
    fit(ta);
    retag(blockEl(i), ta.value);
    if (st.typewriter) centerCaret();
    if (st.focus || st.typewriter) refreshFocus();
    bumpDirty();
  }

  function setValueAndCaret(ta, i, nv, s, e) {
    snapshot();
    ta.value = nv;
    st.model.blocks[i].raw = nv;
    ta.setSelectionRange(s, e == null ? s : e);
    fit(ta);
    retag(blockEl(i), nv);
    bumpDirty();
  }

  function mergeWithPrev(i) {
    if (i <= 0) return false;
    var prev = st.model.blocks[i - 1];
    var caret = prev.raw.length;
    prev.raw = prev.raw + st.model.blocks[i].raw;
    st.editing = -1;
    st.model.blocks.splice(i, 1);
    st.model.gaps.splice(i, 1);
    render();
    enterEdit(i - 1, caret);
    bumpDirty();
    return true;
  }

  function mergeWithNext(i) {
    if (i >= st.model.blocks.length - 1) return false;
    st.model.blocks[i].raw = st.model.blocks[i].raw + st.model.blocks[i + 1].raw;
    st.model.blocks.splice(i + 1, 1);
    st.model.gaps.splice(i + 1, 1);
    st.editing = -1;
    render();
    enterEdit(i, st.model.blocks[i].raw.length);
    bumpDirty();
    return true;
  }

  function splitBlock(i, head, tail) {
    snapshot();
    st.model.blocks[i].raw = head;
    st.model.blocks.splice(i + 1, 0, { raw: tail });
    st.model.gaps.splice(i + 1, 0, '\n\n');
    st.editing = -1;
    render();
    enterEdit(i + 1, 0);
    bumpDirty();
  }

  function moveTo(i, off) {
    if (i < 0 || i >= st.model.blocks.length) return;
    enterEdit(i, off);
  }

  /* ------------------------------------------------ 选区 / 插入 / 替换 */
  // 用镜像 div 把 textarea 里的字符位置换算成屏幕坐标（用于翻译浮标定位）
  // 关键：必须逐点测出光标/选区端点的真实 x，只拿 textarea 的框会横跨整栏，浮标就会飘到左侧。
  var MIRROR_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textRendering',
    'wordBreak', 'overflowWrap', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft'];

  function openMirror(ta) {
    var box = ta.getBoundingClientRect();
    var cs = window.getComputedStyle(ta);
    var mirror = document.createElement('div');
    for (var i = 0; i < MIRROR_PROPS.length; i++) {
      var p = MIRROR_PROPS[i];
      mirror.style[p] = cs[p];
    }
    mirror.style.position = 'fixed';
    mirror.style.left = box.left + 'px';
    mirror.style.top = box.top + 'px';
    mirror.style.margin = '0';
    mirror.style.border = '0';
    mirror.style.width = ta.clientWidth + 'px';
    mirror.style.boxSizing = 'border-box';
    mirror.style.height = 'auto';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow = 'hidden';
    mirror.style.whiteSpace = ta.getAttribute('wrap') === 'off' ? 'pre' : 'pre-wrap';
    document.body.appendChild(mirror);
    return { mirror: mirror, box: box, cs: cs, value: String(ta.value || ''), scrollTop: ta.scrollTop || 0 };
  }

  // 返回该字符位置在屏幕上的 x / y（y 为该行文字顶端），同一镜像可多次测量
  function measureInMirror(m, pos) {
    var mirror = m.mirror;
    var marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.textContent = m.value.slice(0, pos);
    mirror.appendChild(marker);
    var mr = mirror.getBoundingClientRect();
    var kr = marker.getBoundingClientRect();
    var cs = m.cs;
    var lh = parseFloat(cs.lineHeight);
    if (!isFinite(lh)) lh = (parseFloat(cs.fontSize) || 13) * 1.6;
    return {
      x: m.box.left + (parseFloat(cs.borderLeftWidth) || 0) + (kr.left - mr.left),
      y: m.box.top + (parseFloat(cs.borderTopWidth) || 0) + (kr.top - mr.top) - m.scrollTop,
      h: Math.max(lh, 16)
    };
  }

  function caretRectInTextarea(ta, pos) {
    if (!ta) return null;
    if (ta.__live) {
      var lr = liveRect(ta);
      return { left: lr.left, right: lr.left + Math.max(lr.width, 2), width: Math.max(lr.width, 2),
               top: lr.top, bottom: lr.bottom, height: lr.height, sameLine: true };
    }
    var m = openMirror(ta);
    var p = measureInMirror(m, pos == null ? ta.selectionStart : pos);
    document.body.removeChild(m.mirror);
    var w = Math.max(p.h * 0.5, 6);
    return {
      left: p.x - w / 2, right: p.x + w / 2, width: w,
      top: p.y, bottom: p.y + p.h, height: p.h,
      sameLine: true
    };
  }

  // textarea 里真实选区（起止两点）的屏幕矩形；跨行时退化为整栏宽
  function selectionRectInTextarea(ta) {
    if (!ta) return null;
    if (ta.__live) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      var rr = sel.getRangeAt(0);
      if (!ta.contains(rr.startContainer) && rr.startContainer !== ta) return null;
      var rect = rr.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      return { left: rect.left, right: rect.right, width: rect.width,
               top: rect.top, bottom: rect.bottom, height: rect.height, sameLine: true };
    }
    var s = ta.selectionStart, e = ta.selectionEnd;
    if (s == null || e == null || s === e) return null;
    var m = openMirror(ta);
    var a = measureInMirror(m, s);
    var b = measureInMirror(m, e);
    document.body.removeChild(m.mirror);

    var cs = m.cs, box = m.box;
    var cL = box.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    var cR = box.left + box.width - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    var same = Math.abs(a.y - b.y) < a.h * 0.5;
    var left, right, bottom;
    if (same) {
      left = Math.min(a.x, b.x);
      right = Math.max(a.x, b.x);
      // 行尾的空格/标点常常量不到宽度，给个下限免得浮标压在选区上
      if (right - left < 2) right = left + 2;
      bottom = a.y + a.h;
    } else {
      left = cL;
      right = cR;
      bottom = b.y + b.h;
    }
    return {
      left: left, right: right, width: right - left,
      top: a.y, bottom: bottom, height: bottom - a.y,
      sameLine: same
    };
  }

  // 任意 .blk 元素内：DOM 位置 → data-s 偏移
  // （分栏预览是 parse 整篇后渲染的，data-s 本身就是整篇绝对偏移）
  function spanOffsetIn(blkEl, node, off) {
    if (!blkEl) return null;
    if (node === blkEl) {
      // 整块选中（三击 / selectNodeContents）：取块内首个 / 末个 data-s 的边界
      var sps = blkEl.querySelectorAll('[data-s]');
      if (!sps.length) return null;
      if (off === 0) return parseInt(sps[0].getAttribute('data-s'), 10) || 0;
      var last = sps[sps.length - 1];
      return (parseInt(last.getAttribute('data-s'), 10) || 0) + (last.textContent || '').length;
    }
    var host = node.nodeType === 3 ? node.parentNode : node;
    if (!host || !blkEl.contains(host)) return null;
    var span = host.closest ? host.closest('[data-s]') : null;
    if (!span || !blkEl.contains(span)) return null;
    var base = parseInt(span.getAttribute('data-s'), 10) || 0;
    var inner = 0;
    if (node.nodeType === 3 && span.contains(node)) {
      var w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT, null);
      var cur;
      while ((cur = w.nextNode())) {
        if (cur === node) break;
        inner += cur.nodeValue.length;
      }
      inner += off;
    } else {
      inner = off;
    }
    return Math.max(0, base + inner);
  }

  // 分栏右侧预览（#split-prev-inner）里的 DOM 选区 → 文档级字符偏移
  // 分栏时预览是独立容器，既不在 ED 里，块内也不带 ED 的数据，必须单独解析
  function splitPreviewSelection(sel) {
    if (!st.splitMode) return null;
    var pv = document.getElementById('split-prev-inner');
    if (!pv) return null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var text = sel.toString();
    if (!text.trim()) return null;
    var range = sel.getRangeAt(0);
    var n = range.startContainer;
    var el = n.nodeType === 1 ? n : n.parentNode;
    var blk = el && el.closest ? el.closest('.blk') : null;
    if (!blk || !pv.contains(blk)) return null;
    // 分栏预览是 parse 整篇后渲染的，data-s 已是整篇绝对偏移，不必再加块基址
    var a = spanOffsetIn(blk, range.startContainer, range.startOffset);
    var b = spanOffsetIn(blk, range.endContainer, range.endOffset);
    var lim = SPLITAREA ? SPLITAREA.value.length : Infinity;
    if (a == null || b == null) { a = b = null; }
    else {
      if (a > b) { var t = a; a = b; b = t; }
      a = Math.min(a, lim);
      b = Math.min(b, lim);
    }
    return {
      mode: 'split-preview',
      text: text,
      block: parseInt(blk.getAttribute('data-i'), 10),
      docStart: a, docEnd: b,
      rect: range.getBoundingClientRect()
    };
  }

  // 统一「当前选中了什么」：分栏预览选中、排版态选中、块内编辑态选中、源码态选中、分栏源码选中
  function selectionContext() {
    var sel = window.getSelection();

    // 分栏模式：先在右侧预览里找真实 DOM 选区（textarea 失焦时 window 选区会收起，
    // 所以这里不会跟下面 textarea 分支互相干扰）
    if (st.splitMode) {
      var prv = splitPreviewSelection(sel);
      if (prv) return prv;
    }

    if (st.splitMode && SPLITAREA) {
      var sp = SPLITAREA;
      if (sp.selectionStart === sp.selectionEnd) return null;
      var rectS = selectionRectInTextarea(sp);
      if (!rectS) return null;
      return {
        mode: 'split',
        text: sp.value.slice(sp.selectionStart, sp.selectionEnd),
        block: -1,
        rect: rectS
      };
    }

    if (st.sourceMode) {
      var ta = SRCAREA;
      if (!ta || ta.selectionStart === ta.selectionEnd) return null;
      var rectX = selectionRectInTextarea(ta) || (function () {
        var r0 = ta.getBoundingClientRect();
        return { left: r0.left, right: r0.right, top: r0.top + 8, bottom: r0.top + 40, width: r0.width, height: 32 };
      })();
      return {
        mode: 'source',
        text: ta.value.slice(ta.selectionStart, ta.selectionEnd),
        block: -1,
        rect: rectX
      };
    }

    // 块正在以 textarea 编辑
    var et = srcArea();
    if (st.editing >= 0 && et && et.selectionStart !== et.selectionEnd) {
      var r1 = et.getBoundingClientRect();
      var rectE = selectionRectInTextarea(et);
      return {
        mode: 'edit',
        text: et.value.slice(et.selectionStart, et.selectionEnd),
        block: st.editing,
        rect: rectE || { left: r1.left, right: r1.right, top: r1.top, bottom: r1.top + Math.min(r1.height, 60), width: r1.width, height: Math.min(r1.height, 60) }
      };
    }

    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var text = sel.toString();
    if (!text.trim()) return null;
    var range = sel.getRangeAt(0);
    var n = range.startContainer;
    var el = n.nodeType === 1 ? n : n.parentNode;
    var blk = el && el.closest ? el.closest('.blk') : null;
    if (!blk || !ED.contains(blk)) return null;
    var bi = parseInt(blk.getAttribute('data-i'), 10);
    var rect = range.getBoundingClientRect();
    var rr = selectionRawRange(bi);
    return {
      mode: 'rendered',
      text: text,
      block: bi,
      rStart: rr ? rr.start : null,
      rEnd: rr ? rr.end : null,
      rect: rect
    };
  }

  // 渲染态选区 → 块内 raw 偏移（与 caretFromPoint 同一套 data-s 映射）
  function rawOffsetInBlock(node, off, i) {
    var el = blockEl(i);
    if (!el) return null;
    var rawLen = st.model.blocks[i] ? st.model.blocks[i].raw.length : 0;
    if (node === el) return off === 0 ? 0 : rawLen;
    var host = node.nodeType === 3 ? node.parentNode : node;
    if (!host || !el.contains(host)) return null;
    var span = host.closest ? host.closest('[data-s]') : null;
    if (!span || !el.contains(span)) return null;
    var base = parseInt(span.getAttribute('data-s'), 10) || 0;
    var inner = 0;
    if (node.nodeType === 3 && span.contains(node)) {
      var w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT, null);
      var cur;
      while ((cur = w.nextNode())) {
        if (cur === node) break;
        inner += cur.nodeValue.length;
      }
      inner += off;
    } else {
      inner = off;
    }
    return Math.max(0, Math.min(base + inner, rawLen));
  }

  function selectionRawRange(i) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var r = sel.getRangeAt(0);
    var a = rawOffsetInBlock(r.startContainer, r.startOffset, i);
    var b = rawOffsetInBlock(r.endContainer, r.endOffset, i);
    if (a == null || b == null) return null;
    if (a > b) { var t = a; a = b; b = t; }
    return { start: a, end: b };
  }

  // 在指定块之后插入一个新块
  function insertBlockAfter(i, raw) {
    var n = Math.max(-1, Math.min(i == null ? -1 : i, st.model.blocks.length - 1));
    snapshot();
    st.editing = -1;
    st.model.blocks.splice(n + 1, 0, { raw: raw });
    st.model.gaps.splice(n + 1, 0, '\n\n');
    render();
    bumpDirty();
    var el = blockEl(n + 1);
    if (el) el.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // 批量改写所有块：fn(raw, i) 返回新 raw（null / 原值表示不动）。
  // 只渲染一次，撤销栈里也只留一步 —— 图片路径批量重写走这里。
  function mapRaw(fn) {
    if (!fn) return 0;
    var n = 0, next = [];
    for (var i = 0; i < st.model.blocks.length; i++) {
      var raw = st.model.blocks[i].raw;
      var nv = fn(raw, i);
      next.push(nv == null ? raw : nv);
      if (nv != null && nv !== raw) n++;
    }
    if (!n) return 0;
    snapshot();
    st.editing = -1;
    for (var k = 0; k < next.length; k++) st.model.blocks[k].raw = next[k];
    render();
    bumpDirty();
    return n;
  }

  // 在文末插入若干段（图片批量插入用）；正在编辑块内则插到光标处
  function insertBlocks(lines) {
    if (!lines || !lines.length) return false;
    if (st.editing >= 0) {
      insertAtCaret(lines.join(' '));
      return true;
    }
    snapshot();
    st.editing = -1;
    var n = st.model.blocks.length - 1;
    for (var k = 0; k < lines.length; k++) {
      st.model.blocks.splice(n + 1 + k, 0, { raw: lines[k] });
      st.model.gaps.splice(n + 1 + k, 0, '\n\n');
    }
    render();
    bumpDirty();
    var el = blockEl(st.model.blocks.length - 1);
    if (el) el.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // 块内唯一匹配才替换，避免误伤重复文本
  function canReplaceInBlock(i, needle) {
    var b = st.model.blocks[i];
    if (!b || !needle) return false;
    var a = b.raw.indexOf(needle);
    return a >= 0 && b.raw.indexOf(needle, a + 1) < 0;
  }

  function replaceInBlock(i, needle, repl) {
    if (!canReplaceInBlock(i, needle)) return false;
    var raw = st.model.blocks[i].raw;
    var a = raw.indexOf(needle);
    snapshot();
    st.editing = -1;
    st.model.blocks[i].raw = raw.slice(0, a) + repl + raw.slice(a + needle.length);
    render();
    bumpDirty();
    return true;
  }

  // 源码模式：替换当前 textarea 选区
  function replaceSourceSelection(repl) {
    if (!st.sourceMode || !SRCAREA) return false;
    var ta = SRCAREA, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) return false;
    ta.value = ta.value.slice(0, s) + repl + ta.value.slice(e);
    ta.setSelectionRange(s, s + repl.length);
    st.dirty = true;
    hooks.onChange && hooks.onChange(st);
    scheduleAutosave();
    return true;
  }

  // 块编辑态（textarea.src）：替换当前选区
  function replaceEditSelection(repl) {
    var ta = srcArea(), i = st.editing;
    if (!ta || i < 0) return false;
    var s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) return false;
    setValueAndCaret(ta, i, ta.value.slice(0, s) + repl + ta.value.slice(e), s + repl.length);
    return true;
  }

  // 渲染态：按 raw 偏移精确替换
  function replaceRawRange(i, start, end, repl) {
    var b = st.model.blocks[i];
    if (!b || start == null || end == null || start < 0 || end > b.raw.length || start > end) return false;
    snapshot();
    st.editing = -1;
    b.raw = b.raw.slice(0, start) + repl + b.raw.slice(end);
    render();
    bumpDirty();
    return true;
  }

  /* 上面的渲染态版本会把块踢出编辑态。Code Tools 那一类命令希望在
   * 正在输入的时候也能用，所以要保留编辑态并重设光标。 */
  function replaceRawRangeKeepEdit(i, start, end, repl) {
    var ta = st.editing === i ? srcArea() : null;
    if (!ta) return replaceRawRange(i, start, end, repl);
    var cur = ta.value || '';
    if (start < 0 || end > cur.length || start > end) return false;
    snapshot();
    var nv = cur.slice(0, start) + repl + cur.slice(end);
    setValueAndCaret(ta, i, nv, Math.min(start + repl.length, nv.length));
    bumpDirty();
    return true;
  }

  // 删除整块（表格的「删除整张表格」等结构操作走这里，比留一个空块干净）
  function deleteBlock(i) {
    if (i < 0 || i >= st.model.blocks.length) return false;
    snapshot();
    st.editing = -1;
    var gaps = st.model.gaps;
    if (gaps && gaps.length > i + 1) gaps.splice(i + 1, 1);
    st.model.blocks.splice(i, 1);
    if (!st.model.blocks.length) {
      st.model.blocks.push({ type: 'para', raw: '', start: 0 });
      if (!st.model.gaps || !st.model.gaps.length) st.model.gaps = ['', ''];
    }
    render();
    bumpDirty();
    return true;
  }

  // 源码模式：在选区之后另起一段插入
  function insertSourceAfterSelection(repl) {
    if (!st.sourceMode || !SRCAREA) return false;
    var ta = SRCAREA, e = ta.selectionEnd;
    var prefix = ta.value.slice(0, e);
    var need = prefix.slice(-2) === '\n\n' ? '' : (prefix.slice(-1) === '\n' ? '\n' : '\n\n');
    var ins = need + repl;
    ta.value = prefix + ins + ta.value.slice(e);
    ta.setSelectionRange(e + ins.length, e + ins.length);
    st.dirty = true;
    hooks.onChange && hooks.onChange(st);
    scheduleAutosave();
    return true;
  }

  function onKeyDown(e) {
    var ta = this, i = st.editing;
    if (i < 0) return;
    var v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    var meta = e.metaKey || e.ctrlKey;
    var cur = st.model.blocks[i] ? st.model.blocks[i].raw : '';

    // ---- 打字增强（自动配对 / 智能标点）
    if (!meta && !e.altKey && e.key.length === 1) {
      if (st.smart && trySmart(e, ta, i, v, s, en)) return;
      if (st.autoPair && tryPair(e, ta, i, v, s, en)) return;
    }

    // ---- 撤销 / 重做
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

    // ---- 行内格式
    if (meta && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSel('**', '**', '粗体'); return; }
    if (meta && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSel('*', '*', '斜体'); return; }
    if (meta && e.key.toLowerCase() === 'e') { e.preventDefault(); wrapSel('`', '`', '代码'); return; }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); wrapSel('~~', '~~', '删除线'); return; }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); wrapSel('==', '==', '高亮'); return; }
    if (meta && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      var sel = v.slice(s, en) || '链接文字';
      var nv = v.slice(0, s) + '[' + sel + '](https://)' + v.slice(en);
      setValueAndCaret(ta, i, nv, s + sel.length + 3, s + sel.length + 11);
      return;
    }
    // ---- 标题级别 Cmd+1..6 / Cmd+0
    if (meta && /^[0-6]$/.test(e.key)) {
      e.preventDefault();
      setHeading(+e.key);
      return;
    }

    // ---- Enter
    if (e.key === 'Enter' && !e.shiftKey && !meta) {
      e.preventDefault();
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var le = v.indexOf('\n', s); if (le < 0) le = v.length;
      var line = v.slice(ls, le);
      // 引用块续行：> 之后回车继续 >，空引用行回车退出
      var qm = /^([ \t]*)>[ \t]?(.*)$/.exec(line);
      if (qm) {
        if (!qm[2].trim()) {
          var nvq = v.slice(0, ls) + v.slice(le);
          setValueAndCaret(ta, i, nvq, ls);
          return;
        }
        var insq = '\n' + qm[1] + '> ';
        var nvq2 = v.slice(0, s) + insq + v.slice(en);
        setValueAndCaret(ta, i, nvq2, s + insq.length);
        return;
      }
      var lm = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line);
      if (lm) {
        var body = line.slice(lm[0].length);
        if (!body.trim()) {
          // 空列表项 → 退出列表
          var nv0 = v.slice(0, ls) + v.slice(le);
          setValueAndCaret(ta, i, nv0, ls);
          return;
        }
        var marker = lm[2];
        if (/\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.slice(-1);
        var ins = '\n' + lm[1] + marker + lm[3];
        var nv1 = v.slice(0, s) + ins + v.slice(en);
        setValueAndCaret(ta, i, nv1, s + ins.length);
        return;
      }
      splitBlock(i, v.slice(0, s), v.slice(en));
      return;
    }
    // ---- Shift+Enter 软换行
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      var nv2 = v.slice(0, s) + '\n' + v.slice(en);
      setValueAndCaret(ta, i, nv2, s + 1);
      return;
    }

    // ---- live 边界删除：光标紧贴露出来的标记（含藏着的标题前缀）时，
    // 浏览器那一下删除碰不到原文，吞掉的只是临时插进来的 span。
    if (ta.__live && !ta.__composing && (e.key === 'Backspace' || e.key === 'Delete')) {
      var mdel = mkDelete(ta, s, en, e.key === 'Backspace' ? 'back' : 'fwd');
      if (mdel) {
        e.preventDefault();
        setValueAndCaret(ta, i, mdel.raw, mdel.caret);
        return;
      }
    }

    // ---- Backspace
    if (e.key === 'Backspace' && s === 0 && en === 0) {
      if (i === 0) return;
      e.preventDefault();
      snapshot();
      mergeWithPrev(i);
      return;
    }
    // ---- Delete 向后合并
    if (e.key === 'Delete' && s === v.length && i < st.model.blocks.length - 1) {
      e.preventDefault();
      snapshot();
      mergeWithNext(i);
      return;
    }

    // ---- 跨块移动（跳过不显示的链接定义行）
    function visPrev(k) {
      for (k = k - 1; k >= 0; k--) if (st.model.blocks[k].type !== 'linkdef') return k;
      return -1;
    }
    function visNext(k) {
      for (k = k + 1; k < st.model.blocks.length; k++) if (st.model.blocks[k].type !== 'linkdef') return k;
      return -1;
    }
    if (e.key === 'ArrowUp' && s === 0 && en === 0) {
      var pu = visPrev(i);
      if (pu < 0) return;
      e.preventDefault();
      moveTo(pu, st.model.blocks[pu].raw.length);
      return;
    }
    if (e.key === 'ArrowDown' && s === v.length) {
      var nd = visNext(i);
      if (nd < 0) return;
      e.preventDefault();
      moveTo(nd, 0);
      return;
    }
    if (e.key === 'ArrowLeft' && s === 0 && en === 0) {
      var pl = visPrev(i);
      if (pl < 0) return;
      e.preventDefault();
      moveTo(pl, st.model.blocks[pl].raw.length);
      return;
    }
    if (e.key === 'ArrowRight' && s === v.length) {
      var nr = visNext(i);
      if (nr < 0) return;
      e.preventDefault();
      moveTo(nr, 0);
      return;
    }

    // ---- Tab 缩进
    if (e.key === 'Tab') {
      // Text Snippet 优先：敲缩写 + Tab 展开（只在无选区时）
      if (!e.shiftKey && s === en && trySnippet(ta, i, v, s)) { e.preventDefault(); return; }
      // 代码块内部：Tab / Shift+Tab 是「整块选区缩进」，不该跳出块
      if (tabInCode(ta, i, v, s, en, e.shiftKey)) return;
      var lsTab = v.lastIndexOf('\n', s - 1) + 1;
      var lineTab = v.slice(lsTab, v.indexOf('\n', lsTab) < 0 ? v.length : v.indexOf('\n', lsTab));
      if (/^[ \t]*([-*+]|\d{1,9}[.)])\s/.test(lineTab)) {
        e.preventDefault();
        var nvT;
        if (e.shiftKey) {
          var strip = lineTab.match(/^ {1,2}/);
          var n = strip ? strip[0].length : 0;
          nvT = v.slice(0, lsTab) + v.slice(lsTab + n);
          setValueAndCaret(ta, i, nvT, Math.max(lsTab, s - n));
        } else {
          nvT = v.slice(0, lsTab) + '  ' + v.slice(lsTab);
          setValueAndCaret(ta, i, nvT, s + 2);
        }
      }
      return;
    }

    // ---- Escape 结束编辑
    if (e.key === 'Escape') { e.preventDefault(); exitEdit(); return; }
  }

  /* 代码块里的 Tab：选区跨几行就缩进几行（Shift+Tab 反缩进）。
   * 只在选定行原本有缩进时才真的吃掉这次按键，
   * Tab 依然能用来跳离代码块。返回 true 表示已处理。 */
  function tabInCode(ta, i, v, s, en, back) {
    var b = st.model.blocks[i];
    if (!b || b.type !== 'code' || !window.Code) return false;
    var rg = Code.bodyRange(v);
    if (!rg) return false;
    var bStart = Math.max(rg.start, Math.min(s, en));
    var bEnd = Math.min(rg.end, Math.max(s, en));
    if (bEnd < bStart) { bStart = rg.start; bEnd = rg.start; }
    // 光标落在围栏行上（在正文之前）时先把它带进正文
    if (bStart < rg.start) bStart = rg.start;
    var body = v.slice(rg.start, rg.end);
    var next = Code.shift(body, bStart - rg.start, bEnd - rg.start, back ? -1 : 1);
    if (next === body) return false;
    var lead = v.slice(0, rg.start);
    var nv = lead + next + v.slice(rg.end);
    var unit = Code.UNIT.length;
    var moved = back ? -unit : unit;
    // 只有原选区完全落在正文里时才平移光标；否则怼到正文头
    var ns = s >= rg.start ? Math.max(rg.start, s + moved) : rg.start;
    var ne = (en !== s && en >= rg.start) ? Math.max(rg.start, en + moved) : ns;
    setValueAndCaret(ta, i, nv, Math.min(ns, nv.length), Math.min(ne, nv.length));
    return true;
  }

  /* ---- Text Snippet：敲缩写 + Tab 展开（偏好里定义，见 snippet.js） */
  var SNIPPETS = [];

  function setSnippets(list) { SNIPPETS = list || []; }

  function trySnippet(ta, i, v, s) {
    if (!SNIPPETS.length) return false;
    var S = window.Snippets;
    if (!S || !S.expand) return false;
    var r = S.expand(v, s, SNIPPETS);
    if (!r) return false;
    setValueAndCaret(ta, i, r.text, r.caret);
    return true;
  }

  function wrapSel(before, after, placeholder) {
    var ta = srcArea(), i = st.editing;
    if (!ta || i < 0) return;
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var sel = v.slice(s, e) || placeholder;
    var nv = v.slice(0, s) + before + sel + after + v.slice(e);
    var cs = s + before.length, ce = cs + sel.length;
    if (!v.slice(s, e)) { setValueAndCaret(ta, i, nv, cs, ce); }
    else setValueAndCaret(ta, i, nv, ce, ce);
    ta.focus();
  }

  function setHeading(level) {
    var ta = srcArea(), i = st.editing;
    if (!ta || i < 0) return;
    var v = ta.value;
    var s = ta.selectionStart;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var le = v.indexOf('\n', s); if (le < 0) le = v.length;
    var line = v.slice(ls, le);
    var stripped = line.replace(/^ {0,3}#{1,6}\s+/, '');
    var head = level ? '#'.repeat(level) + ' ' : '';
    var nv = v.slice(0, ls) + head + stripped + v.slice(le);
    var delta = head.length - (line.length - stripped.length);
    setValueAndCaret(ta, i, nv, Math.max(ls, s + delta));
  }

  /* ------------------------------------------------ 粘贴 / 拖放图片 */
  function onPaste(e) {
    var dt = e.clipboardData;
    if (!dt) return;
    var items = dt.items || [];
    for (var k = 0; k < items.length; k++) {
      if (items[k].type && items[k].type.indexOf('image') === 0) {
        e.preventDefault();
        var f = items[k].getAsFile();
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result); };
        fr.readAsDataURL(f);
        return;
      }
    }
    // 纯文本：走默认行为
  }

  /* 粘贴 / 拖入的图片。落盘目录不在这里定：交给 ui 层的 onSaveImage
   * （它按 typora-copy-images-to 与 typora-root-url 算目标目录，再把绝对路径
   * 换回文档里的相对引用），没有 ui 层时退回 Bridge 的默认 assets/。 */
  function insertImage(dataUrl, name) {
    var alt = name ? String(name).replace(/\.[^.]+$/, '').replace(/[[\]]/g, '') : 'image';
    var put = function (href) {
      var url = String(href == null ? '' : href);
      if (!url) return;
      // 空格与圆括号会让 Markdown 把地址截断，用 <…> 包住
      if (/[\s()<>]/.test(url)) url = '<' + url + '>';
      var md = '![' + alt + '](' + url + ')';
      // 没在编辑态（图被丢到渲染块上）就另起一段，别把图默默吃掉
      if (st.editing >= 0) insertAtCaret(md);
      else insertMarkdown(md);
    };
    var job;
    if (hooks && hooks.onSaveImage) {
      job = Promise.resolve(hooks.onSaveImage(dataUrl, name));
    } else if (window.Bridge && window.Bridge.saveImage) {
      job = window.Bridge.saveImage(dataUrl, st.path || '');
    } else {
      job = Promise.resolve(dataUrl);
    }
    Promise.resolve(job).then(function (r) {
      put((r && r.path) || (typeof r === 'string' ? r : '') || dataUrl);
    }).catch(function () { put(dataUrl); });
  }

  function insertAtCaret(text) {
    var ta = srcArea(), i = st.editing;
    if (!ta || i < 0) return;
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var nv = v.slice(0, s) + text + v.slice(e);
    setValueAndCaret(ta, i, nv, s + text.length);
    ta.focus();
  }

  /* 插入一段 Markdown（拖入文件时用）：编辑态插到光标处，否则在末尾另起一段；
   * 源码 / 分栏模式下那块 textarea 就是唯一数据源，直接写进去再派发 input。 */
  function insertMarkdown(text) {
    if (!text) return false;
    if (st.sourceMode && SRCAREA) return insertIntoPlain(SRCAREA, text);
    if (st.splitMode && SPLITAREA) return insertIntoPlain(SPLITAREA, text);
    if (st.editing >= 0) { insertAtCaret(text); return true; }
    return insertBlockAfter(st.model.blocks.length - 1, text);
  }

  function insertIntoPlain(ta, text) {
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? s : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.setSelectionRange(s + text.length, s + text.length);
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
    ta.focus();
    return true;
  }

  /* ------------------------------------------------ 点击定位 */
  function caretFromPoint(x, y, i) {
    var raw = st.model.blocks[i].raw;
    var node = null, off = 0;
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; off = p.offset; }
    } else if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; off = r.startOffset; }
    }
    if (!node) return raw.length;
    var host = node.nodeType === 3 ? node.parentNode : node;
    var span = host && host.closest ? host.closest('[data-s]') : null;
    if (!span) return 0;
    var base = parseInt(span.getAttribute('data-s'), 10) || 0;
    var inner = 0;
    if (node.nodeType === 3 && span.contains(node)) {
      var w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT, null);
      var cur;
      while ((cur = w.nextNode())) {
        if (cur === node) break;
        inner += cur.nodeValue.length;
      }
      inner += off;
    } else {
      inner = off;
    }
    return Math.max(0, Math.min(base + inner, raw.length));
  }

  function onMouseDown(e) {
    if (st.sourceMode) return;
    var t = e.target;
    if (t.closest && t.closest('input.task')) return;
    // 链接（含 #锚点、目录项）与脚注角标：交给 click，不进块编辑态
    if (t.closest && t.closest('a, .fn-ref')) return;
    var el = t.closest ? t.closest('.blk') : null;
    if (!el || !ED.contains(el)) {
      if (st.editing >= 0) exitEdit();
      return;
    }
    var i = +el.getAttribute('data-i');
    if (isNaN(i)) return;
    if (st.editing === i) return;
    e.preventDefault();
    var off = caretFromPoint(e.clientX, e.clientY, i);
    enterEdit(i, off);
  }

  function onClick(e) {
    var t = e.target;
    // wiki 链接：目标文件的解析要问文件系统，交给 UI 层
    var wl = t.closest ? t.closest('.wiki-link') : null;
    if (wl) {
      e.preventDefault();
      var target = wl.getAttribute('data-wiki') || '';
      if (hooks && hooks.onWiki) hooks.onWiki(target);
      return;
    }
    // 脚注角标：跳到对应定义
    var fref = t.closest ? t.closest('.fn-ref') : null;
    if (fref) {
      e.preventDefault();
      var fid = fref.getAttribute('data-fn');
      var fdef = Doc.findAnchor(ED, 'fn-def-' + fid);
      if (fdef) { Doc.scrollTo(SCROLL, fdef, { center: true }); return; }
      return;
    }
    if (t.tagName === 'A') {
      var href = t.getAttribute('href') || '';
      if (href.charAt(0) === '#') {
        e.preventDefault();
        Doc.scrollTo(SCROLL, Doc.findAnchor(ED, href.slice(1)), { center: true });
        return;
      }
      e.preventDefault();
      // 相对 .md 链接在应用内打开（交给 UI 层解析路径）
      if (/\.(md|markdown|mdown|txt)(#.*)?$/i.test(href) && !/^[a-z]+:/i.test(href) && hooks.onOpenLink) {
        hooks.onOpenLink(href);
        return;
      }
      if (window.Bridge && window.Bridge.openUrl) window.Bridge.openUrl(href);
      return;
    }
    if (t.tagName === 'IMG') {
      var el = t.closest('.blk');
      if (el && st.editing !== +el.getAttribute('data-i')) {
        enterEdit(+el.getAttribute('data-i'), null);
      }
    }
  }

  /* ------------------------------------------------ 源码模式 */
  function toggleSource(force) {
    var want = force == null ? !st.sourceMode : !!force;
    if (want === st.sourceMode) return st.sourceMode;
    if (want) {
      exitEdit();
      var full = getValue();                // 分栏/块编辑态也能取到当前全文
      if (st.splitMode) setSplitMode(false);
      st.sourceMode = true;
      SRCAREA.value = full;
      // 赋值会把光标丢到文末，焦点一落就把视图滚到最后一行 —— 进来要停在开头
      SRCAREA.scrollTop = 0;
      SRCAREA.scrollLeft = 0;
      try { SRCAREA.setSelectionRange(0, 0); } catch (e) {}
      ED.style.display = 'none';
      SRCAREA.style.display = 'block';
      if (window.SrcMode) SrcMode.show(full);
      SRCAREA.focus();
      document.body.classList.add('source-mode');
    } else {
      st.sourceMode = false;
      if (window.SrcMode) SrcMode.hide();
      st.model = MD.parse(SRCAREA.value);
      if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
      SRCAREA.style.display = 'none';
      ED.style.display = '';
      document.body.classList.remove('source-mode');
      render();
      st.dirty = true;
      hooks.onChange && hooks.onChange(st);
      scheduleAutosave();
    }
    hooks.onChange && hooks.onChange(st);
    return st.sourceMode;
  }

  /* ------------------------------------------------ 分栏：源码 + 实时预览
   * 分栏模式下，左侧 textarea 是唯一数据源（和源码模式同理）：
   * getValue() 直接返回它的内容，模型在每次输入后被重解析，
   * 供大纲 / 字数 / 导出使用。preview 由 split.js 负责渲染。
   */
  function attachSplit(area) { SPLITAREA = area; }

  function setSplitMode(on) {
    var want = !!on;
    if (want === st.splitMode) return st.splitMode;
    if (want) {
      if (st.sourceMode) toggleSource(false);
      exitEdit();
      st.splitMode = true;
    } else {
      var txt = SPLITAREA ? SPLITAREA.value : null;
      if (txt != null && txt !== MD.serialize(st.model)) {
        st.model = MD.parse(txt);
        if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
        st.dirty = true;
      }
      st.splitMode = false;
      render();
    }
    hooks.onChange && hooks.onChange(st);
    return st.splitMode;
  }

  // 分栏里敲字后同步模型（由 split.js 的防抖回调驱动）
  function setSplitSource(text) {
    st.model = MD.parse(String(text == null ? '' : text));
    if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    st.dirty = true;
    hooks.onChange && hooks.onChange(st);
    scheduleAutosave();
  }

  // 强制用左侧当前内容刷新模型（导出 PDF 前用，避免 90ms 防抖窗口里的旧内容）
  function syncSplitModel() {
    if (st.splitMode && SPLITAREA) setSplitSource(SPLITAREA.value);
  }

  function replaceSplitSelection(repl) {
    if (!st.splitMode || !SPLITAREA) return false;
    var ta = SPLITAREA, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) return false;
    ta.value = ta.value.slice(0, s) + repl + ta.value.slice(e);
    ta.setSelectionRange(s, s + repl.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function insertSplitAfterSelection(repl) {
    if (!st.splitMode || !SPLITAREA) return false;
    var ta = SPLITAREA, e = ta.selectionEnd;
    var prefix = ta.value.slice(0, e);
    var need = prefix.slice(-2) === '\n\n' ? '' : (prefix.slice(-1) === '\n' ? '\n' : '\n\n');
    var ins = need + repl;
    ta.value = prefix + ins + ta.value.slice(e);
    ta.setSelectionRange(e + ins.length, e + ins.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // 分栏预览选区 → 按文档级偏移直接改写左侧源码
  // expect 传入选区原文，内容对不上就放弃，避免模型与源码错位时改错地方
  function replaceSplitDocRange(start, end, repl, expect) {
    if (!st.splitMode || !SPLITAREA) return false;
    var ta = SPLITAREA, v = ta.value;
    if (start == null || end == null || start < 0 || end > v.length || start > end) return false;
    if (expect != null && v.slice(start, end).trim() !== String(expect).trim()) return false;
    ta.setSelectionRange(start, end);
    ta.value = v.slice(0, start) + repl + v.slice(end);
    ta.setSelectionRange(start + repl.length, start + repl.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function insertSplitDocAfter(pos, repl) {
    if (!st.splitMode || !SPLITAREA) return false;
    var ta = SPLITAREA, v = ta.value;
    if (pos == null || pos < 0 || pos > v.length) return false;
    var prefix = v.slice(0, pos);
    var need = prefix.slice(-2) === '\n\n' ? '' : (prefix.slice(-1) === '\n' ? '\n' : '\n\n');
    var ins = need + repl;
    ta.value = prefix + ins + v.slice(pos);
    ta.setSelectionRange(pos + ins.length, pos + ins.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* ------------------------------------------------ 查找 / 替换 */
  function currentText() {
    if (st.splitMode && SPLITAREA) return { text: SPLITAREA.value, kind: 'split' };
    if (st.sourceMode && SRCAREA) return { text: SRCAREA.value, kind: 'source' };
    return { text: MD.serialize(st.model), kind: 'render' };
  }

  function search(query, opt) {
    var cur = currentText();
    var hits = MD.findAll(cur.text, query, opt);
    return hits == null ? null : { kind: cur.kind, matches: hits };
  }

  // 把 textarea 里的某个字符位置滚进视野
  function scrollTextareaTo(ta, pos) {
    var r = caretRectInTextarea(ta, pos);
    if (!r) return;
    var box = ta.getBoundingClientRect();
    var lh = r.height || 18;
    if (r.top < box.top + 4) ta.scrollTop -= (box.top + 4 - r.top) + lh;
    else if (r.bottom > box.bottom - 4) ta.scrollTop += (r.bottom - (box.bottom - 4)) + lh;
  }

  // 让 [start, start+len) 这段可见并处于选中状态
  function revealOffset(start, len) {
    len = len == null ? 0 : len;
    var cur = currentText();
    if (cur.kind === 'split' || cur.kind === 'source') {
      var ta = cur.kind === 'split' ? SPLITAREA : SRCAREA;
      if (!ta) return false;
      var s = Math.max(0, Math.min(start, ta.value.length));
      ta.focus();
      ta.setSelectionRange(s, Math.min(s + len, ta.value.length));
      scrollTextareaTo(ta, s);
      return true;
    }
    var loc = locate(start);
    enterEdit(loc.i, loc.off);
    var at = srcArea();
    if (at) {
      var e = Math.min(loc.off + len, at.value.length);
      at.setSelectionRange(loc.off, e);
      scrollTextareaTo(at, loc.off);
    }
    var el = blockEl(loc.i);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  // 整篇替换：分栏/源码直接写回 textarea，渲染态重建模型
  function applyText(nt) {
    var cur = currentText();
    if (cur.kind === 'split' || cur.kind === 'source') {
      var ta = cur.kind === 'split' ? SPLITAREA : SRCAREA;
      if (!ta) return;
      ta.value = nt;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    st.model = MD.parse(nt);
    if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    st.editing = -1;
    render();
    bumpDirty();
  }

  // 替换一处，返回替换后光标的全文偏移
  function replaceAt(start, end, rep) {
    var cur = currentText();
    var s = Math.max(0, Math.min(start, cur.text.length));
    var e = Math.max(s, Math.min(end, cur.text.length));
    rep = rep == null ? '' : String(rep);
    snapshot();
    applyText(cur.text.slice(0, s) + rep + cur.text.slice(e));
    return s + rep.length;
  }

  function replaceAllMatches(query, rep, opt) {
    var cur = currentText();
    var r = MD.replaceAll(cur.text, query, rep, opt);
    if (!r.count) return 0;
    snapshot();
    applyText(r.text);
    return r.count;
  }

  /* ------------------------------------------------ 选区操作（复制为 MD / 选词 / 选行） */
  function activeTextarea() {
    if (st.splitMode && SPLITAREA) return SPLITAREA;
    if (st.sourceMode && SRCAREA) return SRCAREA;
    var et = srcArea();
    return (st.editing >= 0 && et) ? et : null;
  }

  function selectionRaw() {
    var ta = activeTextarea();
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      return ta.value.slice(ta.selectionStart, ta.selectionEnd);
    }
    try {
      var ctx = selectionContext();
      if (ctx && ctx.text) return ctx.text;
    } catch (e) {}
    return '';
  }

  function selectWordAtCaret() {
    var ta = activeTextarea();
    if (!ta) return false;
    var v = ta.value, s = ta.selectionStart;
    var isWord = function (ch) { return /[A-Za-z0-9_\u4e00-\u9fff\u3040-\u30ff]/.test(ch); };
    var a = s, b = s;
    while (a > 0 && isWord(v[a - 1])) a--;
    while (b < v.length && isWord(v[b])) b++;
    if (a === b) return false;
    ta.setSelectionRange(a, b);
    return true;
  }

  function selectLineAtCaret() {
    var ta = activeTextarea();
    if (!ta) return false;
    var v = ta.value, s = ta.selectionStart;
    var a = v.lastIndexOf('\n', s - 1) + 1;
    var b = v.indexOf('\n', s); if (b < 0) b = v.length;
    ta.setSelectionRange(a, b);
    return true;
  }

  /* ------------------------------------------------ 公开 API */
  function init(opts) {
    hooks = opts || {};
    ED = document.getElementById('editor');
    SCROLL = document.getElementById('editor-scroll');
    SRCAREA = document.getElementById('source-area');
    SRCHL = document.getElementById('source-hl');
    if (window.SrcMode) SrcMode.attach(SRCAREA, SRCHL);

    ED.addEventListener('mousedown', onMouseDown);
    ED.addEventListener('click', onClick);
    ED.addEventListener('dragover', function (e) { e.preventDefault(); });
    ED.addEventListener('drop', onDrop);
    SRCAREA.addEventListener('input', function () {
      st.dirty = true;
      hooks.onChange && hooks.onChange(st);
      scheduleAutosave();
    });
    SRCAREA.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); toggleSource(false); }
    });
    // 捕获阶段：enterEdit 会把块内节点整体换掉，等到冒泡到 document 时
    // e.target 已经脱离 DOM，ED.contains 会是 false —— 那样「点文字进编辑态」
    // 会被自己立刻踢出编辑态。必须趁目标还在树上时判断。
    document.addEventListener('mousedown', function (e) {
      if (st.editing < 0) return;
      if (ED.contains(e.target) || SRCAREA.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.no-blur')) return;
      exitEdit();
    }, true);
    document.addEventListener('selectionchange', function () {
      if (st.typewriter && st.editing >= 0) { /* 交给 input 处理，避免滚动抖动 */ }
    });
    setTheme(st.theme);
  }

  function onDrop(e) {
    e.preventDefault();
    var dt = e.dataTransfer;
    if (!dt) return;
    var files = dt.files || [];
    var D = (typeof window !== 'undefined' && window.Dropfile) || null;
    var isImg = D ? D.isImage : function (f) { return !!(f && f.type && f.type.indexOf('image') === 0); };

    // 多张图一起拖进来：全部插入，按拖入顺序
    var imgs = [];
    for (var k = 0; k < files.length; k++) if (isImg(files[k])) imgs.push(files[k]);
    imgs.forEach(function (ff) {
      var r2 = new FileReader();
      r2.onload = function () { insertImage(r2.result, ff.name); };
      r2.readAsDataURL(ff);
    });

    // 非图片：插入链接。⌥ 拖入 = 直接打开（保留老习惯）。
    var others = [];
    for (var j = 0; j < files.length; j++) if (!isImg(files[j])) others.push(files[j]);
    if (!others.length) return;

    var paths = D ? D.pathsFrom(dt) : {};
    others.forEach(function (f) {
      var path = paths[f.name] || '';
      var texty = /\.(md|markdown|mdown|txt)$/i.test(f.name || '');
      if (e.altKey && texty) {
        var fr = new FileReader();
        fr.onload = function () { hooks.onOpenFile && hooks.onOpenFile({ name: f.name, content: fr.result, path: path || null }); };
        fr.readAsText(f);
        return;
      }
      var send = function (text) {
        hooks.onDropFile && hooks.onDropFile({ name: f.name, path: path, text: text, size: f.size });
      };
      if (texty) {
        var fr2 = new FileReader();
        fr2.onload = function () { send(String(fr2.result)); };
        fr2.readAsText(f);
      } else send(null);
    });
  }

  /* 拖入文件的路径解析在 dropfile.js（纯函数，单独可测）。
   * 老版本这里是内联的 droppedPaths()，已迁走。 */

  function load(text, path, name) {
    var src = text == null ? '' : text;
    st.model = MD.parse(src);
    if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    st.path = path || null;
    st.name = name || (path ? path.split('/').pop() : '未命名.md');
    st.dirty = false;
    st.editing = -1;
    st.undo.length = 0;
    st.redo.length = 0;
    if (st.splitMode && SPLITAREA) SPLITAREA.value = src;
    else if (st.sourceMode) SRCAREA.value = src;
    else render();
    hooks.onChange && hooks.onChange(st);
    hooks.onLoad && hooks.onLoad(st);
  }

  /* ------------------------------------------------ 标签页要的「存档 / 抖包袱」
   * snapshotDoc 拍一张「离开这个文档时的样子」：正文、路径、脏标记、撤销栈、
   * 滚动位置、光标在哪一块。restoreDoc 原样装回去 —— 不碰撤销栈、不置脏。
   *
   * 只存正文不存 model：序列化是无损的，解析一遍就能拿到同一棵树，
   * 而 model 里带着一堆字符串，24 个标签全留着太占内存。
   */
  function snapshotDoc() {
    var i = st.editing, off = 0;
    if (i >= 0) {
      var ta = srcArea();
      off = ta ? ta.selectionStart : 0;
    }
    var scroller = st.splitMode ? SPLITAREA : (st.sourceMode ? SRCAREA : SCROLL);
    return {
      content: getValue(),
      path: st.path,
      name: st.name,
      dirty: st.dirty,
      undo: st.undo.slice(),
      redo: st.redo.slice(),
      scroll: scroller ? scroller.scrollTop : 0,
      editBlock: i,
      editOff: off,
      sourceMode: st.sourceMode,
      splitMode: st.splitMode
    };
  }

  function restoreDoc(snap) {
    if (!snap) return;
    var content = snap.content == null ? '' : String(snap.content);
    st.path = snap.path || null;
    st.name = snap.name || (st.path ? st.path.split('/').pop() : '未命名.md');
    st.dirty = !!snap.dirty;
    st.editing = -1;
    st.undo = (snap.undo || []).slice();
    st.redo = (snap.redo || []).slice();

    st.model = MD.parse(content);
    if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };

    if (st.splitMode && SPLITAREA) {
      SPLITAREA.value = content;
      SPLITAREA.setSelectionRange(0, 0);
      try { if (window.Split) Split.refresh(); } catch (e) {}
      SPLITAREA.scrollTop = snap.scroll || 0;
    } else if (st.sourceMode && SRCAREA) {
      SRCAREA.value = content;
      try { SRCAREA.setSelectionRange(0, 0); } catch (e) {}
      if (window.SrcMode) SrcMode.show(content);
      SRCAREA.scrollTop = snap.scroll || 0;
    } else {
      render();
      // 回到离开时那一块、那个位置；块号越界（内容被外部改过）就老老实实不进去
      if (snap.editBlock >= 0 && snap.editBlock < st.model.blocks.length) {
        enterEdit(snap.editBlock, snap.editOff);
      }
      // scroll-behavior: smooth 会让「切标签」变成一段滚动动画，这里临时关掉
      if (SCROLL) {
        var prevB = SCROLL.style.scrollBehavior;
        SCROLL.style.scrollBehavior = 'auto';
        SCROLL.scrollTop = snap.scroll || 0;
        SCROLL.style.scrollBehavior = prevB || '';
      }
    }
    hooks.onChange && hooks.onChange(st);
    hooks.onLoad && hooks.onLoad(st);
  }

  // 切换标签前把待写的自动保存立刻落盘，别让它带着新文档的内容写到旧路径上
  function flushAutosave() {
    if (!autosaveTimer) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (hooks.onAutosave) hooks.onAutosave(st, getValue());
  }

  function setTheme(name) {
    st.theme = name;
    document.documentElement.setAttribute('data-theme', name);
  }

  /* 用当前文本重新解析（严格模式切换时调用）。
   * 序列化是无损的，所以从 getValue() 拿到的就是原始源码；
   * 撤销/重做栈与路径、脏标记都原样保留——切换解析档位不是一次编辑。 */
  function reparse() {
    var src = getValue();
    st.model = MD.parse(src);
    if (!st.model.blocks.length) st.model = { blocks: [{ raw: '' }], gaps: ['', ''] };
    st.editing = -1;
    render();
    hooks.onChange && hooks.onChange(st);
  }

  return {
    init: init,
    load: load,
    snapshotDoc: snapshotDoc,
    restoreDoc: restoreDoc,
    flushAutosave: flushAutosave,
    getValue: getValue,
    getState: function () { return st; },
    getName: function () { return st.name; },
    getPath: function () { return st.path; },
    isDirty: function () { return st.dirty; },
    markDirty: function () { st.dirty = true; hooks.onChange && hooks.onChange(st); },
    markSaved: function (path, name) {
      st.dirty = false;
      if (path) st.path = path;
      if (name) st.name = name;
      hooks.onChange && hooks.onChange(st);
    },
    render: render,
    reparse: reparse,
    newDoc: function () { load('', null, '未命名.md'); },
    enterEdit: enterEdit,
    exitEdit: exitEdit,
    toggleSource: toggleSource,
    isSourceMode: function () { return st.sourceMode; },
    undo: undo,
    redo: redo,
    setTheme: setTheme,
    setSnippets: setSnippets,
    setTyping: function (o) {
      o = o || {};
      if (o.autoPair != null) st.autoPair = !!o.autoPair;
      if (o.smart != null) st.smart = !!o.smart;
      if (o.codeLineNo != null) {
        st.codeLineNo = !!o.codeLineNo;
        MD.setCodeLineNo(st.codeLineNo);
        render();
      }
    },
    setSpellcheck: function (on) {
      st.spellcheck = !!on;
      if (SRCAREA) SRCAREA.spellcheck = !!on;
      if (SPLITAREA) SPLITAREA.spellcheck = !!on;
      var ta = srcArea();
      if (ta) ta.spellcheck = !!on;
    },
    setLivePreview: function (on) {
      st.livePreview = !!on;
      if (!st.livePreview && st.editing >= 0) {
        // 关掉开关时把当前块退回源码 textarea
        var i = st.editing, off = srcArea() ? srcArea().selectionStart : null;
        exitEdit();
        enterEdit(i, off);
      }
    },
    isLivePreview: function () { return !!st.livePreview; },
    getOutline: function () { return MD.outline(st.model.blocks); },
    countWords: function () { return MD.countWords(getValue()); },
    focusBlock: function (i) {
      exitEdit();
      var el = blockEl(i);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    setFocus: function (on) {
      st.focus = !!on;
      document.body.classList.toggle('focus-mode', st.focus);
      refreshFocus();
    },
    setTypewriter: function (on) {
      st.typewriter = !!on;
      document.body.classList.toggle('typewriter-mode', st.typewriter);
      if (st.typewriter && st.editing >= 0) centerCaret();
      refreshFocus();
    },
    isFocus: function () { return st.focus; },
    isTypewriter: function () { return st.typewriter; },
    /* 光标行在视口里的位置（测试与状态栏用） */
    caretRow: function () {
      var ta = srcArea();
      if (!ta || !window.Caret) return null;
      return Caret.measure(ta);
    },
    exportHTML: function () {
      // 分栏模式下 #editor 是停更的，直接用左侧源码现渲染一份
      if (st.splitMode && SPLITAREA) {
        var tmp = document.createElement('div');
        tmp.innerHTML = MD.renderDocument(SPLITAREA.value);
        // 离屏也要跑一遍装饰，否则导出的 [TOC] 是空壳、脚注没有编号
        try { if (window.Doc) Doc.decorate(tmp); } catch (e) {}
        return tmp.innerHTML;
      }
      return document.getElementById('editor').innerHTML;
    },
    insertAtCaret: insertAtCaret,
    insertMarkdown: insertMarkdown,
    insertBlocks: insertBlocks,
    mapRaw: mapRaw,
    getRaw: function (i) {
      var b = st.model.blocks[i];
      return b ? b.raw : '';
    },
    blockCount: function () { return st.model.blocks.length; },
    selectionContext: selectionContext,
    insertBlockAfter: insertBlockAfter,
    canReplaceInBlock: canReplaceInBlock,
    replaceInBlock: replaceInBlock,
    replaceSourceSelection: replaceSourceSelection,
    replaceEditSelection: replaceEditSelection,
    replaceRawRange: replaceRawRange,
    replaceRawRangeKeepEdit: replaceRawRangeKeepEdit,
    deleteBlock: deleteBlock,
    insertSourceAfterSelection: insertSourceAfterSelection,
    attachSplit: attachSplit,
    setSplitMode: setSplitMode,
    setSplitSource: setSplitSource,
    syncSplitModel: syncSplitModel,
    isSplitMode: function () { return st.splitMode; },
    replaceSplitSelection: replaceSplitSelection,
    insertSplitAfterSelection: insertSplitAfterSelection,
    replaceSplitDocRange: replaceSplitDocRange,
    insertSplitDocAfter: insertSplitDocAfter,
    selectionRaw: selectionRaw,
    selectWordAtCaret: selectWordAtCaret,
    selectLineAtCaret: selectLineAtCaret,
    activeTextarea: activeTextarea,
    search: search,
    revealOffset: revealOffset,
    replaceAt: replaceAt,
    replaceAllMatches: replaceAllMatches,
    getText: function () { return currentText().text; },
    caretRectInTextarea: caretRectInTextarea,
    selectionRectInTextarea: selectionRectInTextarea
  };
})();
