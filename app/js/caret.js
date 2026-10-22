/* caret.js —— 光标行的几何
 *
 * 两件事都依赖「光标现在在第几行、那一行在屏幕上的哪个位置」：
 *   1. 打字机模式要把光标行钉在视口垂直中间（原来的整块居中在多行块里会漂）；
 *   2. 专注模式要在编辑块里给光标行垫一条淡底，视线才有落点。
 *
 * 难点是软换行：textarea 的 wrap="soft" 会把一个逻辑行折成好几行，
 * 用「行号 × 行高」算出来的位置只对硬换行成立。这里用一个与 textarea
 * 同字体同宽度的隐藏镜像 div 量真实位置 —— 折行交给浏览器自己算。
 *
 * 纯函数部分（lineIndex / lineBounds / centerDelta / nearOf / clampScroll）
 * 不碰 DOM，Node 里能直接 require 出来测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Caret = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ------------------------------------------------------------ 纯函数 */

  /* 光标所在的逻辑行号（按 \n 计，不含软换行） */
  function lineIndex(text, pos) {
    var s = String(text == null ? '' : text);
    var p = pos == null ? s.length : Math.max(0, Math.min(pos, s.length));
    var n = 0;
    for (var i = 0; i < p; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
  }

  /* 第 idx 行的字符区间 [start, end)，end 指向换行符本身 */
  function lineBounds(text, idx) {
    var s = String(text == null ? '' : text);
    var n = Math.max(0, idx | 0);
    var start = 0;
    for (var i = 0, seen = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== 10) continue;
      if (seen === n) return { start: start, end: i };
      seen++;
      start = i + 1;
    }
    return { start: start, end: s.length };
  }

  /* 要让 rowTop 这一行的中心落在 viewH 中心，需要滚动的量（正数往下滚） */
  function centerDelta(rowTop, rowH, viewH) {
    var a = Number(rowTop) || 0, h = Number(rowH) || 0, v = Number(viewH) || 0;
    return (a + h / 2) - v / 2;
  }

  function clampScroll(v, max) {
    var m = Math.max(0, Number(max) || 0);
    return Math.max(0, Math.min(Number(v) || 0, m));
  }

  /* 专注模式的近邻：光标块的前后各一块（越界自动去掉） */
  function nearOf(i, total) {
    var out = [];
    var n = Math.max(0, Number(total) || 0);
    if (i == null || i < 0 || i >= n) return out;
    if (i - 1 >= 0) out.push(i - 1);
    if (i + 1 < n) out.push(i + 1);
    return out;
  }

  /* ------------------------------------------------------------ DOM 层 */

  var MIRROR = null;
  var STYLE_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'whiteSpace', 'wordBreak', 'overflowWrap', 'boxSizing'];

  function mirror() {
    if (MIRROR && MIRROR.parentNode) return MIRROR;
    var d = document.createElement('div');
    d.className = 'caret-mirror';
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    MIRROR = d;
    return d;
  }

  function syncStyle(ta, d) {
    var cs = getComputedStyle(ta);
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var v = cs[STYLE_PROPS[i]];
      if (v) d.style[STYLE_PROPS[i]] = v;
    }
    // tabSize 是数字型属性，有的 WebKit 读得到有的读不到，读不到就算了
    try { if (cs.tabSize) d.style.tabSize = cs.tabSize; } catch (e) {}
    d.style.position = 'absolute';
    d.style.top = '0';
    d.style.left = '-99999px';
    d.style.margin = '0';
    d.style.padding = '0';
    d.style.border = '0';
    d.style.visibility = 'hidden';
    d.style.pointerEvents = 'none';
    // clientWidth 已含 padding、不含 border，textarea 的 padding 是 0，直接用
    d.style.width = Math.max(0, ta.clientWidth) + 'px';
  }

  function lineHeightOf(ta, spanH) {
    var lh = parseFloat(getComputedStyle(ta).lineHeight);
    if (lh > 0) return lh;
    return spanH > 0 ? spanH : 20;
  }

  /* 光标行的位置（相对首行行盒顶）与行高。
   *
   * 坑：mark 是 inline 盒，它的 getBoundingClientRect().top 是**字形顶**，
   * 比行盒顶高出一段 leading（行高 26.66、字号 15.5 时差 4.2px），
   * 直接拿来当行偏移会每一行都差半个行距。所以文首也放一个同样的
   * 零宽标记当基准，两次相减把 leading 抵掉 —— 差出来的是干净的
   * 「第 n 个行盒」，必是行高的整数倍。
   *
   * live 块（contenteditable）没有 value/selectionStart 的语义：
   * 它把「折叠后的显示文本」和「显示层光标」挂在 __liveText/__liveDisp 上，
   * 镜像照着这两个量，出来的行盒与 textarea 那条路完全一致。
   */
  function measure(ta) {
    if (!ta) return null;
    var d = mirror();
    syncStyle(ta, d);
    d.textContent = '';
    var live = !!ta.__live;
    var text = live
      ? (typeof ta.__liveCollapsed === 'function' ? ta.__liveCollapsed() : String(ta.__liveText || ''))
      : String(ta.value || '');
    var pos = live
      ? (typeof ta.__liveDisplayPos === 'function' ? ta.__liveDisplayPos() : (ta.__liveDisp || 0))
      : ta.selectionStart;
    if (pos == null) pos = text.length;
    var zero = document.createElement('span');
    zero.textContent = '\u200b';
    d.appendChild(zero);
    d.appendChild(document.createTextNode(text.slice(0, pos)));
    var mk = document.createElement('span');
    mk.textContent = '\u200b';
    d.appendChild(mk);
    var zr = zero.getBoundingClientRect();
    var mr = mk.getBoundingClientRect();
    var top = mr.top - zr.top;
    if (!isFinite(top) || top < 0) top = 0;
    return { top: top, height: lineHeightOf(ta, mr.height || zr.height) };
  }

  /* 把光标行钉到滚动容器的垂直中间。返回是否真的滚了（用来省掉多余的重排） */
  function center(ta, scrollEl) {
    if (!ta || !scrollEl) return false;
    var g = measure(ta);
    if (!g) return false;
    var tr = ta.getBoundingClientRect();
    var sr = scrollEl.getBoundingClientRect();
    var rowTop = tr.top - sr.top + g.top;
    var delta = centerDelta(rowTop, g.height, sr.height);
    if (Math.abs(delta) < 1) return false;
    var max = scrollEl.scrollHeight - scrollEl.clientHeight;
    var next = clampScroll(scrollEl.scrollTop + delta, max);
    if (Math.abs(next - scrollEl.scrollTop) < 1) return false;
    // 打字机模式要求「打一个字，行就在中间」，平滑滚动会滞后一屏，直接跳。
    // 但 #editor-scroll 上挂着 scroll-behavior: smooth，得先把这条按下去，
    // 否则赋值照样走动画（同一帧内改回来，不会闪）。
    var prev = scrollEl.style.scrollBehavior;
    scrollEl.style.scrollBehavior = 'auto';
    scrollEl.scrollTop = next;
    scrollEl.style.scrollBehavior = prev || '';
    return true;
  }

  /* 给块内的 .caret-line 定位（相对 layer 的父元素，就是那个 .blk） */
  function markLine(layer, ta) {
    if (!layer || !ta) return null;
    var g = measure(ta);
    var host = layer.parentNode;
    if (!g || !host) return null;
    var tr = ta.getBoundingClientRect();
    var hr = host.getBoundingClientRect();
    layer.style.top = Math.round(tr.top - hr.top + g.top) + 'px';
    layer.style.height = Math.round(g.height) + 'px';
    return g;
  }

  function makeLine() {
    var d = document.createElement('div');
    d.className = 'caret-line';
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  return {
    lineIndex: lineIndex,
    lineBounds: lineBounds,
    centerDelta: centerDelta,
    clampScroll: clampScroll,
    nearOf: nearOf,
    measure: measure,
    center: center,
    markLine: markLine,
    makeLine: makeLine,
    // 测试用：清掉镜像节点
    _reset: function () { if (MIRROR && MIRROR.parentNode) MIRROR.parentNode.removeChild(MIRROR); MIRROR = null; }
  };
});
