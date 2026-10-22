/* ============================================================
 * live.js — 行内标记即时隐藏（live preview）的纯逻辑
 *
 * Typora 的行为是「边打边把 ** 藏起来，光标进到那一段里才露出来」。
 * 块编辑现在是 textarea，textarea 里的字没法分段上样式，所以这件事
 * 只能换到 contenteditable 上做：块本身变成可编辑的渲染态，标记不
 * 进 DOM，光标进去时再把标记插回去。
 *
 * 这个文件只放不碰 DOM 的那部分，Node 里能直接 require 出来测：
 *   canLive(raw)        这块值不值得走 live（保守：单行、无禁用字符）
 *   scan(raw)           扫描强调族标记，给出标记与内容的精确区间
 *   reveal(raw, caret)  光标在哪几个标记区间里 → 这几个要把标记露出来
 *   applyEdit(...)      把一次显示层的编辑翻成原文层的编辑
 *   cleanupAt(...)      清掉编辑点附近的空标记对（** 与 ** 之间什么都没有）
 *   diff(prev, next)    文本前后的最小差异（改动区间 + 插入串）
 *   prefix(raw)         块前缀（# / > / - / 1. / - [ ]）的长度
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Live = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 一块太长了就不做 live：每次按键要重扫一遍，几千字以上没必要 */
  var MAX = 4000;

  /* 出现这些字符就退回源码 textarea：
   *   \ 转义   ` 行内代码   [ ] 链接/脚注   $ 公式   < > 行内 HTML   | 表格
   * 这些都是「原子」，藏了标记反而不好改（比如链接的 URL 藏在括号里）。 */
  var BAR = /[\\`\[\]$<>|]/;

  function canLive(raw) {
    var s = String(raw == null ? '' : raw);
    if (s.length > MAX) return false;
    if (s.indexOf('\n') >= 0) return false;   // 多行块交给 textarea
    // 块前缀（- [ ] / 1. / # / >）里的方括号不算「原子」
    if (BAR.test(s.slice(prefix(s)))) return false;
    return true;
  }

  /* 与 md.js 的 renderInline 同一组规则、同一个顺序。
   * 顺序不能动：** 要先于 *，「~~」要先于「~」，否则 `<strong>` 会被拆成两个 <em>。 */
  var RULES = [
    { kind: 'strong', tag: 'strong', re: /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/ },
    { kind: 'del', tag: 'del', re: /^~~(?=\S)([\s\S]*?\S)~~/ },
    { kind: 'mark', tag: 'mark', re: /^==(?=\S)([\s\S]*?\S)==/ },
    { kind: 'em', tag: 'em', re: /^(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1/ },
    { kind: 'sup', tag: 'sup', re: /^\^(?=\S)([^\s^]+?)\^(?!\^)/ },
    { kind: 'sub', tag: 'sub', re: /^~(?=\S)([^\s~]+?)~(?![~])/ }
  ];

  /* 扫描 src（从 base 起算绝对偏移），结果追加进 out。
   * 返回的每一项：{kind, tag, start, end, m1, m2, innerStart, innerEnd}
   *   start/end        整个标记段（含两侧标记）的原文区间
   *   m1/m2            开闭标记各自的长度
   *   innerStart/End   里面那段内容的区间
   * 嵌套标记递归进去扫（**a *b* c** 里的 *b* 也是独立一段）。 */
  function scan(src, base, out, depth) {
    var s = String(src == null ? '' : src);
    base = base || 0;
    out = out || [];
    if ((depth || 0) > 6) return out;
    var i = 0;
    while (i < s.length) {
      var rest = s.slice(i), hit = null;
      for (var k = 0; k < RULES.length; k++) {
        var m = RULES[k].re.exec(rest);
        if (m) { hit = { rule: RULES[k], m: m }; break; }
      }
      if (!hit) { i++; continue; }
      var whole = hit.m[0];
      var inner = hit.m[2] != null ? hit.m[2] : hit.m[1];
      var m1 = whole.indexOf(inner);
      if (m1 < 0) { i++; continue; }             // 理论上不会发生，守住不死循环
      var start = base + i;
      var m2 = whole.length - m1 - inner.length;
      out.push({
        kind: hit.rule.kind,
        tag: hit.rule.tag,
        start: start,
        end: start + whole.length,
        m1: m1,
        m2: m2,
        innerStart: start + m1,
        innerEnd: start + whole.length - m2
      });
      scan(inner, start + m1, out, (depth || 0) + 1);
      i += whole.length;
    }
    return out;
  }

  /* 光标落在这几段里 → 这几段的标记要露出来。
   * 判据是「严格在区间内」：贴着开标记之前、闭标记之后都算在外面。 */
  function reveal(raw, caret) {
    var toks = scan(raw, 0, [], 0);
    if (caret == null) return [];
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (caret > t.start && caret < t.end) out.push(t);
    }
    return out;
  }

  /* 块前缀：引用符号 + 列表/标题符号（含任务框）。返回长度。
   * 前缀在 live 态里是照原样显示的 —— 藏掉 # 或 - 就得再造一套「行首才露出来」
   * 的规则，价值不高，先把行内标记做好。 */
  var PRE = /^((?: {0,3}>[ \t]?)*)( {0,3}(?:#{1,6}|[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;

  function prefix(raw) {
    var m = PRE.exec(String(raw == null ? '' : raw));
    if (!m) return 0;
    return ((m[1] || '') + (m[2] || '')).length;
  }

  /* 前缀是哪种：标题的 `## ` 可以藏（藏了文字直接靠左，和渲染态一致），
   * 列表的 `- ` / `1. ` 与引用的 `> ` 带缩进语义，留着更像原样。
   * 认的是前缀里那一个记号本身，任务框的 `[ ]` 不算记号。 */
  function prefixKind(raw) {
    var m = PRE.exec(String(raw == null ? '' : raw));
    if (!m) return '';
    var t = /^ *([#]{1,6}|[-*+]|\d{1,9}[.)])/.exec(m[2] || '');
    var mark = t ? t[1] : '';
    if (/^#{1,6}$/.test(mark)) return 'heading';
    if (/^([-*+]|\d{1,9}[.)])$/.test(mark)) return 'list';
    return '';
  }

  /* 空标记对清理：** 紧挨着 **（中间只有空白）说明这段强调已经被删空了，
   * 留着只会渲染成字面的四个星号。只在这几段附近 ±8 字内动手。
   * 返回 {raw, caret}：光标跟着被删掉的字符一起回退。 */
  var EMPTY = /(\*\*|__|~~|==)[ \t]*\1/g;

  function cleanupAt(raw, pos) {
    var s = String(raw == null ? '' : raw);
    var p = pos == null ? s.length : Math.max(0, Math.min(pos, s.length));
    var a = Math.max(0, p - 8), b = Math.min(s.length, p + 8);
    var win = s.slice(a, b);
    var hits = [];
    win.replace(EMPTY, function (m, g, off) {
      hits.push([off, off + m.length]);
      return m;
    });
    if (!hits.length) return { raw: s, caret: p };
    var rel = p - a;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (rel >= h[0] && rel <= h[1]) rel = h[0];
      else if (rel > h[1]) rel -= (h[1] - h[0]);
    }
    var out = win.replace(EMPTY, '');
    return { raw: s.slice(0, a) + out + s.slice(b), caret: a + rel };
  }

  /* 文本差异 → {a, removed, ins}：从 a 起删掉 removed 个字符，插入 ins。
   * 前端把它翻成原文层的区间，就能把「DOM 里改了哪些字」落到 raw 上。 */
  function diff(prev, next) {
    var P = String(prev == null ? '' : prev);
    var N = String(next == null ? '' : next);
    if (P === N) return null;
    var pl = P.length, nl = N.length;
    var p = 0;
    while (p < pl && p < nl && P.charCodeAt(p) === N.charCodeAt(p)) p++;
    var s = 0;
    while (s < pl - p && s < nl - p &&
           P.charCodeAt(pl - 1 - s) === N.charCodeAt(nl - 1 - s)) s++;
    return { a: p, removed: pl - p - s, ins: N.slice(p, nl - s) };
  }

  /* 把一次编辑落到原文上。s/e 是原文偏移（已由调用方做过映射）。 */
  function applyEdit(raw, s, e, text) {
    var cur = String(raw == null ? '' : raw);
    var a = Math.max(0, Math.min(s == null ? cur.length : s, cur.length));
    var b = Math.max(0, Math.min(e == null ? a : e, cur.length));
    if (a > b) { var t = a; a = b; b = t; }
    var ins = String(text == null ? '' : text);
    var next = cur.slice(0, a) + ins + cur.slice(b);
    // 只有「删掉了东西」才可能造出空标记对；纯插入时别动，免得吃掉正文里
    // 本来就有的连续星号（比如手写的一串 ******）
    var fix = b > a ? cleanupAt(next, a + ins.length) : { raw: next, caret: a + ins.length };
    return { raw: fix.raw, caret: fix.caret };
  }

  return {
    MAX: MAX,
    canLive: canLive,
    scan: function (raw) { return scan(raw, 0, [], 0); },
    reveal: reveal,
    prefix: prefix,
    prefixKind: prefixKind,
    cleanupAt: cleanupAt,
    diff: diff,
    applyEdit: applyEdit
  };
});
