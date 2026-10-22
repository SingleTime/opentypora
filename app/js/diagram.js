/* ============================================================
 * diagram.js — Mermaid 图表渲染
 *
 * 设计要点：
 *   1. 懒加载。vendor/mermaid.min.js 有 3.4 MB，解析要一两百毫秒，
 *      只有文档里真的出现 ```mermaid 时才注入 <script>，纯文字文档零成本。
 *   2. 不替换源码节点。mermaid 渲染完把 <svg> 插到 .blk 里、给块加
 *      .mermaid-on 让 <pre> 隐藏。如果把 <pre> 删掉，块内那些带 data-s
 *      的文本节点就没了，点击定位 / 选区翻译的字符偏移会整块失效。
 *   3. 按「主题 + 源码」做缓存。编辑器每敲一个字都会重渲染整块 DOM，
 *      缓存命中时同步贴 SVG，不会闪。
 *   4. 渲染失败不吞异常：块上加 .mermaid-err，源码保持可见，错误信息
 *      挂在下面，作者能直接看到问题在哪。
 * ============================================================ */
var Diagram = (function () {
  'use strict';

  var LIB = 'vendor/mermaid.min.js';
  var STATE = { loaded: false, loading: false, failed: false, waiters: [] };
  var cache = {};          // key: themeSig + \u0001 + src  →  svg
  var seq = 0;
  var busy = false;
  var queue = [];
  var initedFor = '';

  /* ---------- 主题 ---------- */

  function lum(rgb) {
    var m = /rgba?\(([^)]+)\)/.exec(rgb || '');
    if (!m) return 255;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  }

  function isDark() {
    var bg = '';
    try { bg = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    return lum(bg) < 128;
  }

  /* 主题签名：切换主题（含用户自定义 CSS）后 SVG 要重画 */
  function themeSig() {
    return (document.documentElement.getAttribute('data-theme') || '') +
      (isDark() ? ':dark' : ':light');
  }

  /* ---------- 加载库 ---------- */

  function ensure(cb) {
    if (STATE.loaded) { cb(true); return; }
    if (STATE.failed) { cb(false); return; }
    STATE.waiters.push(cb);
    if (STATE.loading) return;
    STATE.loading = true;
    var s = document.createElement('script');
    s.src = LIB;
    s.onload = function () {
      STATE.loading = false;
      STATE.loaded = !!window.mermaid;
      if (!STATE.loaded) STATE.failed = true;
      flushWaiters();
    };
    s.onerror = function () {
      STATE.loading = false;
      STATE.failed = true;
      flushWaiters();
    };
    document.head.appendChild(s);
  }

  function flushWaiters() {
    var w = STATE.waiters.slice();
    STATE.waiters.length = 0;
    w.forEach(function (fn) { try { fn(STATE.loaded); } catch (e) {} });
  }

  function initLib() {
    var m = window.mermaid;
    if (!m) return false;
    var sig = themeSig();
    if (initedFor === sig) return true;
    initedFor = sig;
    try {
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark() ? 'dark' : 'default',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
        sequence: { useMaxWidth: true },
        gantt: { useMaxWidth: true }
      });
    } catch (e) { return false; }
    return true;
  }

  /* ---------- 渲染 ---------- */

  function blockOf(code) {
    var el = code;
    while (el && el.nodeType === 1 && !(el.classList && el.classList.contains('blk'))) {
      el = el.parentNode;
    }
    return el && el.classList && el.classList.contains('blk') ? el : null;
  }

  function paint(code, svg) {
    var host = blockOf(code) || (code.parentNode && code.parentNode.parentNode);
    if (!host) return;
    host.classList.add('mermaid-on');
    host.classList.remove('mermaid-err');
    var fig = null;
    for (var i = 0; i < host.children.length; i++) {
      if (host.children[i].classList && host.children[i].classList.contains('mermaid-fig')) {
        fig = host.children[i]; break;
      }
    }
    if (!fig) {
      fig = document.createElement('div');
      fig.className = 'mermaid-fig';
      host.appendChild(fig);
    }
    fig.innerHTML = svg;
    var s = fig.querySelector('svg');
    if (s) {
      // 只去掉 height 属性（CSS 的 height:auto 会接管）。
      // 千万别在这里写 width/max-width —— mermaid 的 useMaxWidth 已经把
      // 合适的 max-width 放在内联 style 里了，覆盖掉就会把小图拉满整栏。
      s.removeAttribute('height');
    }
  }

  function fail(code, err) {
    var host = blockOf(code);
    if (!host) return;
    host.classList.remove('mermaid-on');
    host.classList.add('mermaid-err');
    var old = host.querySelector('.mermaid-msg');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'mermaid-msg';
    var msg = (err && (err.str || err.message)) || String(err || '渲染失败');
    d.textContent = 'Mermaid: ' + msg.replace(/\s+/g, ' ').slice(0, 300);
    host.appendChild(d);
  }

  function renderOne(code) {
    var src = code.textContent;
    var key = themeSig() + '\u0001' + src;
    if (cache[key]) { paint(code, cache[key]); return; }

    var id = 'mmd-' + (++seq);
    var p;
    try {
      p = window.mermaid.render(id, src);
    } catch (e) {
      fail(code, e); return;
    }
    Promise.resolve(p).then(function (r) {
      var svg = typeof r === 'string' ? r : (r && r.svg) || '';
      if (!svg) { fail(code, new Error('产出的 SVG 为空')); return; }
      cache[key] = svg;
      paint(code, svg);
    }, function (e) {
      fail(code, e);
    });
  }

  function drain() {
    if (busy) return;
    if (!queue.length) return;
    if (!initLib()) return;
    busy = true;
    var code = queue.shift();
    // 一个接一个渲染：mermaid 的临时测量节点是按 id 挂在 body 上的，
    // 并发会互相干扰
    try { renderOne(code); } catch (e) {}
    setTimeout(function () { busy = false; drain(); }, 0);
  }

  /* 把 root 里所有未渲染的 mermaid 代码块处理掉 */
  function renderAll(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var codes = root.querySelectorAll('pre > code.language-mermaid');
    if (!codes.length) return;

    var checked = 0, todo = [];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      var host = blockOf(code);
      // 已经画好且主题没变的，跳过
      if (host && host.querySelector('.mermaid-fig') && host.getAttribute('data-mm') === themeSig()) continue;
      if (host) host.setAttribute('data-mm', themeSig());
      todo.push(code);
      if (host) {
        var oldFig = host.querySelector('.mermaid-fig');
        if (oldFig) oldFig.remove();
        var oldMsg = host.querySelector('.mermaid-msg');
        if (oldMsg) oldMsg.remove();
        host.classList.remove('mermaid-err');
        host.classList.remove('mermaid-on');
      }
      checked++;
    }
    if (!todo.length) return;

    // 先吃缓存（同步，不闪）
    var rest = [];
    todo.forEach(function (code) {
      var key = themeSig() + '\u0001' + code.textContent;
      if (cache[key]) paint(code, cache[key]);
      else rest.push(code);
    });
    if (!rest.length) return;

    ensure(function (ok) {
      if (!ok) {
        rest.forEach(function (code) { fail(code, new Error('vendor/mermaid.min.js 未加载')); });
        return;
      }
      queue = queue.concat(rest);
      drain();
    });
  }

  /* 主题切换后整篇重画 */
  function refresh() {
    var all = document.querySelectorAll('.blk.mermaid-on, .blk.mermaid-err');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('mermaid-on');
      all[i].classList.remove('mermaid-err');
      var f = all[i].querySelector('.mermaid-fig');
      if (f) f.remove();
      var m = all[i].querySelector('.mermaid-msg');
      if (m) m.remove();
      all[i].removeAttribute('data-mm');
    }
    initedFor = '';
    renderAll(document);
  }

  /* 导出用：把还没画的图同步补上（返回 Promise 只为方便调用方） */
  function isMermaid(el) {
    return !!(el && el.querySelector && el.querySelector('pre > code.language-mermaid'));
  }

  return {
    renderAll: renderAll,
    refresh: refresh,
    isMermaid: isMermaid,
    themeSig: themeSig,
    _state: STATE,
    _cache: cache
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Diagram;
