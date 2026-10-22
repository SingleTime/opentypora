/* ============================================================
 * workbench.js — 文件工作区：最近文件 / Open Quickly / 全局搜索 /
 *                文章列表 / 文件树右键操作 / 目录变动监视 / 草稿恢复
 *
 * 全部能力都通过 ui.js 传进来的 adapter 落地，自身不直接改编辑器状态，
 * 这样 Node 单测里也能只测纯函数（fuzzy / groupArticles）。
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Workbench = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A = null;                       // adapter（由 ui.js 注入）
  var watchTimer = null;
  var lastSig = '';
  var searchCache = {};               // path -> content
  var pal = { open: false, items: [], idx: 0 };
  var gs = { open: false, q: '', caseSensitive: false, wholeWord: false, regex: false, hits: [], busy: false };
  var RECENT_KEY = 'opentypora.recent';
  var DRAFT_KEY = 'opentypora.draft';

  function d() { return root.document; }
  function $(id) { var doc = d(); return doc ? doc.getElementById(id) : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, action) { if (A && A.toast) A.toast(msg, action); }

  /* ---------------------------------------------------------- 纯函数（可单测） */

  // 子序列模糊匹配：连续命中、词首命中加分
  function fuzzyScore(query, text) {
    var q = String(query || '').toLowerCase().replace(/\s+/g, '');
    var t = String(text || '').toLowerCase();
    if (!q) return 1;
    var qi = 0, score = 0, streak = 0, last = -2;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) {
        qi++;
        streak = (last === i - 1) ? streak + 1 : 1;
        score += 2 + streak * 2;
        if (i === 0 || /[\/\-_. ]/.test(t[i - 1])) score += 6;   // 词首
        last = i;
      }
    }
    if (qi < q.length) return 0;                                  // 没匹配全
    return score - Math.max(0, t.length - q.length) * 0.02;
  }

  function groupArticles(list, mode, sort) {
    var arr = (list || []).slice();
    if (sort === 'name') arr.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    else if (sort === 'size') arr.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
    else arr.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
    if (mode !== 'folder') return [{ folder: '', items: arr }];
    var map = {}, order = [];
    arr.forEach(function (n) {
      var f = n.folder || '（根目录）';
      if (!map[f]) { map[f] = []; order.push(f); }
      map[f].push(n);
    });
    return order.map(function (f) { return { folder: f, items: map[f] }; });
  }

  /* ---------------------------------------------------------- 最近文件 */

  var RECENT_MAX = 30;

  /* 统一形状：老数据没有 pinned/pinTs，补默认值；顺带去重（同路径只留第一条）。 */
  function normRecent(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = {}, out = [];
    arr.forEach(function (x) {
      if (!x || !x.path) return;
      var p = String(x.path);
      if (seen[p]) return;
      seen[p] = 1;
      out.push({
        path: p,
        name: String(x.name || p.split('/').pop() || p),
        ts: +x.ts || 0,
        pinned: !!x.pinned,
        pinTs: +x.pinTs || 0
      });
    });
    return out;
  }

  /* 固定项置顶（最近固定的在前），其余按打开时间倒序。 */
  function sortedRecent(arr) {
    return normRecent(arr).sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned) return (b.pinTs || b.ts) - (a.pinTs || a.ts);
      return b.ts - a.ts;
    });
  }

  /* 上限只吃「未固定」的：固定项无论多久都留着，但整体仍封顶 RECENT_MAX。 */
  function capRecent(arr) {
    var list = sortedRecent(arr);
    var pins = list.filter(function (x) { return x.pinned; }).slice(0, RECENT_MAX);
    var rest = list.filter(function (x) { return !x.pinned; })
      .slice(0, Math.max(0, RECENT_MAX - pins.length));
    return pins.concat(rest);
  }

  /* 打开/切到某个文件：刷新时间戳，保留原有的固定状态。 */
  function touchRecent(arr, path, name, now) {
    if (!path) return normRecent(arr);
    var list = normRecent(arr), hit = null;
    list = list.filter(function (x) {
      if (x.path === path) { hit = x; return false; }
      return true;
    });
    list.push({
      path: String(path),
      name: String(name || (hit && hit.name) || String(path).split('/').pop()),
      ts: now || Date.now(),
      pinned: !!(hit && hit.pinned),
      pinTs: (hit && hit.pinTs) || 0
    });
    return capRecent(list);
  }

  /* 切换固定。不在列表里的路径不会被凭空加进来。 */
  function togglePinned(arr, path, now) {
    var list = normRecent(arr).map(function (x) {
      if (x.path !== path) return x;
      return {
        path: x.path, name: x.name, ts: x.ts,
        pinned: !x.pinned, pinTs: x.pinned ? 0 : (now || Date.now())
      };
    });
    return sortedRecent(list);
  }

  function isPinned(arr, path) {
    return normRecent(arr).some(function (x) { return x.path === path && x.pinned; });
  }

  function readRecent() {
    try {
      var raw = root.localStorage.getItem(RECENT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return sortedRecent(arr);
    } catch (e) { return []; }
  }

  function writeRecent(arr) {
    try {
      root.localStorage.setItem(RECENT_KEY, JSON.stringify(capRecent(arr)));
    } catch (e) {}
  }

  function addRecent(path, name) {
    if (!path) return;
    writeRecent(touchRecent(readRecent(), path, name));
    renderRecent();
  }

  function pinRecent(path) {
    if (!path) return;
    var arr = togglePinned(readRecent(), path);
    writeRecent(arr);
    renderRecent();
    return isPinned(arr, path);
  }

  function renderRecent() {
    var box = $('recent');
    if (!box) return;
    var arr = readRecent();
    if (!arr.length) { box.innerHTML = '<div class="outline-empty">还没有打开过文件</div>'; return; }
    box.innerHTML = arr.map(function (it) {
      var act = it.pinned ? '取消固定' : '固定到列表';
      return '<div class="recent-row' + (it.pinned ? ' pinned' : '') + '">' +
        '<button class="recent-item" data-path="' + esc(it.path) + '" title="' + esc(it.path) + '">' +
        '<span class="recent-name">' + esc(it.name) + '</span>' +
        '<span class="recent-time">' + timeAgo(it.ts) + '</span></button>' +
        '<button class="recent-pin" data-pin="' + esc(it.path) + '" title="' + act + '" ' +
        'aria-label="' + act + '" aria-pressed="' + (it.pinned ? 'true' : 'false') + '">' +
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<path d="M10.2 1.4a.8.8 0 0 1 1.2 0l3.2 3.2a.8.8 0 0 1-.3 1.3l-1.6.5-2.7 2.7.2 1.9a.8.8 0 0 1-1.3.7L5.4 8.5 2 11.9 1.1 11l3.4-3.4L1.9 5.1a.8.8 0 0 1 .7-1.3l1.9.2 2.7-2.7.5-1.6a.8.8 0 0 1 .1-.3z" ' +
        'fill="currentColor"/></svg></button></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-path]'), function (el) {
      el.addEventListener('click', function () { A.open(el.getAttribute('data-path')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-pin]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        pinRecent(el.getAttribute('data-pin'));
      });
    });
  }

  function timeAgo(ts) {
    var s = Math.max(0, (Date.now() - (ts || 0)) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  /* ---------------------------------------------------------- 通用浮层 */

  function openOverlay(id) {
    var el = $(id);
    if (!el) return;
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeOverlay(id) {
    var el = $(id);
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }

  function anyOverlayOpen() {
    return pal.open || gs.open;
  }

  /* ---------------------------------------------------------- Open Quickly */

  function allNotes() {
    var notes = (A && A.notes && A.notes()) || [];
    var recent = readRecent();
    var seen = {}, out = [];
    recent.forEach(function (r) {
      if (seen[r.path]) return;
      seen[r.path] = 1;
      out.push({ name: r.name, path: r.path, rel: r.path, mtime: r.ts, recent: true });
    });
    notes.forEach(function (n) {
      if (seen[n.path]) return;
      seen[n.path] = 1;
      out.push(n);
    });
    return out;
  }

  function renderPalette() {
    var box = $('palette-list');
    if (!box) return;
    if (!pal.items.length) {
      box.innerHTML = '<div class="ovl-empty">没有匹配的文件' +
        (A && A.root() ? '' : '（先打开一个文件夹）') + '</div>';
      return;
    }
    box.innerHTML = pal.items.map(function (n, k) {
      return '<button class="ovl-item' + (k === pal.idx ? ' active' : '') + '" data-k="' + k + '">' +
        '<span class="ovl-name">' + esc(n.name) + '</span>' +
        '<span class="ovl-sub">' + esc(n.rel || n.path) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.ovl-item'), function (el) {
      el.addEventListener('click', function () { palChoose(+el.getAttribute('data-k')); });
    });
    var act = box.querySelector('.ovl-item.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  }

  function palFilter() {
    var q = ($('palette-q') || {}).value || '';
    var list = allNotes().map(function (n) {
      var rel = n.rel || n.path;
      var best = Math.max(fuzzyScore(q, n.name), fuzzyScore(q, rel) - 4);
      return { n: n, s: best };
    }).filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 60)
      .map(function (x) { return x.n; });
    pal.items = list;
    pal.idx = 0;
    renderPalette();
  }

  function openQuick() {
    pal.open = true;
    openOverlay('palette');
    var q = $('palette-q');
    q.value = '';
    palFilter();
    q.focus();
  }

  function closeQuick() {
    pal.open = false;
    closeOverlay('palette');
  }

  function palChoose(k) {
    var n = pal.items[k];
    if (!n) return;
    closeQuick();
    if (A && A.open) A.open(n.path);
  }

  /* ---------------------------------------------------------- 全局搜索 */

  function gsOpt() {
    return { caseSensitive: gs.caseSensitive, wholeWord: gs.wholeWord, regex: gs.regex };
  }

  function readNote(path) {
    if (searchCache[path] != null) return Promise.resolve(searchCache[path]);
    if (root.Bridge && root.Bridge.available && root.Bridge.readText) {
      return root.Bridge.readText(path).then(function (r) {
        searchCache[path] = (r && r.content) || '';
        return searchCache[path];
      }).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function openSearch() {
    gs.open = true;
    openOverlay('gsearch');
    var q = $('gs-q');
    q.focus();
    q.select();
    runSearch();
  }

  function closeSearch() {
    gs.open = false;
    closeOverlay('gsearch');
  }

  function runSearch() {
    var q = ($('gs-q') || {}).value || '';
    gs.q = q;
    var box = $('gs-list');
    var cnt = $('gs-count');
    if (!q.trim()) {
      box.innerHTML = '<div class="ovl-empty">输入关键词，或在结果里回车跳转</div>';
      if (cnt) cnt.textContent = '';
      return;
    }
    var notes = (A && A.notes && A.notes()) || [];
    if (!notes.length) {
      box.innerHTML = '<div class="ovl-empty">先打开一个文件夹（⌘⇧O）才能跨文件搜索</div>';
      if (cnt) cnt.textContent = '';
      return;
    }
    gs.busy = true;
    box.innerHTML = '<div class="ovl-empty">搜索中…</div>';
    var hits = [];
    var seq = notes.slice(0, 500);
    var i = 0;

    function step() {
      if (i >= seq.length || hits.length >= 300 || !gs.open) {
        gs.busy = false;
        gs.hits = hits;
        renderSearch();
        return;
      }
      var n = seq[i++];
      readNote(n.path).then(function (text) {
        if (text) {
          var re;
          try { re = MD().findAll(text, q, gsOpt()); } catch (e) { re = null; }
          if (re === null) {
            box.innerHTML = '<div class="ovl-empty">正则有误</div>';
            gs.busy = false;
            return;
          }
          re.slice(0, 20).forEach(function (m) {
            var ls = text.lastIndexOf('\n', m.start - 1) + 1;
            var le = text.indexOf('\n', m.end); if (le < 0) le = text.length;
            hits.push({
              path: n.path, name: n.name, start: m.start, end: m.end,
              line: text.slice(0, m.start).split('\n').length,
              text: text.slice(ls, le).trim().slice(0, 220)
            });
          });
        }
        step();
      });
    }
    step();
  }

  function renderSearch() {
    var box = $('gs-list');
    var cnt = $('gs-count');
    if (!box) return;
    if (!gs.hits.length) {
      box.innerHTML = '<div class="ovl-empty">没有匹配</div>';
      if (cnt) cnt.textContent = '0 处';
      return;
    }
    if (cnt) cnt.textContent = gs.hits.length + ' 处';
    var html = '', last = '';
    gs.hits.forEach(function (h, k) {
      if (h.path !== last) {
        last = h.path;
        html += '<div class="gs-file">' + esc(h.name) + '</div>';
      }
      html += '<button class="gs-hit" data-k="' + k + '">' +
        '<span class="gs-line">' + h.line + '</span>' +
        '<span class="gs-text">' + esc(h.text) + '</span></button>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.gs-hit'), function (el) {
      el.addEventListener('click', function () { gsChoose(+el.getAttribute('data-k')); });
    });
    var first = box.querySelector('.gs-hit');
    if (first) first.classList.add('active');
  }

  function gsChoose(k) {
    var h = gs.hits[k];
    if (!h) return;
    closeSearch();
    if (A && A.open) {
      A.open(h.path, h.start, h.end - h.start);
    }
  }

  /* ---------------------------------------------------------- 文章列表 */

  function renderArticles() {
    var box = $('articles');
    if (!box) return;
    var notes = (A && A.notes && A.notes()) || [];
    if (!notes.length) { box.innerHTML = '<div class="outline-empty">打开文件夹后显示文章列表</div>'; return; }
    var sort = ($('art-sort') || {}).value || 'mtime';
    var group = ($('art-group') || {}).value || 'none';
    var groups = groupArticles(notes, group, sort);
    var html = '';
    groups.forEach(function (g) {
      if (g.folder) html += '<div class="art-folder">' + esc(g.folder) + ' · ' + g.items.length + '</div>';
      g.items.forEach(function (n) {
        html += '<button class="art-item" data-path="' + esc(n.path) + '">' +
          '<span class="art-name">' + esc(n.name.replace(/\.(md|markdown|mdown|txt)$/i, '')) + '</span>' +
          '<span class="art-meta">' + timeAgo((n.mtime || 0) * 1000) +
          (n.size ? ' · ' + Math.max(1, Math.round(n.size / 1024)) + 'KB' : '') + '</span></button>';
      });
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-path]'), function (el) {
      el.addEventListener('click', function () { A.open(el.getAttribute('data-path')); });
    });
  }

  /* ---------------------------------------------------------- 文件树右键 */

  function bindTreeMenu() {
    var tree = $('tree');
    if (!tree) return;
    tree.addEventListener('contextmenu', function (e) {
      var item = e.target.closest && e.target.closest('[data-path]');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      showCtx(item.getAttribute('data-path'), item.getAttribute('data-dir') === '1', e.clientX, e.clientY);
    });
  }

  function showCtx(path, isDir, x, y) {
    var menu = $('ctxmenu');
    if (!menu) return;
    var dir = isDir ? path : path.replace(/\/[^/]+$/, '');
    var items = [];
    if (isDir) {
      items.push(['新建 Markdown 文件', function () { newEntry(dir, false); }]);
      items.push(['新建文件夹', function () { newEntry(dir, true); }]);
      items.push(['—']);
    }
    items.push(['重命名…', function () { renameEntry(path); }]);
    if (!isDir) items.push(['创建副本', function () { dupEntry(path); }]);
    if (root.Bridge && root.Bridge.chooseFolder) {
      items.push(['移动到…', function () { moveEntry(path); }]);
    }
    items.push(['在 Finder 中显示', function () {
      if (root.Bridge && root.Bridge.available) root.Bridge.reveal(path);
    }]);
    items.push(['复制路径', function () {
      if (root.Bridge && root.Bridge.available) root.Bridge.copy(path);
      else if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(path);
      toast('已复制路径');
    }]);
    items.push(['—']);
    items.push(['移到废纸篓', function () { trashEntry(path); }, 'danger']);

    menu.innerHTML = items.map(function (it, k) {
      if (it[0] === '—') return '<div class="ctx-sep"></div>';
      return '<button class="ctx-item' + (it[2] === 'danger' ? ' danger' : '') + '" data-k="' + k + '">' + esc(it[0]) + '</button>';
    }).join('');
    Array.prototype.forEach.call(menu.querySelectorAll('.ctx-item'), function (el) {
      el.addEventListener('click', function () {
        var it = items[+el.getAttribute('data-k')];
        hideCtx();
        if (it && it[1]) it[1]();
      });
    });
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.left = Math.min(x, (root.innerWidth || 1200) - 190) + 'px';
    menu.style.top = Math.min(y, (root.innerHeight || 800) - menu.offsetHeight - 10) + 'px';
  }

  function hideCtx() {
    var menu = $('ctxmenu');
    if (!menu) return;
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }

  function promptText(title, value) {
    return new Promise(function (resolve) {
      var d0 = d();
      var mask = d0.createElement('div');
      mask.className = 'tbl-dlg-mask';
      mask.innerHTML = '<div class="tbl-dlg"><div class="tbl-dlg-title">' + esc(title) + '</div>' +
        '<input id="wb-prompt" class="wb-prompt" type="text" value="' + esc(value || '') + '">' +
        '<div class="tbl-dlg-actions"><button id="wb-cancel" class="tbl-dlg-btn">取消</button>' +
        '<button id="wb-ok" class="tbl-dlg-btn primary">确定</button></div></div>';
      d0.body.appendChild(mask);
      var ip = mask.querySelector('#wb-prompt');
      setTimeout(function () { ip.focus(); ip.select(); }, 0);
      function done(v) { if (mask.parentNode) mask.parentNode.removeChild(mask); resolve(v); }
      mask.querySelector('#wb-cancel').addEventListener('click', function () { done(null); });
      mask.querySelector('#wb-ok').addEventListener('click', function () { done(ip.value.trim() || null); });
      mask.addEventListener('mousedown', function (e) { if (e.target === mask) done(null); });
      mask.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done(ip.value.trim() || null); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
    });
  }

  /* ------------------------------------------------ 文件操作撤销
   * 每个成功的文件操作都记一条 { label, run }，run 里带逆操作。
   * 设计约束：
   *   · 撤销也是文件操作，失败要把原因说清楚（废纸篓被清空、原位置被占用…）
   *   · 撤销正在编辑的文件的重命名时，要把编辑器也切回旧路径
   *   · 栈有上限（20），超出丢最旧的——与 closedStack 一致
   */
  var fsUndo = [];
  var FS_UNDO_MAX = 20;

  function pushUndo(entry) {
    if (!entry || typeof entry.run !== 'function') return;
    fsUndo.push(entry);
    if (fsUndo.length > FS_UNDO_MAX) fsUndo.shift();
  }

  function canUndoFileOp() { return fsUndo.length > 0; }

  function lastUndoLabel() { return fsUndo.length ? fsUndo[fsUndo.length - 1].label : ''; }

  function undoFileOp() {
    if (!fsUndo.length) { toast('没有可撤销的文件操作'); return Promise.resolve(false); }
    var entry = fsUndo.pop();
    return Promise.resolve()
      .then(entry.run)
      .then(function () {
        refreshTree();
        toast('已撤销：' + entry.label);
        return true;
      })
      .catch(function (e) {
        toast('撤销失败：' + (e && e.message ? e.message : e));
        return false;
      });
  }

  // 操作成功后统一出口：刷树 + 带撤销按钮的提示
  function doneWithUndo(label, entry, msg) {
    pushUndo(entry);
    refreshTree();
    toast(msg || ('已' + label), { label: '撤销', fn: undoFileOp });
  }

  /* 把文件移到别的文件夹（chooseFolder 选目录 → fsMoveTo） */
  function moveEntry(path) {
    if (!root.Bridge || !root.Bridge.available) { toast('需要桌面版应用'); return; }
    if (!root.Bridge.chooseFolder) { toast('当前版本不支持选择文件夹'); return; }
    var oldDir = path.replace(/\/[^/]+$/, '');
    root.Bridge.chooseFolder().then(function (dir) {
      if (!dir) return;
      if (dir === oldDir) { toast('文件夹没变'); return; }
      root.Bridge.fsMoveTo(path, dir).then(function (r) {
        var to = (r && r.path) || (dir + '/' + path.split('/').pop());
        doneWithUndo('移动到 ' + dir.split('/').pop(), {
          label: '移动 ' + path.split('/').pop(),
          run: function () {
            return root.Bridge.fsMoveTo(to, oldDir).then(function (r2) {
              if (A && A.current && A.current() === to && r2 && r2.path) A.reopen(r2.path);
            });
          }
        }, '已移动到 ' + dir.split('/').pop());
      }).catch(function (e) { toast('移动失败：' + (e.message || e)); });
    }).catch(function () {});
  }

  function newEntry(dir, isFolder) {
    if (!root.Bridge || !root.Bridge.available) { toast('需要桌面版应用'); return; }
    promptText(isFolder ? '新建文件夹' : '新建 Markdown 文件', isFolder ? '未命名文件夹' : '未命名.md').then(function (name) {
      if (!name) return;
      if (!isFolder && !/\.(md|markdown|txt)$/i.test(name)) name += '.md';
      root.Bridge.fsNew(dir, name, isFolder).then(function (r) {
        var p = r && r.path;
        doneWithUndo('新建', {
          label: '新建 ' + name,
          run: function () { return root.Bridge.fsTrash(p); }
        });
        if (!isFolder && p) A.open(p);
      }).catch(function (e) { toast('创建失败：' + (e.message || e)); });
    });
  }

  function renameEntry(path) {
    if (!root.Bridge || !root.Bridge.available) { toast('需要桌面版应用'); return; }
    var old = path.split('/').pop();
    promptText('重命名', old).then(function (name) {
      if (!name || name === old) return;
      root.Bridge.fsRename(path, name).then(function (r) {
        var to = r && r.path;
        doneWithUndo('重命名', {
          label: '重命名 ' + old,
          run: function () {
            return root.Bridge.fsRename(to, old).then(function (r2) {
              // 正在编辑的就是这个文件：切回旧路径，别让编辑器指向一个不存在的文件
              if (A && A.current && A.current() === to && r2 && r2.path) A.reopen(r2.path);
            });
          }
        });
      }).catch(function (e) { toast('重命名失败：' + (e.message || e)); });
    });
  }

  function dupEntry(path) {
    if (!root.Bridge || !root.Bridge.available) { toast('需要桌面版应用'); return; }
    root.Bridge.fsDuplicate(path).then(function (r) {
      doneWithUndo('创建副本', {
        label: '创建副本 ' + path.split('/').pop(),
        run: function () { return root.Bridge.fsTrash(r && r.path); }
      });
    }).catch(function (e) { toast('复制失败：' + (e.message || e)); });
  }

  function trashEntry(path) {
    if (!root.Bridge || !root.Bridge.available) { toast('需要桌面版应用'); return; }
    root.Bridge.confirm('把「' + path.split('/').pop() + '」移到废纸篓？', '可在废纸篓里恢复。').then(function (ok) {
      if (!ok) return;
      root.Bridge.fsTrash(path).then(function (r) {
        var trashPath = r && r.trashPath;
        doneWithUndo('移到废纸篓', {
          label: '废纸篓 ' + path.split('/').pop(),
          run: function () {
            if (!root.Bridge.fsRestore) throw new Error('当前版本不支持从废纸篓恢复');
            return root.Bridge.fsRestore(trashPath, path);
          }
        });
      }).catch(function (e) { toast('删除失败：' + (e.message || e)); });
    });
  }

  function refreshTree() {
    if (A && A.reloadTree) A.reloadTree();
    renderArticles();
  }

  /* ---------------------------------------------------------- 目录变动监视 */

  function signature(tree) {
    var out = [];
    (function walk(nodes) {
      (nodes || []).forEach(function (n) {
        out.push(n.path + ':' + (n.mtime || 0) + ':' + (n.size || 0));
        if (n.children) walk(n.children);
      });
    })(tree || []);
    return out.join('|');
  }

  function startWatch() {
    if (watchTimer) clearInterval(watchTimer);
    if (!root.Bridge || !root.Bridge.available) return;
    watchTimer = setInterval(function () {
      var r = A && A.root && A.root();
      if (!r || gs.busy || (root.document && root.document.hidden)) return;
      root.Bridge.fsList(r).then(function (res) {
        var sig = signature(res && res.tree);
        if (!lastSig) { lastSig = sig; return; }
        if (sig !== lastSig) {
          lastSig = sig;
          searchCache = {};
          refreshTree();
        }
      }).catch(function () {});
    }, 4000);
  }

  function noteSig(tree) { lastSig = signature(tree); searchCache = {}; }

  /* ---------------------------------------------------------- 相对链接 / 草稿 */

  function resolveLink(href, curPath, rootPath) {
    var h = String(href || '').split('#')[0];
    if (!h || /^[a-z]+:/i.test(h)) return '';
    if (h.charAt(0) === '/') return h;
    var dir = curPath ? curPath.replace(/\/[^/]+$/, '') : (rootPath || '');
    var abs = dir.charAt(0) === '/';
    var parts = (dir + '/' + h).split('/');
    var stack = [];
    parts.forEach(function (p) {
      if (p === '..') stack.pop();
      else if (p && p !== '.') stack.push(p);
    });
    return (abs ? '/' : '') + stack.join('/');
  }

  function saveDraft(content, name, path) {
    try {
      root.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        content: content, name: name, path: path || '', ts: Date.now()
      }));
    } catch (e) {}
  }

  function readDraft() {
    try {
      var raw = root.localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearDraft() {
    try { root.localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  /* ---------------------------------------------------------- 绑定 */

  function bind() {
    var q = $('palette-q');
    if (q) {
      q.addEventListener('input', palFilter);
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeQuick(); return; }
        if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
          e.preventDefault();
          pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); renderPalette(); return;
        }
        if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
          e.preventDefault();
          pal.idx = Math.max(0, pal.idx - 1); renderPalette(); return;
        }
        if (e.key === 'Enter') { e.preventDefault(); palChoose(pal.idx); return; }
      });
    }
    var overlay = $('palette');
    if (overlay) overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeQuick(); });

    var gq = $('gs-q');
    if (gq) {
      var timer = null;
      gq.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(runSearch, 220);
      });
      gq.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          var first = $('gs-list').querySelector('.gs-hit');
          if (first) first.click();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          var act = $('gs-list').querySelector('.gs-hit.active');
          var next = act && act.nextElementSibling;
          while (next && !next.classList.contains('gs-hit')) next = next.nextElementSibling;
          if (next) { if (act) act.classList.remove('active'); next.classList.add('active'); next.scrollIntoView({ block: 'nearest' }); }
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          var act2 = $('gs-list').querySelector('.gs-hit.active');
          var prev = act2 && act2.previousElementSibling;
          while (prev && !prev.classList.contains('gs-hit')) prev = prev.previousElementSibling;
          if (prev) { if (act2) act2.classList.remove('active'); prev.classList.add('active'); prev.scrollIntoView({ block: 'nearest' }); }
        }
      });
    }
    ['gs-case:caseSensitive', 'gs-word:wholeWord', 'gs-regex:regex'].forEach(function (pair) {
      var p = pair.split(':');
      var btn = $(p[0]);
      if (!btn) return;
      btn.addEventListener('click', function () {
        gs[p[1]] = !gs[p[1]];
        btn.classList.toggle('on', gs[p[1]]);
        runSearch();
      });
    });
    var gsOverlay = $('gsearch');
    if (gsOverlay) gsOverlay.addEventListener('mousedown', function (e) { if (e.target === gsOverlay) closeSearch(); });

    d().addEventListener('mousedown', function (e) {
      if (!e.target.closest || !e.target.closest('#ctxmenu')) hideCtx();
    }, true);

    ['art-sort', 'art-group'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', renderArticles);
    });
    var rc = $('recent-clear');
    if (rc) rc.addEventListener('click', function () { writeRecent([]); renderRecent(); });

    bindTreeMenu();
  }

  function init(adapter) {
    A = adapter || {};
    bind();
    renderRecent();
    renderArticles();
    startWatch();
    var draft = readDraft();
    if (draft && draft.content) {
      // 上次异常退出留下的草稿：让用户决定，不擅自覆盖当前文件
      setTimeout(function () {
        var msg = '发现未保存的草稿（' + (draft.name || '未命名') + '，' + timeAgo(draft.ts) + '）';
        if (root.Bridge && root.Bridge.available && root.Bridge.confirm) {
          root.Bridge.confirm(msg + '，要恢复吗？', '选「否」会丢弃这份草稿。').then(function (ok) {
            if (ok && A.restoreDraft) A.restoreDraft(draft);
            else clearDraft();
          });
        }
      }, 900);
    }
  }

  function MD() { return root.MD; }

  return {
    init: init,
    openQuick: openQuick,
    closeQuick: closeQuick,
    openSearch: openSearch,
    closeSearch: closeSearch,
    isOpen: anyOverlayOpen,
    renderArticles: renderArticles,
    renderRecent: renderRecent,
    addRecent: addRecent,
    // 最近文件：固定到列表
    pinRecent: pinRecent,
    normRecent: normRecent,
    sortedRecent: sortedRecent,
    capRecent: capRecent,
    touchRecent: touchRecent,
    togglePinned: togglePinned,
    isPinned: isPinned,
    RECENT_MAX: RECENT_MAX,
    refreshTree: refreshTree,
    noteSig: noteSig,
    resolveLink: resolveLink,
    saveDraft: saveDraft,
    readDraft: readDraft,
    clearDraft: clearDraft,
    showCtx: showCtx,
    hideCtx: hideCtx,
    prompt: promptText,
    // 文件操作撤销
    undoFileOp: undoFileOp,
    canUndoFileOp: canUndoFileOp,
    lastUndoLabel: lastUndoLabel,
    pushUndo: pushUndo,
    moveEntry: moveEntry,
    newEntry: newEntry,
    renameEntry: renameEntry,
    dupEntry: dupEntry,
    trashEntry: trashEntry,
    // 纯函数，单测用
    fuzzyScore: fuzzyScore,
    groupArticles: groupArticles,
    timeAgo: timeAgo
  };
});
