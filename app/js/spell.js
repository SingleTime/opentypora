/* spell.js —— 渲染态拼写波浪线
 *
 * 只有块被点开变成 <textarea> 的时候 WebKit 才给红波浪线 —— 渲染态是一堆
 * <div>，系统检查器根本不管。这里自己补一条：把渲染出来的文本节点切词、
 * 批量问原生（NSSpellChecker，和 textarea 背后是同一个），命中的词包一层
 * <span class="spell-bad">，用 CSS 画波浪线。
 *
 * 三层分开、各测各的：
 *   纯函数 tokenize / pending / segments / wrapHTML / fixAt —— Node 里 require 就能测
 *   DOM 层 paint / unpaint / 右键菜单 —— harness 在真 WKWebView 里量
 *   原生层 unknowns / guesses —— native/spell.swift + test/spell/main.swift
 *
 * 三条硬约束：
 *   · 不碰 data-s：包 span 只切文本节点，md.js 打的绝对偏移一个不改；
 *   · 不碰代码：pre/code/.math/.mermaid 一律跳过，宁可漏标也不乱标；
 *   · 不做全篇重算：判过的词进缓存（还落 localStorage），只把没见过的词送原生。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Spell = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ------------------------------------------------------------ 常量 */

  var MINLEN = 2;        // 单字母（a / I）不查
  var MAXLEN = 40;       // 超长串（base64、哈希）不查
  var CHUNK = 1200;      // 单次原生请求的词数
  var CACHE_MAX = 6000;  // 缓存上限
  var CACHE_KEY = 'opentypora.spell.cache';

  /* 词 = 一串字母，允许中间夹撇号（don't / don’t）。
   * 连字符按两个词处理（well-known → well + known），系统词典对复合词不可靠。 */
  var WORDRE = /[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;

  /* ------------------------------------------------------------ 纯函数 */

  function isCandidate(w) {
    if (!w) return false;
    if (w.length < MINLEN || w.length > MAXLEN) return false;
    return /[A-Za-z]/.test(w);
  }

  /* 切词：返回 [{start, end, word}]，位置是 text 内的字符偏移 */
  function tokenize(text) {
    var s = String(text == null ? '' : text);
    var out = [];
    if (!s) return out;
    WORDRE.lastIndex = 0;
    var m;
    while ((m = WORDRE.exec(s))) {
      if (!isCandidate(m[0])) continue;
      out.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    }
    return out;
  }

  /* 这批 token 里还没判过的词（去掉缓存命中的、去重，保持首次出现顺序） */
  function pending(tokens, cache) {
    var out = [], seen = Object.create(null);
    var list = tokens || [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i].word;
      if (cache && cache[w] != null) continue;
      if (seen[w]) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }

  /* 按判定结果挑出要标红的 token */
  function mark(tokens, isBad) {
    var out = [];
    var list = tokens || [];
    for (var i = 0; i < list.length; i++) {
      if (isBad(list[i].word)) out.push(list[i]);
    }
    return out;
  }

  /* 区间 → 分段。返回的分段拼起来必须还原原文（顺序、内容都不许丢）。 */
  function segments(text, rs) {
    var s = String(text == null ? '' : text);
    var list = rs || [];
    var out = [], at = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var a = Math.max(at, Math.min(r.start, s.length));
      var b = Math.max(a, Math.min(r.end, s.length));
      if (b <= a) continue;
      if (a > at) out.push({ text: s.slice(at, a), bad: false });
      out.push({ text: s.slice(a, b), bad: true });
      at = b;
    }
    if (at < s.length || !out.length) out.push({ text: s.slice(at), bad: false });
    return out;
  }

  function escHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 字符串版（单测用；DOM 层自己建节点，不走 innerHTML） */
  function wrapHTML(text, rs) {
    return segments(text, rs).map(function (seg) {
      return seg.bad ? '<span class="spell-bad">' + escHTML(seg.text) + '</span>' : escHTML(seg.text);
    }).join('');
  }

  /* 全篇找离 at 最近的 word 起点（替换时的兜底：data-s 偶尔对不上） */
  function nearest(text, word, at) {
    var s = String(text == null ? '' : text);
    var w = String(word == null ? '' : word);
    if (!w) return -1;
    var best = -1, dist = Infinity, i = -1;
    while ((i = s.indexOf(w, i + 1)) >= 0) {
      var d = Math.abs(i - (at || 0));
      if (d < dist) { dist = d; best = i; }
      // 后面的位置只会更远，提前收工
      if (best >= 0 && i > (at || 0)) break;
    }
    return best;
  }

  /* data-s 算出来的位置先在 ±3 内微调一下，再退到全篇搜索 */
  function fixAt(text, word, at) {
    var s = String(text == null ? '' : text);
    var w = String(word == null ? '' : word);
    if (!w) return -1;
    if (at != null && at >= 0 && s.substr(at, w.length) === w) return at;
    for (var d = 1; d <= 3; d++) {
      if (at != null && at - d >= 0 && s.substr(at - d, w.length) === w) return at - d;
      if (at != null && at + d >= 0 && s.substr(at + d, w.length) === w) return at + d;
    }
    return nearest(s, w, at);
  }

  function chunkList(list, n) {
    var out = [], size = Math.max(1, n | 0);
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /* ------------------------------------------------------------ 状态 */

  var on = false;
  var ENGINE = null;        // function(words, ignore) -> Promise<number[]>
  var GUESSER = null;       // function(word) -> Promise<string[]>
  var IGNORE = [];          // 已忽略的词（小写）
  var CACHE = Object.create(null);   // word -> 1 错 / 0 对
  var ASKING = Object.create(null);  // 在途请求，避免重复问
  var ROOTS = [];           // 画过的根节点（结果回来时重画）
  var HOOKS = { onIgnore: null };
  var GMEM = Object.create(null);    // 建议词缓存
  var MENU = null;
  var installed = false;

  function hasDoc() { return typeof document !== 'undefined' && !!document.createElement; }

  /* ------------------------------------------------------------ 缓存 */

  function loadCache() {
    try {
      var ls = root && root.localStorage;
      if (!ls) return;
      var raw = ls.getItem(CACHE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      for (var k in o) {
        if (o[k] === 0 || o[k] === 1) CACHE[k] = o[k];
      }
    } catch (e) {}
  }

  function saveCache() {
    try {
      var ls = root && root.localStorage;
      if (!ls) return;
      var keys = Object.keys(CACHE);
      if (keys.length > CACHE_MAX) {
        // 键序就是插入序：留后一半，前面的当旧知识丢掉
        var keep = keys.slice(-Math.floor(CACHE_MAX / 2));
        var fresh = Object.create(null);
        for (var i = 0; i < keep.length; i++) fresh[keep[i]] = CACHE[keep[i]];
        CACHE = fresh;
      }
      ls.setItem(CACHE_KEY, JSON.stringify(CACHE));
    } catch (e) {}
  }

  function cacheGet(w) { return CACHE[w]; }
  function cacheSize() { return Object.keys(CACHE).length; }

  /* ------------------------------------------------------------ 生成原生请求 */

  function send(words) {
    var done = function () {
      for (var i = 0; i < words.length; i++) delete ASKING[words[i]];
    };
    var p = null;
    try { p = ENGINE(words, IGNORE.slice()); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') { done(); return; }
    p.then(function (bad) {
      done();
      var hit = Object.create(null);
      var arr = bad || [];
      if (arr.length === words.length && typeof arr[0] === 'boolean') {
        // 也接受同长度的布尔数组，省得调用方老是 index 来 index 去
        for (var i = 0; i < words.length; i++) if (arr[i]) hit[words[i]] = 1;
      } else {
        for (var k = 0; k < arr.length; k++) {
          var idx = arr[k];
          if (typeof idx === 'number' && words[idx] != null) hit[words[idx]] = 1;
        }
      }
      for (var j = 0; j < words.length; j++) CACHE[words[j]] = hit[words[j]] ? 1 : 0;
      saveCache();
      repaint();
    }, function () {
      // 失败就不写缓存 —— 下次还会再问，不能把"没问到"记成"没问题"
      done();
    });
  }

  function ask(words) {
    if (!ENGINE || !words || !words.length) return 0;
    var list = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (ASKING[w]) continue;
      ASKING[w] = 1;
      list.push(w);
    }
    if (!list.length) return 0;
    var chunks = chunkList(list, CHUNK);
    for (var c = 0; c < chunks.length; c++) send(chunks[c]);
    return list.length;
  }

  /* ------------------------------------------------------------ DOM 层 */

  var SKIP_TAG = {
    CODE: 1, PRE: 1, KBD: 1, SAMP: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, SVG: 1, MATH: 1
  };
  var SKIP_CLS = ['editing', 'spell-bad', 'math-inline', 'math-block', 'katex', 'katex-display',
    'mermaid', 'flow-svg', 'raw-html', 'emoji', 'code-lang-sel', 'code-copy', 'toc', 'fn-ref',
    'review-comment'];

  function hitsCls(cl) {
    for (var i = 0; i < SKIP_CLS.length; i++) if (cl.contains(SKIP_CLS[i])) return true;
    return false;
  }

  /* 从文本节点往上爬到 root（含），任何一层命中禁区就整段跳过 */
  function blocked(node, rootEl) {
    var el = node.parentNode;
    while (el && el.nodeType === 1) {
      if (SKIP_TAG[el.tagName]) return true;
      if (el.classList && hitsCls(el.classList)) return true;
      if (el === rootEl) break;
      el = el.parentNode;
    }
    return false;
  }

  function collect(rootEl) {
    var out = [];
    if (!hasDoc() || !rootEl) return out;
    var w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = w.nextNode())) {
      var v = n.nodeValue;
      if (!v || v.length < MINLEN || !/[A-Za-z]/.test(v)) continue;
      if (blocked(n, rootEl)) continue;
      var toks = tokenize(v);
      if (toks.length) out.push({ node: n, tokens: toks });
    }
    return out;
  }

  /* 把一段文本节点里命中的词包成 <span class="spell-bad">，返回包了几个 */
  function wrapNode(node, rs) {
    var segs = segments(node.nodeValue, rs);
    var frag = document.createDocumentFragment();
    var made = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s.text) continue;
      if (s.bad) {
        var sp = document.createElement('span');
        sp.className = 'spell-bad';
        sp.textContent = s.text;
        frag.appendChild(sp);
        made++;
      } else {
        frag.appendChild(document.createTextNode(s.text));
      }
    }
    if (made && node.parentNode) node.parentNode.replaceChild(frag, node);
    return made;
  }

  function unpaint(rootEl) {
    if (!hasDoc() || !rootEl || !rootEl.querySelectorAll) return 0;
    var list = rootEl.querySelectorAll('.spell-bad');
    var n = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var sp = list[i];
      var p = sp.parentNode;
      if (!p) continue;
      p.replaceChild(document.createTextNode(sp.textContent), sp);
      // 合并相邻文本节点：开一次关一次不能攒一堆碎片
      if (p.normalize) p.normalize();
      n++;
    }
    return n;
  }

  function remember(rootEl) {
    if (!rootEl || rootEl.nodeType !== 1) return;
    for (var i = 0; i < ROOTS.length; i++) if (ROOTS[i] === rootEl) return;
    ROOTS.push(rootEl);
    if (ROOTS.length > 8) ROOTS.shift();
  }

  /* 上色。
   * rootEl 是整篇 #editor，或者单个 .blk（退出编辑时只重画那一个块）。
   * 返回这次包出来的波浪线数量。 */
  function paint(rootEl) {
    if (!hasDoc() || !rootEl) return 0;
    remember(rootEl);
    if (!on) return 0;
    unpaint(rootEl);
    var jobs = collect(rootEl);
    var all = [], i, j;
    for (i = 0; i < jobs.length; i++) {
      for (j = 0; j < jobs[i].tokens.length; j++) all.push(jobs[i].tokens[j]);
    }
    var miss = pending(all, CACHE);
    var marked = 0;
    for (i = 0; i < jobs.length; i++) {
      var rs = mark(jobs[i].tokens, function (w) { return CACHE[w] === 1; });
      if (rs.length) marked += wrapNode(jobs[i].node, rs);
    }
    if (miss.length) ask(miss);
    return marked;
  }

  function repaint() {
    var live = [];
    for (var i = 0; i < ROOTS.length; i++) {
      var r = ROOTS[i];
      if (!r || r.isConnected === false) continue;
      live.push(r);
    }
    ROOTS = [];
    for (var k = 0; k < live.length; k++) paint(live[k]);
  }

  function editorRoot() {
    return hasDoc() ? document.getElementById('editor') : null;
  }

  function setEnabled(v) {
    var next = !!v;
    // 状态没变就不动 DOM：applyPrefs 每次拖字号/宽度都会调到这里，
    // 真去重扫全篇的话，拖一下滑块就是几十次 TreeWalker。
    if (next === on) {
      if (next) install();
      return on;
    }
    on = next;
    if (on) {
      install();
      paint(editorRoot());
    } else {
      var r = editorRoot();
      if (r) unpaint(r);
      for (var i = 0; i < ROOTS.length; i++) unpaint(ROOTS[i]);
      ROOTS = [];
      closeMenu();
    }
    return on;
  }

  function isEnabled() { return on; }

  /* ------------------------------------------------------------ 忽略表 */

  function normIgnore(list) {
    var out = [];
    var arr = list || [];
    for (var i = 0; i < arr.length; i++) {
      var w = String(arr[i] == null ? '' : arr[i]).toLowerCase();
      if (!w || out.indexOf(w) >= 0) continue;
      out.push(w);
    }
    return out;
  }

  function setIgnore(list) {
    var next = normIgnore(list);
    var same = next.length === IGNORE.length;
    for (var k = 0; same && k < next.length; k++) if (next[k] !== IGNORE[k]) same = false;
    IGNORE = next;
    if (same) return IGNORE.slice();      // 表没变就别重画（同样是为了拖滑块）
    for (var i = 0; i < IGNORE.length; i++) CACHE[IGNORE[i]] = 0;
    repaint();
    return IGNORE.slice();
  }

  function ignoreList() { return IGNORE.slice(); }

  /* 用户点了「忽略此词」：写本地缓存 + 通知外壳存偏好 */
  function ignore(word) {
    var w = String(word == null ? '' : word);
    if (!w) return false;
    var k = w.toLowerCase();
    if (IGNORE.indexOf(k) < 0) IGNORE.push(k);
    CACHE[w] = 0;
    CACHE[k] = 0;
    delete ASKING[w];
    delete GMEM[w];
    saveCache();
    repaint();
    if (HOOKS.onIgnore) HOOKS.onIgnore(w);
    return true;
  }

  /* ------------------------------------------------------------ 建议词 */

  function suggest(word) {
    var w = String(word == null ? '' : word);
    if (!w) return Promise.resolve([]);
    if (GMEM[w]) return Promise.resolve(GMEM[w].slice());
    if (!GUESSER) return Promise.resolve([]);
    var p = null;
    try { p = GUESSER(w); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') return Promise.resolve([]);
    return p.then(function (gs) {
      var list = (gs || []).filter(function (g) { return g && g !== w; });
      GMEM[w] = list;
      return list.slice();
    }, function () { return []; });
  }

  /* 波浪线所在块的块号（.blk[data-i]）。
   * md.js 给每个块单独 parse，所以 data-s 是**块内**偏移，不是全篇偏移 ——
   * 定位必须带块号，否则同词出现两次会改到别处去。 */
  function blockIndexOf(sp) {
    var el = sp;
    while (el && el.getAttribute) {
      var i = el.getAttribute('data-i');
      if (i != null) return +i;
      el = el.parentNode;
    }
    return -1;
  }

  /* 波浪线在块 raw 里的偏移：最近的 data-s（块内绝对偏移）+ 词在片段内的偏移。
   * 行内链接这类 data-s 指向 `[`，会差一两个字符，交给 fixAt 去修。 */
  function rawOffset(sp) {
    if (!hasDoc() || !sp) return null;
    var el = sp, base = null;
    while (el && el.getAttribute) {
      var ds = el.getAttribute('data-s');
      if (ds != null) { base = +ds; break; }
      el = el.parentNode;
    }
    if (base == null || !isFinite(base)) return null;
    var node = sp.firstChild;
    if (!node || node.nodeType !== 3) return null;
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var t, n = 0;
    while ((t = w.nextNode())) {
      if (t === node) return base + n;
      n += t.nodeValue.length;
    }
    return null;
  }

  /* 用建议词替换正文里的那一处。
   * 走 replaceRawRange（块内区间），不走 replaceAt（全篇区间）：块内定位准，
   * 也不用先算出每个块的起点。 */
  function apply(sp, word, sug) {
    var Ed = root && root.Editor;
    if (!Ed || !Ed.replaceRawRange) return false;
    var i = blockIndexOf(sp);
    if (i < 0) return false;
    var w = String(word == null ? '' : word);
    var raw = Ed.getRaw ? Ed.getRaw(i) : '';
    var at = fixAt(raw, w, rawOffset(sp));
    if (at == null || at < 0) return false;
    return Ed.replaceRawRange(i, at, at + w.length, String(sug == null ? '' : sug));
  }

  /* ------------------------------------------------------------ 右键菜单 */

  function closeMenu() {
    if (MENU && MENU.parentNode) MENU.parentNode.removeChild(MENU);
    MENU = null;
  }

  function menuButton(label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'spell-menu-item' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return b;
  }

  function place(m, x, y) {
    var r = m.getBoundingClientRect();
    var left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - r.width - 8));
    var top = Math.min(Math.max(8, y + 4), Math.max(8, window.innerHeight - r.height - 8));
    m.style.left = Math.round(left) + 'px';
    m.style.top = Math.round(top) + 'px';
  }

  function openMenu(sp, x, y) {
    closeMenu();
    var word = sp.textContent || '';
    var m = document.createElement('div');
    m.className = 'spell-menu';
    m.setAttribute('role', 'menu');

    var head = document.createElement('div');
    head.className = 'spell-menu-head';
    head.textContent = word;
    m.appendChild(head);

    var box = document.createElement('div');
    box.className = 'spell-menu-list spell-menu-wait';
    box.textContent = '查询建议…';
    m.appendChild(box);

    m.appendChild(menuButton('忽略「' + word + '」', 'spell-menu-ignore', function () {
      ignore(word);
      closeMenu();
    }));

    document.body.appendChild(m);
    MENU = m;
    place(m, x, y);

    suggest(word).then(function (gs) {
      if (MENU !== m) return;
      box.className = 'spell-menu-list';
      box.textContent = '';
      if (!gs.length) {
        var none = document.createElement('div');
        none.className = 'spell-menu-none';
        none.textContent = '没有建议';
        box.appendChild(none);
      } else {
        gs.forEach(function (g) {
          box.appendChild(menuButton(g, '', function () { apply(sp, word, g); closeMenu(); }));
        });
      }
      place(m, x, y);
    });
  }

  function onContext(e) {
    if (!on) return;
    var t = e.target;
    var sp = t && t.closest ? t.closest('.spell-bad') : null;
    if (!sp) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(sp, e.clientX, e.clientY);
  }

  function onDocClick(e) {
    if (!MENU) return;
    if (MENU.contains(e.target)) return;
    closeMenu();
  }

  function onKey(e) {
    if (!MENU) return;
    if (e.key === 'Escape' || e.keyCode === 27) {
      closeMenu();
      e.stopPropagation();
    }
  }

  function install() {
    if (installed || !hasDoc()) return;
    installed = true;
    document.addEventListener('contextmenu', onContext, true);
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    // 滚动会让 fixed 定位的菜单和词脱开，直接关掉
    document.addEventListener('scroll', function () { if (MENU) closeMenu(); }, true);
  }

  /* ------------------------------------------------------------ 对外 */

  function setEngine(fn) { ENGINE = typeof fn === 'function' ? fn : null; }
  function setGuesses(fn) { GUESSER = typeof fn === 'function' ? fn : null; GMEM = Object.create(null); }
  function onIgnore(fn) { HOOKS.onIgnore = typeof fn === 'function' ? fn : null; }

  function stats() {
    return {
      enabled: on, painted: ROOTS.length, cached: cacheSize(),
      ignored: IGNORE.length, asking: Object.keys(ASKING).length,
      engine: !!ENGINE, guesser: !!GUESSER, menu: !!MENU
    };
  }

  function _reset() {
    unpaint(editorRoot());
    for (var i = 0; i < ROOTS.length; i++) unpaint(ROOTS[i]);
    ROOTS = [];
    CACHE = Object.create(null);
    ASKING = Object.create(null);
    IGNORE = [];
    GMEM = Object.create(null);
    closeMenu();
    on = false;
    ENGINE = null;
    GUESSER = null;
    HOOKS.onIgnore = null;
  }

  loadCache();

  return {
    // 纯函数
    isCandidate: isCandidate,
    tokenize: tokenize,
    pending: pending,
    mark: mark,
    segments: segments,
    wrapHTML: wrapHTML,
    escHTML: escHTML,
    nearest: nearest,
    fixAt: fixAt,
    chunkList: chunkList,
    MINLEN: MINLEN,
    MAXLEN: MAXLEN,
    CHUNK: CHUNK,
    CACHE_KEY: CACHE_KEY,
    CACHE_MAX: CACHE_MAX,
    // DOM
    paint: paint,
    unpaint: unpaint,
    repaint: repaint,
    rawOffset: rawOffset,
    blockIndexOf: blockIndexOf,
    apply: apply,
    suggest: suggest,
    openMenu: openMenu,
    closeMenu: closeMenu,
    // 开关与依赖注入
    setEngine: setEngine,
    setGuesses: setGuesses,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    setIgnore: setIgnore,
    ignoreList: ignoreList,
    ignore: ignore,
    onIgnore: onIgnore,
    cacheGet: cacheGet,
    cacheSize: cacheSize,
    stats: stats,
    _reset: _reset
  };
});
