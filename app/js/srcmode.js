/* ============================================================
 * srcmode.js — 整篇源码模式（⌘/）的行号与高亮层
 *
 * textarea 没法给单个 token 上色，所以垫一层 <pre>：textarea 的文字设成透明，
 * 颜色由下面这层画；两层共用同一套 font / padding / tab-size，逐字符对齐。
 * 行号也画在这层里（每行一个 flex 行），代价是换行与横向滚动都自动跟随，
 * 不像独立 gutter 那样要靠 translateY 猜高度。
 *
 * 边界：这不是编辑器。光标、选区、IME、撤销全都交给原生 textarea，
 * 这里只在 input 后重画。textarea 内容永远是真值，高亮层随时可以丢掉重画。
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SrcMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var TA = null, HL = null, on = false, raf = 0;
  var api;   // 末尾组装；attach/show 要能链式返回它

  function lineCount(src) {
    return String(src == null ? '' : src).split('\n').length;
  }

  function numbers(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(i);
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /* 逐行高亮。整篇高亮再按 \n 切会把 span 截断（跨行构造一旦出现就错位），
   * 一行一次调用最稳；空行塞一个零宽空格，否则行高会塌。
   * 围栏内的行按围栏语言上色（源码模式里代码块也要有颜色），所以边走边记围栏状态。 */
  function render(src) {
    var MD = root.MD;
    var lines = String(src == null ? '' : src).split('\n');
    var out = '', fence = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], f, body;
      if (!line) {
        body = '\u200b';
      } else {
        f = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (f && (!fence || f[1].charAt(0) === fence.mark)) {
          if (fence) {
            fence = null;
          } else {
            var info = String(f[2] || '').trim().split(/\s+/)[0];
            fence = { mark: f[1].charAt(0), lang: info || 'text' };
          }
          body = tint(MD, line, 'markdown');
        } else {
          body = tint(MD, line, fence ? fence.lang : 'markdown');
        }
      }
      out += '<div class="sl"><span class="sl-n">' + (i + 1) + '</span>' +
        '<span class="sl-t">' + body + '</span></div>';
    }
    return out;
  }

  /* 注意别叫 paint：下面的 DOM 重画也叫 paint，函数声明提升会把它顶掉 */
  function tint(MD, line, lang) {
    if (MD && MD.highlight) return MD.highlight(line, lang);
    return esc(line);
  }

  function sync() {
    if (!HL || !TA) return;
    HL.scrollTop = TA.scrollTop;
    HL.scrollLeft = TA.scrollLeft;
  }

  function paint() {
    if (!on || !HL || !TA) return;
    HL.innerHTML = render(TA.value);
    sync();
  }

  /* 一帧一次：连续输入时不必每个字符重画整篇 */
  function schedule() {
    if (raf) return;
    raf = (root.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
      raf = 0;
      paint();
    });
  }

  function attach(ta, hl) {
    TA = ta || null;
    HL = hl || null;
    if (!TA) return api;
    TA.addEventListener('input', schedule);
    TA.addEventListener('scroll', sync);
    TA.addEventListener('click', sync);
    return api;
  }

  function show(src) {
    if (!TA) return;
    on = true;
    if (typeof src === 'string' && TA.value !== src) TA.value = src;
    if (HL) {
      HL.innerHTML = render(TA.value);
      HL.hidden = false;
    }
    sync();
  }

  function hide() {
    on = false;
    if (HL) { HL.hidden = true; HL.innerHTML = ''; }
  }

  api = {
    // 纯函数（Node 单测直接用）
    lineCount: lineCount,
    numbers: numbers,
    render: render,
    // DOM 层
    attach: attach,
    show: show,
    hide: hide,
    refresh: paint,
    isOn: function () { return on; }
  };
  return api;
});
