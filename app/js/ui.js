/* ui.js — 侧边栏、大纲、状态栏、快捷键、文件与导出 */
(function () {
  'use strict';

  var treeRoot = [], collapsed = {}, currentPath = null, folderRoot = null;
  var outlineItems = [];

  var WELCOME = [
    '# OpenTypora',
    '',
    '一个从零开始写的 Markdown 编辑器：**块级所见即所得**，光标落进哪一块，哪一块就露出源码；移开立刻还原排版。',
    '',
    '## 试试这些',
    '',
    '- 直接在任意段落里点一下即可编辑，`# ` 开头会实时变成标题样式',
    '- 用 `⌘1`~`⌘6` 切换标题级别，`⌘B` 加粗、`⌘I` 斜体、`⌘E` 行内代码',
    '- `⌘/` 整篇切到源码模式，再按一次回到排版视图',
    '- `⌘S` 保存，`⌘O` 打开文件，`⌘⇧O` 打开文件夹（左侧出现文件树）',
    '- `⌘T` 新开一个标签页，`⌘W` 关掉当前的；`⌃⇥` / `⌘⇧[ ]` 切换',
    '- 关掉应用再打开，上次那一排标签会自己回来（有磁盘落点的那些）',
    '- 粘贴或拖入截图，落盘到 `assets/`；front matter 里写了 `typora-copy-images-to` 就跟着那个目录走',
    '',
    '> 解析 → 序列化的往返是**字节级无损**的：空行数量、缩进、奇怪的写法都会原样保留，不会偷偷改你的文件。',
    '',
    '### 代码块带高亮',
    '',
    '```javascript',
    'function debounce(fn, ms) {',
    '  let t = null;',
    '  return (...args) => {',
    '    clearTimeout(t);',
    '    t = setTimeout(() => fn(...args), ms);',
    '  };',
    '}',
    '```',
    '',
    '### 表格',
    '',
    '| 能力 | 状态 | 说明 |',
    '| --- | :---: | --- |',
    '| 块级实时渲染 | ✓ | 光标进出块时切换源码/排版 |',
    '| 无损序列化 | ✓ | 往返测试字节一致 |',
    '| 公式 | ✓ | 基础 TeX 子集 |',
    '',
    '行内公式 $E = mc^2$，独立公式：',
    '',
    '$$',
    '\\frac{\\partial L}{\\partial \\theta} = \\sum_{i=1}^{n} \\left( y_i - \\hat{y}_i \\right)',
    '$$',
    '',
    '### 任务清单',
    '',
    '- [x] 解析器与渲染器',
    '- [x] 块级编辑引擎',
    '- [x] 多标签页',
    '',
    '---',
    '',
    '专注模式会把无关段落调暗，打字机模式让当前行始终停在屏幕中央——都在右下角。'
  ];

  WELCOME = WELCOME.join('\n');

  /* ------------------------------------------------ 工具 */
  function $(id) { return document.getElementById(id); }

  var toastTimer = null;
  // action: { label, fn } —— 带操作的 toast 会显示久一些（文件操作撤销用）
  function toast(msg, action) {
    var el = $('toast');
    if (!el) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(msg));
    if (action && action.label && typeof action.fn === 'function') {
      var b = document.createElement('button');
      b.className = 'toast-act';
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        el.classList.remove('show');
        action.fn();
      });
      el.appendChild(b);
    }
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, action ? 5200 : 1600);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function baseName(p) { return p ? p.split('/').pop() : ''; }
  function dirName(p) {
    if (!p) return '';
    var a = p.split('/'); a.pop();
    return a.join('/');
  }

  /* ------------------------------------------------ 状态同步 */
  function refresh(st) {
    var name = Editor.getName();
    var dirty = Editor.isDirty();
    var path = Editor.getPath();

    // 活动标签跟着文档走（名字 / 路径 / 脏标记）；标签栏只在签名变了时重画
    if (window.Tabs) {
      var at = Tabs.activeTab(tabsState);
      if (at && (at.name !== name || at.path !== path || at.dirty !== dirty)) {
        tabsState = Tabs.patch(tabsState, at.id, { name: name, path: path, dirty: dirty });
      }
    }

    $('sb-path').textContent = path || (name + '  （未保存）');
    $('sb-path').classList.toggle('dirty', dirty);
    $('sb-path').title = path || name;

    document.title = (dirty ? '● ' : '') + name + ' — OpenTypora';
    // 退出保护看的是「有没有任何一个标签没保存」，不是当前这个
    var any = window.Tabs ? anyDirty() : dirty;
    window.__appDirty = any;
    if (window.Bridge && window.Bridge.available) {
      window.Bridge.setTitle((dirty ? '● ' : '') + name).catch(function () {});
      window.Bridge.status(any, path).catch(function () {});
    }

    var c = MD.countWords(Editor.getValue());
    $('sb-count').textContent = c.words + ' 字 · ' + c.chars + ' 字符';
    if (wc.open) wcRender();

    renderOutline();
    markTreeActive();
    renderTabs();
    fbDocChanged();
  }

  /* ------------------------------------------------ 大纲 */
  var outlineFilter = '';
  var outlineFold = {};        // 块序号 → true 表示折叠

  function renderOutline() {
    var box = $('outline');
    var items = Editor.getOutline();
    outlineItems = items;
    if (!items.length) {
      box.innerHTML = '<div class="outline-empty">这篇文档还没有标题</div>';
      return;
    }
    var q = String(outlineFilter || '').trim().toLowerCase();

    // 有子标题：紧邻的下一个标题级别更深
    function hasKids(k) {
      return !!(items[k + 1] && items[k + 1].level > items[k].level);
    }
    // 任一祖先被折叠就藏起来
    function folded(k) {
      var lv = items[k].level;
      for (var j = k - 1; j >= 0; j--) {
        if (items[j].level < lv) {
          if (outlineFold[items[j].index]) return true;
          lv = items[j].level;
        }
      }
      return false;
    }

    var html = '';
    items.forEach(function (it, k) {
      if (folded(k)) return;
      if (q && String(it.text || '').toLowerCase().indexOf(q) < 0) return;
      var kids = hasKids(k);
      var open = !outlineFold[it.index];
      html += '<button class="outline-item" data-idx="' + it.index + '" data-k="' + k + '"' +
        ' style="padding-left:' + (6 + (it.level - 1) * 11) + 'px">' +
        (kids
          ? '<span class="ol-caret' + (open ? '' : ' fold') + '" data-fold="' + it.index + '" title="折叠/展开">▾</span>'
          : '<span class="ol-caret ghost"></span>') +
        '<span class="ol-text">' + esc(it.text || '(空标题)') + '</span></button>';
    });
    box.innerHTML = html || '<div class="outline-empty">没有匹配的标题</div>';

    Array.prototype.forEach.call(box.querySelectorAll('.ol-caret[data-fold]'), function (c) {
      c.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = +c.getAttribute('data-fold');
        outlineFold[key] = !outlineFold[key];
        renderOutline();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.outline-item'), function (btn) {
      btn.addEventListener('click', function () {
        Editor.focusBlock(+btn.getAttribute('data-idx'));
        setActiveOutline(btn.getAttribute('data-k'));
      });
    });
    syncOutlineByScroll();
  }

  function setActiveOutline(k) {
    Array.prototype.forEach.call(document.querySelectorAll('.outline-item'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-k') === String(k));
    });
  }

  var scrollTick = null;
  function syncOutlineByScroll() {
    if (!outlineItems.length) return;
    var scroller = $('editor-scroll');
    var mid = scroller.getBoundingClientRect().top + 90;
    var best = 0;
    outlineItems.forEach(function (it, k) {
      var el = document.querySelector('#editor .blk[data-i="' + it.index + '"]');
      if (!el) return;
      if (el.getBoundingClientRect().top <= mid) best = k;
    });
    setActiveOutline(best);
  }

  /* ------------------------------------------------ 文件树 */
  function renderTree() {
    var box = $('tree');
    if (!treeRoot.length) {
      box.innerHTML = '<div class="outline-empty">⌘⇧O 打开一个文件夹</div>';
      return;
    }
    box.innerHTML = treeHTML(treeRoot, 0);
    Array.prototype.forEach.call(box.querySelectorAll('[data-path]'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = el.getAttribute('data-path');
        if (el.getAttribute('data-dir') === '1') {
          collapsed[p] = !collapsed[p];
          renderTree();
        } else {
          openPath(p);
        }
      });
    });
  }

  function treeHTML(nodes, depth) {
    var html = '';
    nodes.forEach(function (n) {
      var pad = 8 + depth * 12;
      if (n.type === 'dir') {
        var isOpen = !collapsed[n.path];
        html += '<button class="tree-item dir" data-path="' + esc(n.path) + '" data-dir="1"' +
          ' style="padding-left:' + pad + 'px">' + (isOpen ? '▾ ' : '▸ ') + esc(n.name) + '</button>';
        if (isOpen && n.children) html += treeHTML(n.children, depth + 1);
      } else {
        html += '<button class="tree-item" data-path="' + esc(n.path) + '" style="padding-left:' + pad + 'px">' +
          esc(n.name) + '</button>';
      }
    });
    return html;
  }

  function markTreeActive() {
    Array.prototype.forEach.call(document.querySelectorAll('.tree-item'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-path') === currentPath);
    });
  }

  /* ------------------------------------------------ 文件操作 */

  /* 打开文件 = 开一个标签页。原来这里要先问「要不要丢弃当前修改」，
   * 现在不需要了：当前文档原样留在它自己的标签里。 */
  function openPath(p, start, len) {
    return window.Bridge.readFile(p).then(function (r) {
      openTab(r.content, r.path, r.name || baseName(r.path), { start: start, len: len });
    }).catch(function (e) { toast('打开失败：' + e.message); });
  }

  /* 重新扫描当前文件夹（右键操作、外部改动后） */
  function reloadFolder(silent) {
    if (!folderRoot || !window.Bridge || !window.Bridge.available) return Promise.resolve();
    return window.Bridge.fsList(folderRoot).then(function (r) {
      if (!r) return;
      treeRoot = r.tree || [];
      renderTree();
      if (window.Workbench) { Workbench.noteSig(treeRoot); Workbench.renderArticles(); }
      if (!silent) toast('文件树已刷新');
    }).catch(function () {});
  }

  /* 文件树拍平：给「文章 / 最近 / 全局搜索」用 */
  function flatNotes() {
    var out = [];
    (function walk(nodes, rel, folder) {
      (nodes || []).forEach(function (n) {
        if (n.type === 'dir') walk(n.children, rel ? rel + '/' + n.name : n.name, rel ? rel + '/' + n.name : n.name);
        else if (/\.(md|markdown|mdown|txt)$/i.test(n.name)) {
          out.push({
            name: n.name, path: n.path,
            rel: rel ? rel + '/' + n.name : n.name,
            folder: folder || '',
            mtime: n.mtime || 0, size: n.size || 0
          });
        }
      });
    })(treeRoot, '', '');
    return out;
  }

  /* 相对 .md 链接：先按当前文档目录解析，再退回文件夹根，最后按文件名找 */
  /* ------------------------------------------------ 拖文件插入链接
   * 从 Finder 拖进来的非图片文件：插一条 Markdown 链接。
   * 优先级（决策在 dropfile.js，纯函数）：拿到绝对路径 → 相对当前文档；
   * 拿不到但能读到文本 → 复制进 assets/ 再链过去；都不行 → 只链文件名。 */
  function insertDroppedFile(f) {
    var name = (f && f.name) || 'file';
    var docDir = currentPath ? currentPath.replace(/\/[^/]*$/, '') : '';
    var D = window.Dropfile;
    var p = D ? D.plan({
      name: name, path: f.path, text: f.text, docDir: docDir,
      canCopy: !!(window.Bridge && window.Bridge.available),
      rel: window.ImgMan ? ImgMan.relPath : null
    }) : { kind: f.path ? 'abs' : 'name', target: f.path || name };

    var insert = function (target) {
      var text = D ? D.linkText(name, target) : '[' + name + '](' + target + ')';
      Editor.insertMarkdown(text);
    };

    if (p.kind === 'rel' || p.kind === 'abs') { insert(p.target); return; }

    if (p.kind === 'name') {
      insert(p.target);
      toast('已插入文件名链接（WebKit 拿不到真实路径，可能需要手工修正）');
      return;
    }

    // copy：文本文件整份写进 assets/，链接才立得住
    var dir = docDir.replace(/\/+$/, '') + '/assets';
    window.Bridge.fsList(dir).then(function (r) {
      var have = {};
      ((r && r.tree) || []).forEach(function (n) { have[n.name] = 1; });
      var uniq = window.ImgMan ? ImgMan.uniqueName(name, function (n) { return !!have[n]; }) : name;
      return window.Bridge.save(dir + '/' + uniq, f.text).then(function () { return uniq; });
    }).then(function (uniq) {
      insert('assets/' + uniq);
      toast('已复制到 assets/ 并插入链接');
    }).catch(function () {
      insert(name);
      toast('复制到 assets/ 失败，只插入了文件名链接');
    });
  }

  /* ------------------------------------------------ 粘贴 / 拖入的图片
   * 与 ⌘⌃I 插入本地图片走**同一套路径解析**：front matter 里的
   * typora-copy-images-to 决定落盘目录，typora-root-url 决定正文里怎么写。
   * 原生侧只负责写盘并回绝对路径，相对引用的换算是这里做的（纯函数 ImgMan）。 */
  function savePastedImage(dataUrl) {
    if (!window.Bridge || !window.Bridge.saveImage) return '';
    var docPath = currentPath || '';
    var ctx = window.ImgMan ? ImgMan.context(docPath, Editor.getText()) : null;
    // 文档还没落盘时不给目录：原生侧落到临时目录，引用就用绝对路径
    var dest = (ctx && docPath) ? ctx.dest : '';
    return window.Bridge.saveImage(dataUrl, docPath, dest).then(function (r) {
      var abs = (r && r.path) || (typeof r === 'string' ? r : '');
      if (!abs) return '';
      // 原生侧回的是绝对路径；已经是相对引用的（老接口/测试桩）就别再换算
      if (abs.charAt(0) !== '/' || !ctx) return abs;
      return ImgMan.hrefOf(abs, ctx);
    });
  }

  function openRelLink(href) {
    if (!window.Bridge || !window.Bridge.available) return;
    var path = window.Workbench ? Workbench.resolveLink(href, currentPath, folderRoot) : href;
    var candidates = [path];
    if (folderRoot && path.indexOf(folderRoot) !== 0) {
      candidates.push(folderRoot.replace(/\/+$/, '') + '/' + href.replace(/^\.\//, '').split('#')[0]);
    }
    var name = String(href).split('#')[0].split('/').pop();
    flatNotes().forEach(function (n) {
      if (n.name === name) candidates.push(n.path);
    });
    (function tryAt(k) {
      if (k >= candidates.length) {
        window.Bridge.confirm('找不到「' + href + '」', '要在当前文件夹里新建这个文件吗？').then(function (ok) {
          if (!ok) return;
          var target = folderRoot ? folderRoot.replace(/\/+$/, '') + '/' + href.split('#')[0] : null;
          if (!target) { toast('先打开一个文件夹'); return; }
          window.Bridge.save(target, '# ' + name.replace(/\.[^.]+$/, '') + '\n').then(function () {
            reloadFolder(true);
            openPath(target);
          }).catch(function (e) { toast('新建失败：' + e.message); });
        });
        return;
      }
      window.Bridge.readText(candidates[k]).then(function (r) {
        if (r && r.content != null) openPath(candidates[k]);
        else tryAt(k + 1);
      }).catch(function () { tryAt(k + 1); });
    })(0);
  }

  /* ------------------------------------------------ wiki 链接 */

  function joinPath(dir, rel) {
    if (!dir) return rel;
    if (rel.charAt(0) === '/') return rel;
    return String(dir).replace(/\/+$/, '') + '/' + rel;
  }

  /* 文件树拍平成笔记清单（wiki 选单用；rel 是相对文件夹根的路径） */
  function noteRecords() {
    var out = [];
    (function walk(nodes, rel) {
      (nodes || []).forEach(function (n) {
        var r = rel ? rel + '/' + n.name : n.name;
        if (n.type === 'dir') walk(n.children, r);
        else if (/\.(md|markdown|mdown|txt)$/i.test(n.name)) {
          out.push({ name: n.name, path: n.path, rel: r });
        }
      });
    })(treeRoot, '');
    return out;
  }

  function noteTitle(rec) {
    return rec.rel.replace(/\.(md|markdown|mdown|txt)$/i, '');
  }

  /* 按名字在已打开的文件夹里找（忽略扩展名与大小写）—— 移动过文件也能找到 */
  function findByTree(target) {
    var t = String(target).replace(/^\.\//, '');
    var want = t.replace(/\.(md|markdown|mdown|txt)$/i, '').toLowerCase();
    var recs = noteRecords();
    var i;
    for (i = 0; i < recs.length; i++) {
      if (noteTitle(recs[i]).toLowerCase() === want) return recs[i];
    }
    for (i = 0; i < recs.length; i++) {
      if (noteTitle(recs[i]).toLowerCase().slice(-want.length - 1) === '/' + want) return recs[i];
    }
    return null;
  }

  function openWiki(target) {
    target = String(target == null ? '' : target).trim();
    if (!target) return;
    if (target.charAt(0) === '#') {
      var anchorEl = Doc.findAnchor($('editor'), target.slice(1));
      if (anchorEl) Doc.scrollTo($('editor-scroll'), anchorEl, { center: true });
      else toast('没找到标题：' + target.slice(1));
      return;
    }
    if (window.Bridge && window.Bridge.available) {
      var dirs = [];
      var cur = Editor.getPath() || currentPath;
      if (cur) dirs.push(dirName(cur));
      if (folderRoot && dirs.indexOf(folderRoot) < 0) dirs.push(folderRoot);

      var names = [target];
      if (!/\.[a-z0-9]+$/i.test(baseName(target))) names.push(target + '.md');

      var cands = [];
      if (target.charAt(0) === '/') cands.push(target);
      dirs.forEach(function (d) {
        names.forEach(function (n) { cands.push(joinPath(d, n)); });
      });

      (function tryAt(k) {
        if (k >= cands.length) {
          var rec = findByTree(target);
          if (rec) { openPath(rec.path); return; }
          toast('找不到笔记：' + target);
          return;
        }
        window.Bridge.readFile(cands[k]).then(function (r) {
          loadInto(r.content, r.path, r.name || baseName(r.path));
        }).catch(function () { tryAt(k + 1); });
      })(0);
      return;
    }
    // 没有原生环境（测试 / 浏览器预览）：只按文件树找
    var rec2 = findByTree(target);
    if (rec2) { openPath(rec2.path); return; }
    toast('找不到笔记：' + target);
  }

  // 最近切走/关掉的文件。⌘⇧T 按栈顶重开（「重开已关闭文件」）
  var closedStack = [];

  function pushClosed(path) {
    if (!path) return;
    var k = closedStack.indexOf(path);
    if (k >= 0) closedStack.splice(k, 1);
    closedStack.push(path);
    if (closedStack.length > 20) closedStack.shift();
  }

  function reopenClosed() {
    if (!closedStack.length) { toast('没有可以重新打开的文件'); return; }
    var p = closedStack.pop();
    window.Bridge.readFile(p).then(function (r) {
      loadInto(r.content, r.path, r.name);
      toast('已重新打开 ' + baseName(r.path));
    }).catch(function () {
      toast('文件已不存在：' + baseName(p));
      if (closedStack.length) reopenClosed();
    });
  }

  /* ------------------------------------------------ 标签页
   * 状态机在 tabs.js（纯函数，Node 里单测）。
   * 这里只做三件事：切页时把现场存回旧标签、把新标签的现场装回去、画这一条。
   * 活动标签的正文活在 Editor 里，只有切走时才 snapshotDoc() 存进 tab.doc。
   */
  var tabsState = { list: [], active: null, seq: 0 };
  var tabSig = '';

  function anyDirty() {
    if (!window.Tabs) return Editor.isDirty();
    for (var i = 0; i < tabsState.list.length; i++) if (tabsState.list[i].dirty) return true;
    return false;
  }

  // harness / 浏览器里可能没有原生 confirm，缺了就当成「同意」
  function confirmAsk(msg, info) {
    if (window.Bridge && window.Bridge.available && window.Bridge.confirm) {
      return window.Bridge.confirm(msg, info);
    }
    return Promise.resolve(true);
  }

  function stashActive() {
    if (!window.Tabs || !Editor.snapshotDoc) return;
    var t = Tabs.activeTab(tabsState);
    if (!t) return;
    var s = Editor.snapshotDoc();
    tabsState = Tabs.patch(tabsState, t.id, {
      doc: s, path: s.path, name: s.name, dirty: s.dirty
    });
  }

  function renderTabs() {
    var bar = $('tabbar'), list = $('tab-list');
    if (!bar || !list || !window.Tabs) return;
    scheduleSession();
    var show = Tabs.count(tabsState) > 1;
    if (bar.hidden === show) bar.hidden = !show;
    document.body.classList.toggle('has-tabs', show);

    var sig = Tabs.order(tabsState).join(',') + '|' + tabsState.active + '|' +
      tabsState.list.map(function (t) { return (t.dirty ? '1' : '0') + t.name; }).join(',');
    if (sig === tabSig) return;
    tabSig = sig;
    if (!show) { list.innerHTML = ''; return; }

    var html = '';
    tabsState.list.forEach(function (t) {
      var on = t.id === tabsState.active;
      html += '<div class="tab' + (on ? ' active' : '') + (t.dirty ? ' dirty' : '') +
        '" data-id="' + t.id + '" role="tab" aria-selected="' + on + '"' +
        ' title="' + esc(t.path || (t.name + '（未保存）')) + '">' +
        '<span class="tab-name">' + esc(t.name) + '</span>' +
        '<span class="tab-dot"></span>' +
        '<button class="tab-x" type="button" title="关闭标签页 (⌘W)" aria-label="关闭 ' + esc(t.name) + '">✕</button>' +
        '</div>';
    });
    list.innerHTML = html;
  }

  function bindTabBar() {
    var list = $('tab-list'), add = $('tab-add');
    if (!list || !add) return;
    list.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tab') : null;
      if (!t) return;
      var id = t.getAttribute('data-id');
      if (e.target.closest('.tab-x')) { closeTab(id); return; }
      switchTab(id);
    });
    // 中键关标签（浏览器习惯）
    list.addEventListener('auxclick', function (e) {
      if (e.button !== 1) return;
      var t = e.target.closest ? e.target.closest('.tab') : null;
      if (!t) return;
      e.preventDefault();
      closeTab(t.getAttribute('data-id'));
    });
    add.addEventListener('click', function () { newTab(); });
  }

  /* ------------------------------------------------ 会话还原（重启后整排标签还在）
   * 只记 path：正文一律以磁盘为准 —— 标签里没保存的内容不该跨重启活着，
   * 那种情况归草稿（opentypora.draft）那条路。
   */
  var SESSION_KEY = 'opentypora.session';
  var sessionTimer = null;
  var sessionLast = '';
  /* 首屏 renderTabs 也会排一次写盘。原生桥 ready() 要是慢过 600ms，
   * 那一次写盘会赶在「读会话」之前把会话清成空 —— 所以读完之前不许写。 */
  var sessionArmed = false;

  function saveSessionNow() {
    if (!window.Tabs || !sessionArmed) return;
    var txt;
    try { txt = JSON.stringify(Tabs.sessionOf(tabsState)); } catch (e) { return; }
    if (txt === sessionLast) return;
    sessionLast = txt;
    try { localStorage.setItem(SESSION_KEY, txt); } catch (e) {}
  }

  /* 每次 refresh 都会走到 renderTabs（打字也算），所以这里只排一个防抖，
   * 真正落盘时再比一次串，内容没变就不写 */
  function scheduleSession() {
    if (!window.Tabs) return;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(function () {
      sessionTimer = null;
      saveSessionNow();
    }, 600);
  }

  function clearSession() {
    sessionLast = '';
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* 首篇文档就位之后才允许写会话（见 sessionArmed 的注释） */
  function armSession() {
    if (sessionArmed) return;
    sessionArmed = true;
    saveSessionNow();
  }

  /* 把上次的整排标签装回来。打不开的（文件被删/挪走）跳过，一个都打不开就当没有会话。 */
  function restoreSession() {
    if (!window.Tabs || !window.Bridge || !window.Bridge.available) return Promise.resolve(false);
    var sess = null;
    try { sess = Tabs.parseSession(localStorage.getItem(SESSION_KEY)); } catch (e) { sess = null; }
    if (!sess) return Promise.resolve(false);
    return Promise.all(sess.paths.map(function (p) {
      return window.Bridge.readFile(p).then(function (r) {
        var path = (r && r.path) || p;
        return { path: path, name: (r && r.name) || baseName(path), content: (r && r.content) || '' };
      }).catch(function () { return null; });
    })).then(function (arr) {
      var files = arr.filter(Boolean);
      if (!files.length) { clearSession(); return false; }
      var st = Tabs.make(), activeId = null;
      files.forEach(function (f) {
        var res = Tabs.add(st, Tabs.create(f.name, f.path, {
          content: f.content, path: f.path, name: f.name, dirty: false,
          undo: [], redo: [], scroll: 0, editBlock: -1, editOff: 0
        }));
        if (res.full || !res.tab) return;
        st = res.state;
        if (Tabs.normPath(f.path) === Tabs.normPath(sess.active)) activeId = res.tab.id;
      });
      if (activeId) st = Tabs.activate(st, activeId);
      tabsState = st;
      applyTab(Tabs.activeTab(tabsState));
      renderTabs();
      var lost = sess.paths.length - files.length;
      if (lost > 0) toast('有 ' + lost + ' 个文件打不开了，已跳过');
      return true;
    }).catch(function () { return false; });
  }

  // 关窗口/退出时把最后那次变更同步落盘（防抖可能还没到点）
  window.addEventListener('beforeunload', saveSessionNow);

  /* 把某个标签的现场装进编辑器（路径、<base>、大纲、滚动位置一起跟上） */
  function applyTab(t) {
    if (!t) return;
    if (t.doc && Editor.restoreDoc) {
      Editor.restoreDoc(t.doc);
    } else {
      Editor.load('', null, t.name);
    }
    currentPath = Editor.getPath();
    setBase(currentPath, Editor.getValue());
    if (window.Bridge && window.Bridge.setFile) window.Bridge.setFile(currentPath).catch(function () {});
    markTreeActive();
    refresh(Editor.getState());
    if (window.Split) Split.refresh();
  }

  function switchTab(id) {
    if (!window.Tabs || !id || id === tabsState.active) return false;
    var target = Tabs.find(tabsState, id);
    if (!target) return false;
    Editor.flushAutosave();
    stashActive();
    tabsState = Tabs.activate(tabsState, id);
    applyTab(Tabs.find(tabsState, id));
    renderTabs();
    return true;
  }

  function cycleTab(dir) {
    if (!window.Tabs || Tabs.count(tabsState) < 2) return false;
    var next = Tabs.cycle(tabsState, dir);
    if (next.active === tabsState.active) return false;
    return switchTab(next.active);
  }

  /* 新开一个标签并切过去；同一个 path 已开着就直接切过去 */
  function openTab(content, path, name, opt) {
    opt = opt || {};
    if (!window.Tabs) {                       // 兜底：没有状态机就退回单文档
      Editor.load(content, path, name);
      currentPath = path || null;
      refresh(Editor.getState());
      return null;
    }
    if (path) {
      var dup = Tabs.findByPath(tabsState, path);
      if (dup) {
        switchTab(dup.id);
        if (opt.start != null && opt.start >= 0) revealSoon(opt.start, opt.len);
        return dup;
      }
    }
    Editor.flushAutosave();
    stashActive();
    var nm = name || (path ? baseName(path) : Tabs.untitled(tabsState));
    var res = Tabs.add(tabsState, Tabs.create(nm, path));
    if (res.full) { toast('标签页最多 ' + Tabs.MAX + ' 个，先关几个吧'); return null; }
    tabsState = res.state;

    Editor.load(content == null ? '' : content, path || null, nm);
    currentPath = path || null;
    setBase(currentPath, content);
    if (window.Bridge && window.Bridge.setFile && currentPath) {
      window.Bridge.setFile(currentPath).catch(function () {});
    }
    markTreeActive();
    refresh(Editor.getState());
    var sc = $('editor-scroll');
    if (sc) {
      // 打开新文档要「啪」地回到文首，不要顺滑滚过去
      var prevB = sc.style.scrollBehavior;
      sc.style.scrollBehavior = 'auto';
      sc.scrollTop = 0;
      sc.style.scrollBehavior = prevB || '';
    }
    if (window.Split) Split.refresh();
    if (path && window.Workbench) Workbench.addRecent(path, nm);
    if (window.Workbench) Workbench.clearDraft();
    if (opt.start != null && opt.start >= 0) revealSoon(opt.start, opt.len);
    renderTabs();
    return res.tab;
  }

  function revealSoon(start, len) {
    setTimeout(function () {
      try { Editor.revealOffset(start, len || 0); } catch (e) {}
    }, 40);
  }

  function newTab() {
    var cur = window.Tabs ? Tabs.activeTab(tabsState) : null;
    // 已经站在一张空白未命名页上就别再叠一张
    if (cur && !cur.path && !Editor.isDirty() && !String(Editor.getValue()).trim()) {
      toast('当前就是空白标签页');
      return cur;
    }
    return openTab('', null, Tabs.untitled(tabsState));
  }

  function closeTab(id) {
    if (!window.Tabs) return Promise.resolve(false);
    var t = Tabs.find(tabsState, id);
    if (!t) return Promise.resolve(false);
    var active = id === tabsState.active;
    if (active) stashActive();
    var cur = Tabs.find(tabsState, id) || t;
    var dirty = active ? Editor.isDirty() : !!cur.dirty;
    var ask = dirty
      ? confirmAsk('「' + (cur.name || '未命名') + '」有未保存的修改',
          '关闭标签页会丢弃这些修改。').catch(function () { return true; })
      : Promise.resolve(true);

    return ask.then(function (ok) {
      if (!ok) return false;
      if (active) Editor.flushAutosave();

      // 最后一个标签页不关窗口：换成一张空白文档（关窗口该由 ⌘⇧W 负责）
      if (Tabs.count(tabsState) === 1) {
        if (cur.path) pushClosed(cur.path);
        tabsState = Tabs.patch(tabsState, id, { path: null, name: '未命名.md', dirty: false, doc: null });
        Editor.load('', null, '未命名.md');
        currentPath = null;
        setBase(null, '');
        markTreeActive();
        refresh(Editor.getState());
        renderTabs();
        return true;
      }

      var r = Tabs.close(tabsState, id);
      tabsState = r.state;
      if (cur.path) pushClosed(cur.path);
      renderTabs();
      if (r.closedActive) applyTab(Tabs.find(tabsState, r.nextId));
      return true;
    });
  }

  function loadInto(content, path, name) {
    return openTab(content, path, name);
  }

  // 让文档里的相对图片路径相对于文件所在目录解析；
  // front matter 里有 `typora-root-url` 时，改按该目录解析
  function setBase(path, content) {
    var base = document.querySelector('base');
    if (!base) {
      base = document.createElement('base');
      document.head.insertBefore(base, document.head.firstChild);
    }
    var dir = path ? dirName(path) : '';
    if (dir && window.ImgMan) {
      var fo = ImgMan.parseFront(content || '');
      var root = fo.rootUrl ? ImgMan.rootDir(path, fo.rootUrl) : '';
      if (root) dir = root;
    }
    base.setAttribute('href', dir ? 'file://' + dir + '/' : '');
  }

  function doOpenFile() {
    return window.Bridge.openFile().then(function (r) {
      if (!r) return;
      openTab(r.content, r.path, r.name || baseName(r.path));
      toast('已打开 ' + (r.name || baseName(r.path)));
    }).catch(function (e) { toast('打开失败：' + e.message); });
  }

  function applyTree(r) {
    if (!r || !r.root) return false;
    folderRoot = r.root;
    treeRoot = r.tree || [];
    $('folder-name').textContent = baseName(folderRoot);
    $('folder-name').title = folderRoot;
    renderTree();
    if (window.Workbench) { Workbench.noteSig(treeRoot); Workbench.renderArticles(); }
    switchPanel('files');
    return true;
  }

  function doOpenFolder() {
    return window.Bridge.openFolder().then(applyTree)
      .catch(function (e) { toast('打开文件夹失败：' + e.message); });
  }

  // CLI / 拖拽进来的目录：不开面板，直接按路径展开
  function openFolderPath(p) {
    if (!window.Bridge || !window.Bridge.available || !window.Bridge.openFolderAt) {
      toast('桌面版应用才支持打开文件夹');
      return Promise.resolve();
    }
    return window.Bridge.openFolderAt(p).then(function (r) {
      if (applyTree(r)) toast('已打开文件夹 ' + baseName(r.root));
    }).catch(function (e) { toast('打开文件夹失败：' + e.message); });
  }

  function doSave() {
    var path = Editor.getPath();
    var content = Editor.getValue();
    if (!path) return doSaveAs();
    return window.Bridge.save(path, content).then(function () {
      Editor.markSaved(path);
      refresh(Editor.getState());
      toast('已保存');
    }).catch(function (e) { toast('保存失败：' + e.message); });
  }

  function doSaveAs() {
    var content = Editor.getValue();
    var name = Editor.getName() || '未命名.md';
    return window.Bridge.saveAs(name, content).then(function (r) {
      if (!r || !r.path) return;
      // 另存为是「这个标签换了一个落点」，不是新开一个标签
      var at = window.Tabs ? Tabs.activeTab(tabsState) : null;
      Editor.markSaved(r.path, baseName(r.path));
      currentPath = r.path;
      setBase(r.path, content);
      if (window.Bridge && window.Bridge.setFile) window.Bridge.setFile(r.path).catch(function () {});
      if (at) {
        tabsState = Tabs.patch(tabsState, at.id, { path: r.path, name: baseName(r.path), dirty: false, doc: null });
      }
      markTreeActive();
      refresh(Editor.getState());
      renderTabs();
      if (window.Workbench) Workbench.addRecent(r.path, baseName(r.path));
      toast('已保存到 ' + r.path);
    }).catch(function (e) { toast('保存失败：' + e.message); });
  }

  function doNew() {
    return newTab();
  }

  /* ------------------------------------------------ 导出 */
  function docStem() {
    return (Editor.getName() || '未命名.md').replace(/\.(md|markdown|txt)$/i, '') || '未命名';
  }

  // 带样式 / 无样式、图片是否内嵌、正文是否限宽，都是导出选项决定的；
  // 默认值记在偏好里，下次导出直接用上一次的选择。
  function htmlOptsFromPrefs() {
    var raw = {
      styles: pref.htmlStyles !== false,
      embed: !!pref.htmlEmbed,
      width: pref.htmlWidth !== false,
      head: pref.htmlHead || '',
      tail: pref.htmlTail || '',
      // 没选过就跟当前主题走；选了就记住那次的选择
      theme: pref.htmlTheme || curTheme(),
      base: pref.base || 'github',
      // 导出的单页也带上用户调过的版式，做到「所见即导出」
      font: pref.font || '',
      leading: pref.leading,
      bg: pref.bg || ''
    };
    return window.Export ? Export.htmlOptions(raw) : raw;
  }

  /* opts: 覆盖项；传布尔值兼容老调用（true = 无样式） */
  function exportHTML(opts) {
    if (typeof opts === 'boolean') opts = { styles: !opts };
    var o = htmlOptsFromPrefs();
    if (opts) for (var k in opts) if (opts[k] != null) o[k] = opts[k];
    // 对话框给的是原始选择（'night' / 'user:x.css'），这里再归一化成 id + 文件名。
    // 不整个重跑 htmlOptions：那会按 o.theme 反推，把已经拆好的 themeFile 丢掉。
    if (opts && opts.theme != null) {
      var pick = window.Export ? Export.themePick(opts.theme, pref.base || 'github')
        : { id: 'github', file: '' };
      o.theme = pick.id; o.themeFile = pick.file;
    }
    pref.htmlStyles = o.styles; pref.htmlEmbed = o.embed; pref.htmlWidth = o.width;
    pref.htmlHead = o.head || ''; pref.htmlTail = o.tail || '';
    pref.htmlTheme = o.themeFile ? 'user:' + o.themeFile : o.theme;
    savePrefs();
    if (!window.Bridge || !window.Bridge.available) {
      toast('桌面版应用才支持 HTML 导出');
      return Promise.resolve();
    }
    var body = Editor.exportHTML();
    var name = docStem() + '.html';
    // YAML front matter 覆盖：title 优先于文件名，author/keywords/subtitle/date 进 <head>
    var y = window.Export ? Export.readYaml(Editor.getText()) : null;
    var html = window.Export
      ? Export.htmlDoc(body, {
        width: o.width,
        theme: o.theme,
        title: (y && y.title) || Editor.getName(),
        author: y && y.author, keywords: y && y.keywords,
        description: y && y.subtitle, date: y && y.date,
        head: o.head, tail: o.tail
      })
      : '<!DOCTYPE html>\n<html data-theme="' + esc(o.theme || 'github') + '" class="opentypora-export">' +
        '<head><meta charset="utf-8">' +
        (o.head ? '\n' + o.head : '') +
        '\n<title>' + esc(Editor.getName()) +
        '</title></head>\n<body class="opentypora-export">\n<div class="editor">' + body + '</div>' +
        (o.tail ? '\n' + o.tail : '') + '\n</body></html>';

    var chain = Promise.resolve(html);
    if (o.embed && window.Export) {
      var refs = Export.imageRefs(html);
      chain = Promise.all(refs.map(function (src) {
        return window.Bridge.readBinary(src).then(function (r) {
          return r && r.base64 ? { src: src, uri: Export.dataUri(src, r.base64) } : null;
        }).catch(function () { return null; });
      })).then(function (list) {
        var map = {};
        list.forEach(function (x) { if (x) map[x.src] = x.uri; });
        return Export.applyImageMap(html, map);
      });
    }

    // 自定义主题：读出 CSS 交给原生，排在内置样式之后（顺序决定谁压住谁）。
    // 读不到就当没选，退回内置基底，不要因为一个主题文件让整个导出失败。
    var themeCss = Promise.resolve('');
    if (o.styles && o.themeFile && window.Bridge.readTheme) {
      themeCss = window.Bridge.readTheme(o.themeFile).then(function (r) {
        return tweakUserCss((r && r.css) || '');
      }).catch(function () { return ''; });
    }

    return Promise.all([chain, themeCss]).then(function (res) {
      return window.Bridge.exportHTML(name, res[0], o.styles, res[1]);
    }).then(function (r) {
      if (r && r.path) toast('已导出 ' + baseName(r.path));
      else toast('已取消');
    }).catch(function (e) { toast('导出失败：' + e.message); });
  }

  /* 导出主题下拉：内置 + 自定义（和编辑器主题同一份数据源） */
  function themeOptionsHtml() {
    var html = '';
    BUILTIN_THEMES.forEach(function (t) {
      html += '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>';
    });
    if (userThemes.length) {
      html += '<optgroup label="自定义">';
      userThemes.forEach(function (t) {
        html += '<option value="user:' + esc(t.id) + '">' + esc(t.name) + '</option>';
      });
      html += '</optgroup>';
    }
    return html;
  }

  /* HTML 导出选项对话框（选完就导，同时记进偏好） */
  function openHtmlOpts() {
    closeHtmlOpts();
    var o = htmlOptsFromPrefs();
    var mask = document.createElement('div');
    mask.className = 'tbl-dlg-mask';
    mask.id = 'html-dlg';
    mask.innerHTML = '<div class="tbl-dlg wide" role="dialog" aria-label="HTML 导出选项">' +
      '<div class="tbl-dlg-title">导出 HTML</div>' +
      '<label>包含样式 <input id="html-styles" type="checkbox" class="tbl-dlg-check"></label>' +
      '<label>导出主题 <select id="html-theme" class="tbl-dlg-sel">' + themeOptionsHtml() +
      '</select></label>' +
      '<label>图片内嵌为 data URI <input id="html-embed" type="checkbox" class="tbl-dlg-check"></label>' +
      '<label>正文限宽 830px <input id="html-width" type="checkbox" class="tbl-dlg-check"></label>' +
      '<div class="html-frag-label">自定义 &lt;head&gt; 内容（原样插入 &lt;/head&gt; 之前）</div>' +
      '<textarea id="html-head" class="html-frag" rows="3" spellcheck="false" ' +
      'placeholder="&lt;link rel=&quot;stylesheet&quot; href=&quot;theme.css&quot;&gt;"></textarea>' +
      '<div class="html-frag-label">自定义 &lt;body&gt; 末尾（原样插入 &lt;/body&gt; 之前）</div>' +
      '<textarea id="html-tail" class="html-frag" rows="3" spellcheck="false" ' +
      'placeholder="&lt;script src=&quot;app.js&quot;&gt;&lt;/script&gt;"></textarea>' +
      '<div class="tbl-dlg-actions"><button id="html-cancel" class="tbl-dlg-btn">取消</button>' +
      '<button id="html-go" class="tbl-dlg-btn primary">导出…</button></div></div>';
    document.body.appendChild(mask);
    var stylesBox = mask.querySelector('#html-styles');
    var themeSel = mask.querySelector('#html-theme');
    stylesBox.checked = o.styles;
    mask.querySelector('#html-embed').checked = o.embed;
    mask.querySelector('#html-width').checked = o.width;
    mask.querySelector('#html-head').value = o.head || '';
    mask.querySelector('#html-tail').value = o.tail || '';
    var wanted = o.themeFile ? 'user:' + o.themeFile : o.theme;
    themeSel.value = wanted;
    // 偏心里记的主题文件可能已经被删了，别让下拉停在一个不存在的项上
    if (themeSel.value !== wanted) themeSel.value = pref.base || 'github';
    // 不导出样式的话主题没有意义，直接把下拉灰掉（比导出个无效选项清楚）
    function syncThemeEnabled() { themeSel.disabled = !stylesBox.checked; }
    stylesBox.addEventListener('change', syncThemeEnabled);
    syncThemeEnabled();

    function close() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); e.stopPropagation(); }
      // 两个片段框里 Enter 是换行，不是「导出」
      else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
        e.preventDefault(); go();
      }
      else if (e.key === 'Enter') { e.stopPropagation(); }
    }
    function go() {
      var picked = {
        styles: stylesBox.checked,
        theme: themeSel.value,
        embed: mask.querySelector('#html-embed').checked,
        width: mask.querySelector('#html-width').checked,
        head: mask.querySelector('#html-head').value,
        tail: mask.querySelector('#html-tail').value
      };
      close();
      exportHTML(picked);
    }
    mask.querySelector('#html-cancel').addEventListener('click', close);
    mask.querySelector('#html-go').addEventListener('click', go);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey, true);
    return mask;
  }

  function closeHtmlOpts() {
    var m = document.getElementById('html-dlg');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function inlineCSS() {
    var links = document.querySelectorAll('link[rel=stylesheet]');
    return ''; // 由原生侧注入样式文件，避免重复读取
  }

  /* PDF 选项：偏好里存上次用过的纸张/边距/页眉页脚，导出时直接复用 */
  function pdfOptsFromPrefs() {
    var raw = {
      paper: pref.pdfPaper, margin: pref.pdfMargin,
      headerFooter: pref.pdfHF, h1page: pref.pdfH1,
      bookmarks: pref.pdfBook !== false
    };
    return window.Export ? Export.pdfOptions(raw) : raw;
  }

  function exportPDF(opts) {
    if (!window.Bridge || !window.Bridge.available) { toast('桌面版应用才支持 PDF 导出'); return; }
    var o = window.Export ? Export.pdfOptions(opts || pdfOptsFromPrefs()) : (opts || {});
    // YAML 的 papersize 覆盖偏好里的纸张（文档元信息比全局偏好更具体）
    if (window.Export) {
      var yp = Export.readYaml(Editor.getText());
      if (yp.paper && Export.papers[yp.paper]) o.paper = yp.paper;
    }
    pref.pdfPaper = o.paper; pref.pdfMargin = o.margin;
    pref.pdfHF = o.headerFooter; pref.pdfH1 = o.h1page;
    pref.pdfBook = o.bookmarks;
    savePrefs();
    // 书签：把标题层级交给原生，PDF 生成后用 PDFKit 按标题找到页再加 outline
    o.outline = (o.bookmarks && window.Export && Export.pdfOutline)
      ? Export.pdfOutline(Editor.getText()) : [];
    // 分栏/源码模式下 #editor 可能不是最新，打印前先按当前内容重排一遍
    if (Editor.isSplitMode()) { Editor.syncSplitModel(); Editor.render(); }
    document.body.classList.add('printing');
    // H1 分页在原生侧是异步注入的，可能赶不上 printOperation，
    // 这里先在主线程把类挂上，保证样式已经生效。
    document.body.classList.toggle('pdf-h1page', !!o.h1page);
    window.Bridge.exportPDF(o).then(function (r) {
      document.body.classList.remove('printing');
      document.body.classList.remove('pdf-h1page');
      if (r && r.path) toast('已导出 ' + baseName(r.path));
      else toast('已取消');
    }).catch(function (e) {
      document.body.classList.remove('printing');
      document.body.classList.remove('pdf-h1page');
      toast('导出失败：' + e.message);
    });
  }

  /* PDF 选项对话框 */
  function openPdfOpts() {
    closePdfOpts();
    var o = pdfOptsFromPrefs();
    var papers = (window.Export && Export.papers) || { a4: { label: 'A4' } };
    var optHtml = '';
    for (var k in papers) {
      optHtml += '<option value="' + esc(k) + '">' + esc(papers[k].label) + '</option>';
    }
    var mask = document.createElement('div');
    mask.className = 'tbl-dlg-mask';
    mask.id = 'pdf-dlg';
    mask.innerHTML = '<div class="tbl-dlg" role="dialog" aria-label="PDF 导出选项">' +
      '<div class="tbl-dlg-title">导出 PDF</div>' +
      '<label>纸张 <select id="pdf-paper" class="tbl-dlg-sel">' + optHtml + '</select></label>' +
      '<label>页边距 <input id="pdf-margin" type="number" min="0" max="120" step="1" value="' + o.margin + '"></label>' +
      '<label>页眉页脚 <input id="pdf-hf" type="checkbox" class="tbl-dlg-check"></label>' +
      '<label>H1 另起页 <input id="pdf-h1" type="checkbox" class="tbl-dlg-check"></label>' +
      '<label>书签（用标题生成） <input id="pdf-book" type="checkbox" class="tbl-dlg-check"></label>' +
      '<div class="tbl-dlg-actions"><button id="pdf-cancel" class="tbl-dlg-btn">取消</button>' +
      '<button id="pdf-go" class="tbl-dlg-btn primary">导出…</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector('#pdf-paper').value = o.paper;
    mask.querySelector('#pdf-hf').checked = o.headerFooter;
    mask.querySelector('#pdf-h1').checked = o.h1page;
    mask.querySelector('#pdf-book').checked = o.bookmarks !== false;

    function close() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); e.stopPropagation(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
    }
    function go() {
      var picked = {
        paper: mask.querySelector('#pdf-paper').value,
        margin: +mask.querySelector('#pdf-margin').value,
        headerFooter: mask.querySelector('#pdf-hf').checked,
        h1page: mask.querySelector('#pdf-h1').checked,
        bookmarks: mask.querySelector('#pdf-book').checked
      };
      close();
      exportPDF(picked);
    }
    mask.querySelector('#pdf-cancel').addEventListener('click', close);
    mask.querySelector('#pdf-go').addEventListener('click', go);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey, true);
    setTimeout(function () {
      var m = mask.querySelector('#pdf-margin');
      if (m) { m.focus(); m.select(); }
    }, 0);
    return mask;
  }

  function closePdfOpts() {
    var m = document.getElementById('pdf-dlg');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  /* 图片导出：整页快照，原生侧临时把 WebView 撑到全文高度 */
  function exportImage(fmt) {
    if (!window.Bridge || !window.Bridge.available ||
        typeof window.Bridge.exportImage !== 'function') {
      toast('桌面版应用才支持图片导出');
      return;
    }
    var f = window.Export ? Export.imageFormat(fmt) : (fmt === 'jpeg' ? 'jpeg' : 'png');
    if (Editor.isSplitMode()) { Editor.syncSplitModel(); Editor.render(); }
    window.Bridge.exportImage(f).then(function (r) {
      if (r && r.path) toast('已导出 ' + baseName(r.path));
      else toast('已取消');
    }).catch(function (e) { toast('导出失败：' + e.message); });
  }

  /* ------------------------------------------------ 内置导出（Word / ePub / LaTeX）
   * 这三个格式不调 pandoc：docx 与 epub 都是 zip 包，包内直接生成；
   * 好处是零外部依赖、离线可用、包体只涨几十 KB。
   */
  function bytesToB64(bytes) {
    var chunk = 0x8000, out = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function dataUrlBytes(url) {
    var m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url);
    if (!m) return null;
    if (m[2]) return { bytes: b64ToBytes(m[3]), mime: m[1] || '' };
    var raw = m[3];
    try { raw = decodeURIComponent(raw); } catch (e) {}
    return { bytes: new TextEncoder().encode(raw), mime: m[1] || '' };
  }

  // 导出引擎回调：把图片读成字节。相对路径由原生侧按当前文档目录解析。
  function resolveImage(src) {
    if (!src) return Promise.resolve(null);
    if (/^data:/i.test(src)) return Promise.resolve(dataUrlBytes(src));
    if (/^https?:/i.test(src)) return Promise.resolve(null);      // 不联网抓图
    var p = src;
    if (/^file:/i.test(src)) p = src.replace(/^file:\/\//, '');
    try { p = decodeURIComponent(p); } catch (e) {}
    // 相对路径按「文档目录 / typora-root-url」补成绝对路径，导出时才找得到文件
    if (window.ImgMan && !/^\//.test(p) && currentPath) {
      try { p = ImgMan.absOf(p, ImgMan.context(currentPath, Editor.getText())); } catch (e2) {}
    }
    if (!window.Bridge || !window.Bridge.readBinary) return Promise.resolve(null);
    return window.Bridge.readBinary(p).then(function (r) {
      if (!r || !r.base64) return null;
      return { bytes: b64ToBytes(r.base64), mime: '' };
    }).catch(function () { return null; });
  }

  function exportDoc(kind) {
    var fmt = window.Export && window.Export.formats[kind];
    if (!fmt) { toast('导出模块未加载'); return; }
    var name = Editor.getName().replace(/\.(md|markdown|txt)$/i, '');
    var src = Editor.getText();
    if (!src || !src.trim()) { toast('文档是空的'); return; }

    toast('正在生成 ' + fmt.label + '…');
    window.Export.build(kind, src, {
      title: name, filename: name, resolveImage: resolveImage
    }).then(function (r) {
      if (r && r.warnings && r.warnings.length) console.warn(r.warnings.join('\n'));
      var b64 = (r.text != null)
        ? bytesToB64(new TextEncoder().encode(r.text))
        : bytesToB64(r.bytes);
      return window.Bridge.exportFile(name + '.' + fmt.ext, fmt.ext, b64);
    }).then(function (r) {
      if (r && r.path) toast('已导出 ' + baseName(r.path));
      else toast('已取消');
    }).catch(function (e) {
      console.error(e);
      toast('导出失败：' + (e && e.message ? e.message : e));
    });
  }

  /* ------------------------------------------------ 自定义导出命令
   * 内置导出器覆盖不到的格式（icml / docbook / asciidoc…）交给外部命令。
   * 文档先存成临时 .md，占位符展开后由原生侧 /bin/sh -c 执行。
   */
  function docDir() {
    var p = Editor.getPath ? Editor.getPath() : '';
    return p ? p.replace(/[\\/][^\\/]*$/, '') : '';
  }

  function runCustomExport(cid) {
    if (!window.Bridge || !window.Bridge.available) { toast('桌面版应用才支持自定义导出命令'); return; }
    if (!window.Xcmd) { toast('导出命令模块未加载'); return; }
    var list = Xcmd.norm(pref.exportCmds);
    var cmd = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === cid) cmd = list[i];
    if (!cmd) { toast('找不到这条导出命令，可能在偏好里被删掉了'); return; }

    var chk = Xcmd.check(cmd);
    if (!chk.ok) { toast(chk.error); return; }

    var src = Editor.getText();
    if (!src || !src.trim()) { toast('文档是空的'); return; }

    toast('正在导出到 ' + cmd.ext + '…');
    window.Bridge.runExport({
      cmd: cmd.cmd, ext: cmd.ext, name: docStem(),
      dir: docDir(), content: src
    }).then(function (r) {
      if (!r || !r.path) { toast('已取消'); return; }
      toast('已导出 ' + baseName(r.path), {
        label: '在 Finder 中显示',
        fn: function () { if (window.Bridge) Bridge.reveal(r.path); }
      });
    }).catch(function (e) {
      // 「程序没装」在原生侧已经翻成提示，这里只兜底补一句
      toast('导出失败：' + (e && e.message ? e.message : e));
    });
  }

  /* 偏好面板：命令列表编辑 */
  function renderXcmds() {
    var box = $('xcmd-list');
    if (!box) return;
    var list = window.Xcmd ? Xcmd.norm(pref.exportCmds) : [];
    if (!list.length) {
      box.innerHTML = '<div class="xcmd-empty">还没有命令。点「添加命令」自己写一条，' +
        '或「填入 pandoc 预设」用现成的（需要 brew install pandoc）。</div>';
      return;
    }
    box.innerHTML = list.map(function (c, i) {
      return '<div class="xcmd-row" data-idx="' + i + '">' +
        '<input class="xcmd-name" data-f="name" value="' + esc(c.name) + '" placeholder="名称">' +
        '<input class="xcmd-ext" data-f="ext" value="' + esc(c.ext) + '" placeholder="ext">' +
        '<input class="xcmd-cmd" data-f="cmd" value="' + esc(c.cmd) + '" placeholder="pandoc … {src} -o {out}">' +
        '<button class="xcmd-del" title="删除">✕</button></div>';
    }).join('');
  }

  function bindXcmds() {
    var box = $('xcmd-list');
    if (!box) return;
    box.addEventListener('input', function (e) {
      var row = e.target.closest ? e.target.closest('.xcmd-row') : null;
      if (!row) return;
      var i = +row.getAttribute('data-idx');
      var f = e.target.getAttribute('data-f');
      var list = Xcmd.norm(pref.exportCmds);
      if (list[i]) {
        list[i][f] = e.target.value;
        pref.exportCmds = list;
        savePrefs();
      }
    });
    box.addEventListener('click', function (e) {
      if (!e.target.classList || !e.target.classList.contains('xcmd-del')) return;
      var row = e.target.closest('.xcmd-row');
      var i = +row.getAttribute('data-idx');
      var list = Xcmd.norm(pref.exportCmds);
      list.splice(i, 1);
      pref.exportCmds = list;
      savePrefs();
      renderXcmds();
    });
    var add = $('xcmd-add');
    if (add) add.addEventListener('click', function () {
      var list = Xcmd.norm(pref.exportCmds);
      if (list.length >= Xcmd.MAX) { toast('最多 ' + Xcmd.MAX + ' 条命令'); return; }
      list.push({ name: '', cmd: 'pandoc -f markdown "{src}" -o "{out}"', ext: 'docx' });
      pref.exportCmds = list;
      savePrefs();
      renderXcmds();
      var rows = $('xcmd-list').querySelectorAll('.xcmd-row');
      var last = rows[rows.length - 1];
      if (last) last.querySelector('.xcmd-name').focus();
    });
    var pd = $('xcmd-pandoc');
    if (pd) pd.addEventListener('click', function () {
      var list = Xcmd.norm(pref.exportCmds);
      var added = 0;
      Xcmd.DEFAULTS.forEach(function (d) {
        if (list.length >= Xcmd.MAX) return;
        if (list.some(function (c) { return c.cmd === d.cmd; })) return;
        list.push({ name: d.name, cmd: d.cmd, ext: d.ext });
        added++;
      });
      pref.exportCmds = list;
      savePrefs();
      renderXcmds();
      toast(added ? '已添加 ' + added + ' 条 pandoc 预设' : '预设都在了');
    });
  }

  /* 导出菜单（状态栏那颗「导出」按钮，向上弹） */
  var xpop = null;

  function closeExportMenu() {
    if (xpop) { xpop.parentNode && xpop.parentNode.removeChild(xpop); xpop = null; }
    document.removeEventListener('mousedown', onXpopOutside, true);
    document.removeEventListener('keydown', onXpopKey, true);
  }

  function onXpopOutside(e) {
    if (xpop && !xpop.contains(e.target) && e.target.id !== 'tb-export') closeExportMenu();
  }

  function onXpopKey(e) {
    if (e.key === 'Escape') { closeExportMenu(); e.stopPropagation(); }
  }

  function openExportMenu() {
    if (xpop) { closeExportMenu(); return; }
    var btn = $('tb-export');
    var rect = btn.getBoundingClientRect();
    // 每组之间画一条分隔线；第三列是右侧的快捷键提示
    var groups = [
      [['html', 'HTML', '单文件网页 · ⌘⇧E'],
       ['html-plain', 'HTML（无样式）', '只导结构，不带 CSS'],
       ['html-opts', 'HTML 选项…', '样式 · 图片 · 限宽 · head/body 片段']],
      [['pdf', 'PDF', '⌘P 打印当前设置'],
       ['pdf-opts', 'PDF 选项…', '纸张 · 边距 · 页眉页脚']],
      [['png', '图片（PNG）', '整页长图'],
       ['jpeg', '图片（JPEG）', '体积更小']],
      [['docx', 'Word（.docx）', '表格 · 脚注 · 图片'],
       ['odt', 'OpenDocument（.odt）', 'LibreOffice · WPS'],
       ['epub', 'ePub 电子书', '带目录与脚注'],
       ['tex', 'LaTeX（.tex）', 'XeLaTeX 编译']],
      [['rtf', 'RTF 富文本', 'Word 全能打开'],
       ['rst', 'reStructuredText', 'Sphinx / docutils'],
       ['mediawiki', 'MediaWiki', '维基语法'],
       ['textile', 'Textile', 'RedCloth · 论坛'],
       ['opml', 'OPML 大纲', '导入思维导图'],
       ['revealjs', 'RevealJS 幻灯片', '单文件 HTML 放映']]
    ];
    var el = document.createElement('div');
    el.className = 'xpop';
    var rows = '';
    // 自定义导出命令接在最后一组，没有配置就不显示这一组
    var cmds = window.Xcmd ? Xcmd.norm(pref.exportCmds) : [];
    if (cmds.length) {
      groups.push(cmds.map(function (c) {
        return ['cmd:' + c.id, c.name, Xcmd.summary(c.cmd)];
      }));
    }
    for (var g = 0; g < groups.length; g++) {
      if (g) rows += '<div class="xpop-sep"></div>';
      for (var i = 0; i < groups[g].length; i++) {
        var it = groups[g][i];
        rows += '<button class="xpop-item" data-kind="' + esc(it[0]) + '">' +
          '<span class="xpop-t">' + esc(it[1]) + '</span>' +
          '<span class="xpop-d">' + esc(it[2]) + '</span></button>';
      }
    }
    el.innerHTML = rows;
    document.body.appendChild(el);

    var w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.right - w)) + 'px';
    el.style.top = Math.max(8, rect.top - h - 8) + 'px';
    xpop = el;

    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.xpop-item') : null;
      if (!b) return;
      var k = b.getAttribute('data-kind');
      closeExportMenu();
      if (k === 'html') exportHTML({});
      else if (k === 'html-plain') exportHTML({ styles: false });
      else if (k === 'html-opts') openHtmlOpts();
      else if (k === 'pdf') exportPDF();
      else if (k === 'pdf-opts') openPdfOpts();
      else if (k === 'png') exportImage('png');
      else if (k === 'jpeg') exportImage('jpeg');
      else if (k.indexOf('cmd:') === 0) runCustomExport(k.slice(4));
      else exportDoc(k);
    });

    setTimeout(function () {
      document.addEventListener('mousedown', onXpopOutside, true);
      document.addEventListener('keydown', onXpopKey, true);
    }, 0);
  }

  /* ------------------------------------------------ 侧边栏 */
  function switchPanel(name) {
    if (window.Workbench) {
      if (name === 'articles') Workbench.renderArticles();
      if (name === 'recent') Workbench.renderRecent();
    }
    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-panel') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
  }

  /* ------------------------------------------------ 快捷键 */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (!meta && e.key === 'Escape' && window.Workbench && Workbench.isOpen()) {
        Workbench.closeQuick();
        Workbench.closeSearch();
        return;
      }
      if (!meta) return;
      var k = e.key.toLowerCase();
      // 标签页：⌃⇥ / ⌃⇧⇥ 循环，⌘⇧[ ⌘⇧] 前后（按物理键位 + 字符双重判断，
      // 不吃键盘布局的亏：美式布局 shift 之后 e.key 是 } 和 {，code 仍是 Bracket*）
      if (e.code === 'Tab' || k === 'tab') {
        e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return;
      }
      if (e.code === 'BracketRight' || k === ']' || k === '}') {
        if (!e.altKey) { e.preventDefault(); cycleTab(1); return; }
      }
      if (e.code === 'BracketLeft' || k === '[' || k === '{') {
        if (!e.altKey) { e.preventDefault(); cycleTab(-1); return; }
      }
      if (k === 't' && !e.shiftKey && !e.altKey) { e.preventDefault(); newTab(); return; }
      if (k === 'w' && !e.shiftKey) { e.preventDefault(); closeTab(tabsState.active); return; }
      if (k === 't' && e.shiftKey) { e.preventDefault(); reopenClosed(); return; }
      if (k === 'f' && !e.shiftKey) { e.preventDefault(); openFind(e.altKey); return; }
      if (k === ',') { e.preventDefault(); openPrefs(); return; }
      if (k === 'o' && e.shiftKey && e.altKey) { e.preventDefault(); doOpenFolder(); return; }
      if (k === 'o' && e.shiftKey) {
        e.preventDefault();
        if (window.Workbench) Workbench.openQuick();
        return;
      }
      if (k === 'o') { e.preventDefault(); doOpenFile(); return; }
      if (k === 'f' && e.shiftKey) { e.preventDefault(); if (window.Workbench) Workbench.openSearch(); return; }
      if (k === 'n' && e.shiftKey) {
        e.preventDefault();
        if (window.Bridge && window.Bridge.newWindow) window.Bridge.newWindow(Editor.getPath());
        else toast('需要桌面版应用');
        return;
      }
      if (k === 's') { e.preventDefault(); if (e.shiftKey) doSaveAs(); else doSave(); return; }
      if (k === 'n') { e.preventDefault(); doNew(); return; }
      if (k === 'l' && e.shiftKey) { e.preventDefault(); toggleSplit(); return; }
      if (k === '/') {
        e.preventDefault();
        if (Editor.isSplitMode()) Split.exit();
        Editor.toggleSource();
        syncSplitBtn();
        return;
      }
      if (k === 'p' && e.shiftKey) { e.preventDefault(); exportPDF(); return; }
      if (k === 'p') {
        e.preventDefault();
        if (window.Bridge && window.Bridge.available && window.Bridge.print) window.Bridge.print();
        else exportPDF();
        return;
      }
      if (k === '\\') { e.preventDefault(); toggleSidebar(); return; }
      // 视图缩放
      if (k === '+' || k === '=') { e.preventDefault(); setZoom((pref.zoom || 100) + 10); return; }
      if (k === '-' || k === '_') { e.preventDefault(); setZoom((pref.zoom || 100) - 10); return; }
      if (k === '0' && !(e.target && (e.target.tagName === 'TEXTAREA' || e.target.__live))) {
        e.preventDefault(); setZoom(100); return;
      }
      // 插入表格
      if (k === 't' && e.altKey && window.Table) {
        e.preventDefault();
        var stt = Editor.getState();
        var at = stt && stt.editing >= 0 ? stt.editing : 0;
        Table.insertTableDialog(at);
        return;
      }
      // 查找替换（⌘H）
      if (k === 'h') { e.preventDefault(); openFind(true); return; }
      // 复制为 Markdown / 粘贴为纯文本
      if (k === 'c' && e.shiftKey) { e.preventDefault(); copyAsMarkdown(); return; }
      if (k === 'v' && e.shiftKey) { e.preventDefault(); pastePlainText(); return; }
      // 选择单词 / 当前行
      if (k === 'd' && !e.shiftKey) {
        if (Editor.selectWordAtCaret()) { e.preventDefault(); return; }
      }
      if (k === 'l' && !e.shiftKey) {
        if (Editor.selectLineAtCaret()) { e.preventDefault(); return; }
      }
    });
  }

  function copyAsMarkdown() {
    var txt = '';
    try { txt = Editor.selectionRaw(); } catch (e) {}
    if (!txt) { toast('先选中一段内容'); return; }
    var done = function () { toast('已复制为 Markdown'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { legacyCopy(txt); done(); });
    } else { legacyCopy(txt); done(); }
  }

  function legacyCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function pastePlainText() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast('当前环境不支持读取剪贴板');
      return;
    }
    navigator.clipboard.readText().then(function (txt) {
      if (!txt) return;
      Editor.insertAtCaret(txt);
      toast('已按纯文本粘贴');
    }).catch(function () { toast('读取剪贴板失败'); });
  }

  function toggleSidebar() {
    var sb = $('sidebar');
    sb.classList.toggle('collapsed');
    document.body.classList.toggle('side-hidden', sb.classList.contains('collapsed'));
  }

  function syncSourceBtn() {
    $('tb-source').classList.toggle('on', Editor.isSourceMode());
  }

  /* ------------------------------------------------ 分栏模式 */
  function syncSplitBtn() {
    $('tb-split').classList.toggle('on', Editor.isSplitMode());
    syncSourceBtn();
    refresh(Editor.getState());
  }

  function toggleSplit(force) {
    if (!window.Split) return;
    if (force === true && Editor.isSplitMode()) return;
    var now = Split.toggle(force);
    syncSplitBtn();
    // Split.enter() 是「先切模式、后把全文填进 textarea」，上面这一拍 read 到的是空源码，
    // 状态栏字数会停在 0 字 · 0 字符。等这一轮跑完再同步一次账目才对。
    setTimeout(syncSplitBtn, 0);
    if (now) toast('分栏模式：左侧编辑，右侧实时预览 · ⌘⇧L 切回');
  }

  /* ------------------------------------------------ 本地翻译 */
  var TR_LANGS = {
    'zh-Hans': '中文（简体）', 'zh-Hant': '中文（繁體）', en: 'English',
    ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch',
    es: 'Español', pt: 'Português', it: 'Italiano', ru: 'Русский', ar: 'العربية'
  };

  var tr = { target: 'zh-Hans', source: '', ctx: null, result: '', seq: 0, busy: false, lastKey: 0 };

  function trLangName(code) {
    if (!code) return trTarget();
    var key = String(code).split('-')[0].toLowerCase();
    for (var k in TR_LANGS) {
      if (k.toLowerCase() === String(code).toLowerCase() || k.split('-')[0].toLowerCase() === key) return TR_LANGS[k];
    }
    return code;
  }
  function trTarget() { return TR_LANGS[tr.target] || tr.target; }

  /* 按文字体系判断源语言。
     必须自己判断：把源语言留空交给系统识别时，短句 / 中英混排经常判不出来，
     系统就会弹「选择语言」来问用户——这就是每次翻译都被追问的原因。 */
  var SCRIPT_RULES = [
    [/[\u3040-\u30ff\u31f0-\u31ff]/, 'ja'],                 // 假名
    [/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/, 'ko'],    // 谚文
    [/[\u4e00-\u9fff\u3400-\u4dbf]/, 'zh-Hans'],            // 汉字
    [/[\u0400-\u04ff]/, 'ru'],
    [/[\u0600-\u06ff\u0750-\u077f]/, 'ar'],
    [/[\u0e00-\u0e7f]/, 'th'],
    [/[\u0900-\u097f]/, 'hi'],
    [/[\u0590-\u05ff]/, 'he']
  ];

  function langBase(code) { return String(code || '').split('-')[0].toLowerCase(); }
  function isHant(code) { return /hant|tw|hk|mo/i.test(String(code || '')); }

  function detectSource(text) {
    var s = String(text || '');
    for (var i = 0; i < SCRIPT_RULES.length; i++) {
      if (SCRIPT_RULES[i][0].test(s)) return SCRIPT_RULES[i][1];
    }
    if (/[A-Za-z]/.test(s)) return 'en';   // 拉丁字母默认按英文
    return '';                             // 纯数字/符号/表情：不猜，交给系统
  }

  // 源语言是否等于目标语言（中文区分简繁）
  function sameLang(a, b) {
    if (!a || !b) return false;
    if (langBase(a) !== langBase(b)) return false;
    if (langBase(a) === 'zh') return isHant(a) === isHant(b);
    return true;
  }

  function initTranslate() {
    try { tr.target = localStorage.getItem('opentypora.translateTarget') || 'zh-Hans'; } catch (err) {}
    if (!TR_LANGS[tr.target]) tr.target = 'zh-Hans';
    $('tr-target').value = tr.target;

    $('tr-target').addEventListener('change', function () {
      tr.target = this.value;
      try { localStorage.setItem('opentypora.translateTarget', tr.target); } catch (err) {}
      if (tr.ctx) runTranslate();
    });

    // 浮标：按下时不抢焦点，保证选区还在
    $('sel-translate').addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
    });
    $('sel-translate').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      translateSelection();
    });

    document.addEventListener('mouseup', onDocMouseUp, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onTrKeyDown, true);
    $('editor-scroll').addEventListener('scroll', hideSelBar);
    // 源码/分栏的 textarea 自己滚动时，浮标会脱钩，直接收起
    document.addEventListener('scroll', function (e) {
      var t = e.target;
      if (t && t.tagName === 'TEXTAREA') hideSelBar();
    }, true);

    $('tr-close').addEventListener('click', hideTrPanel);
    $('tr-copy').addEventListener('click', copyTranslation);
    $('tr-insert').addEventListener('click', insertTranslation);
    $('tr-replace').addEventListener('click', replaceTranslation);
    window.addEventListener('resize', function () {
      // 选区坐标是视口坐标，窗口尺寸一变就重新量一次
      if (tr.ctx) {
        var nc = null;
        try { nc = Editor.selectionContext(); } catch (err) {}
        if (nc && nc.text && nc.text.trim()) tr.ctx.rect = nc.rect;
        placeTrPanel(tr.ctx.rect);
      }
      if ($('sel-bar').classList.contains('show')) showSelBarForSelection();
    });
  }

  /* ------------------------------------------------ 查找 / 替换 */
  var fb = {
    open: false, replace: false, q: '',
    matches: [], idx: -1,
    caseSensitive: false, regex: false, wholeWord: false, invalid: false,
    timer: null, docTimer: null
  };

  function fbOpt() { return { caseSensitive: fb.caseSensitive, regex: fb.regex, wholeWord: fb.wholeWord }; }

  function initFind() {
    $('fb-q').addEventListener('input', scheduleFind);
    $('fb-q').addEventListener('keydown', onFindKey);
    $('fb-r').addEventListener('keydown', onFindKey);
    $('fb-prev').addEventListener('click', function () { fbStep(-1); });
    $('fb-next').addEventListener('click', function () { fbStep(1); });
    $('fb-close').addEventListener('click', closeFind);
    $('fb-case').addEventListener('click', function () { toggleFbFlag('caseSensitive', 'fb-case'); });
    $('fb-regex').addEventListener('click', function () { toggleFbFlag('regex', 'fb-regex'); });
    $('fb-word').addEventListener('click', function () { toggleFbFlag('wholeWord', 'fb-word'); });
    $('fb-rep').addEventListener('click', fbReplaceOne);
    $('fb-repall').addEventListener('click', fbReplaceAll);
    // 焦点不在查找框里时，Esc 也要能关掉
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fb.open) closeFind();
    }, true);
  }

  function openFind(withReplace) {
    fb.open = true;
    fb.replace = !!withReplace;
    $('findbar').classList.add('show');
    $('findbar').setAttribute('aria-hidden', 'false');
    $('fb-replace-row').hidden = !fb.replace;

    // 把当前选区（单行、不太长）带进查找框，省一次输入
    var q = $('fb-q');
    if (!q.value) {
      var sel = '';
      try {
        var ctx = Editor.selectionContext();
        if (ctx && ctx.text && ctx.text.indexOf('\n') < 0 && ctx.text.length <= 120) sel = ctx.text;
      } catch (err) {}
      if (sel) q.value = sel;
    }
    q.focus();
    q.select();
    runFind(true);
  }

  function closeFind() {
    fb.open = false;
    if (fb.timer) clearTimeout(fb.timer);
    if (fb.docTimer) clearTimeout(fb.docTimer);
    $('findbar').classList.remove('show');
    $('findbar').setAttribute('aria-hidden', 'true');
    fb.matches = []; fb.idx = -1;
  }

  function toggleFbFlag(key, btnId) {
    fb[key] = !fb[key];
    $(btnId).classList.toggle('on', fb[key]);
    runFind(true);
  }

  function scheduleFind() {
    if (fb.timer) clearTimeout(fb.timer);
    fb.timer = setTimeout(function () { runFind(true); }, 110);
  }

  function fbSetCount() {
    var c = $('fb-count'), q = $('fb-q');
    q.classList.toggle('bad', fb.invalid);
    c.classList.toggle('bad', fb.invalid);
    if (fb.invalid) { c.textContent = '正则有误'; return; }
    if (!fb.q) { c.textContent = ''; return; }
    c.textContent = (fb.idx >= 0 ? fb.idx + 1 : 0) + '/' + fb.matches.length;
  }

  // reset=true 时从第一个匹配开始；否则尽量停在当前匹配位置附近
  function runFind(reset, silent) {
    if (!fb.open) return;
    fb.q = $('fb-q').value;
    if (!fb.q) { fb.matches = []; fb.idx = -1; fb.invalid = false; fbSetCount(); return; }

    var r = Editor.search(fb.q, fbOpt());
    if (r == null) {                       // 正则写坏了
      fb.invalid = true; fb.matches = []; fb.idx = -1; fbSetCount(); return;
    }
    fb.invalid = false;
    fb.matches = r.matches;
    if (!fb.matches.length) { fb.idx = -1; fbSetCount(); return; }

    if (reset) fb.idx = 0;
    else if (fb.idx < 0 || fb.idx >= fb.matches.length) fb.idx = 0;
    fbSetCount();
    if (!silent) revealCurrent();
  }

  function revealCurrent() {
    var m = fb.matches[fb.idx];
    if (!m) return;
    var prev = document.activeElement;
    Editor.revealOffset(m.start, m.end - m.start);
    // reveal 会把焦点交给编辑区，用户还在查找框里打字，抢回来
    if (prev && (prev.id === 'fb-q' || prev.id === 'fb-r') && document.activeElement !== prev) prev.focus();
  }

  function fbStep(dir) {
    if (!fb.matches.length) return;
    fb.idx = (fb.idx + dir + fb.matches.length) % fb.matches.length;
    fbSetCount();
    revealCurrent();
  }

  function onFindKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeFind();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.altKey) { fbReplaceAll(); return; }
      if (meta) { fbReplaceOne(); return; }
      if (e.target.id === 'fb-r' && !e.shiftKey) { fbReplaceOne(); return; }
      fbStep(e.shiftKey ? -1 : 1);
      return;
    }
    e.stopPropagation();   // 别让文档快捷键（⌘B 等）在输入框里生效
  }

  function fbReplaceOne() {
    if (!fb.open || !fb.q) return;
    runFind(false, true);
    var m = fb.matches[fb.idx];
    if (!m) { toast('没有可替换的匹配'); return; }
    var rep = $('fb-r').value;
    var caret = Editor.replaceAt(m.start, m.end, rep);

    // 文本变了，重新算匹配，并跳到替换位置之后的第一个
    var r = Editor.search(fb.q, fbOpt());
    fb.matches = r ? r.matches : [];
    if (!fb.matches.length) { fb.idx = -1; fbSetCount(); return; }
    var next = 0;
    for (var i = 0; i < fb.matches.length; i++) {
      if (fb.matches[i].start >= caret) { next = i; break; }
      next = i + 1 >= fb.matches.length ? 0 : i + 1;
    }
    fb.idx = next;
    fbSetCount();
    revealCurrent();
  }

  function fbReplaceAll() {
    if (!fb.open || !fb.q) return;
    var rep = $('fb-r').value;
    var n = Editor.replaceAllMatches(fb.q, rep, fbOpt());
    if (!n) { toast('没有可替换的匹配'); return; }
    toast('已替换 ' + n + ' 处');
    runFind(true);
  }

  // 文档内容变化（在查找条打开时）→ 静默刷新计数，别抢光标
  function fbDocChanged() {
    if (!fb.open || !fb.q) return;
    if (fb.docTimer) clearTimeout(fb.docTimer);
    fb.docTimer = setTimeout(function () { runFind(false, true); }, 260);
  }

  /* ------------------------------------------------ 字数面板 */
  var wc = { open: false };

  function wcStats() {
    var text = Editor.getValue();
    var c = MD.countWords(text);
    var lines = text ? text.split('\n').length : 0;
    var paras = text.split(/\n\s*\n/).filter(function (s) { return s.trim(); }).length;
    var minutes = c.words ? Math.max(1, Math.round(c.words / 300)) : 0;
    return { words: c.words, chars: c.chars, lines: lines, paras: paras, minutes: minutes };
  }

  function wcRender() {
    var s = wcStats();
    $('wc-words').textContent = s.words;
    $('wc-chars').textContent = s.chars;
    $('wc-lines').textContent = s.lines;
    $('wc-paras').textContent = s.paras;
    $('wc-time').textContent = (s.minutes || 0) + ' 分钟';
    var ctx = null;
    try { ctx = Editor.selectionContext(); } catch (e) {}
    if (ctx && ctx.text) {
      var c2 = MD.countWords(ctx.text);
      $('wc-sel').textContent = c2.words + ' 字 / ' + c2.chars + ' 字符';
    } else {
      $('wc-sel').textContent = '—';
    }
  }

  function toggleWc() {
    wc.open = !wc.open;
    var pop = $('wc-pop');
    pop.classList.toggle('show', wc.open);
    pop.setAttribute('aria-hidden', wc.open ? 'false' : 'true');
    if (wc.open) {
      wcRender();
      var r = $('sb-count').getBoundingClientRect();
      var w = pop.offsetWidth || 190;
      var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(r.top - (pop.offsetHeight || 160) - 8) + 'px';
    }
  }

  /* ------------------------------------------------ 偏好设置 / 主题 */
  var PREF_DEFAULT = {
    size: 15.5, width: 830, autosave: true, spellcheck: false, base: 'github',
    // 版式三件套：font 是预设 id 或 'custom:<字体族>'；leading 是正文行高倍数；
    // bg 为空串表示跟随主题（写死颜色就不跟着主题变了）
    font: 'system', leading: 1.72, bg: '',
    // 「加入词典」的词：渲染态波浪线的豁免表，落进偏好一起存
    spellIgnore: [],
    autoPair: true, smart: true, lineno: false, zoom: 100, followSystem: false,
    imgCenter: false, strict: false, snippets: '', live: true,
    exportCmds: [],
    htmlStyles: true, htmlEmbed: false, htmlWidth: true,
    htmlHead: '', htmlTail: '',
    // 空串 = 跟随当前编辑器主题；'user:x.css' = 自定义主题
    htmlTheme: '',
    pdfPaper: 'a4', pdfMargin: 42, pdfHF: false, pdfH1: false, pdfBook: true
  };
  var pref = {};
  var userThemes = [];
  // 单一来源：内置主题表在 export.js（导出的 data-theme 也用它），这里只取显示用
  var BUILTIN_THEMES = (window.Export && Export.themes
    ? Export.themes.map(function (t) { return [t.id, t.label]; })
    : [['github', 'GitHub'], ['night', 'Night'], ['newsprint', 'Newsprint'],
       ['pixyll', 'Pixyll'], ['whitey', 'Whitey'], ['gothic', 'Gothic']]);

  function loadPrefs() {
    pref = {};
    for (var k in PREF_DEFAULT) pref[k] = PREF_DEFAULT[k];
    try {
      var raw = localStorage.getItem('opentypora.prefs');
      if (raw) {
        var o = JSON.parse(raw);
        for (var k2 in PREF_DEFAULT) if (o[k2] != null) pref[k2] = o[k2];
      }
    } catch (err) {}
    // 命令列表可能被手工改坏，过一遍归一化（丢空项、补 id/ext、限条数）
    pref.exportCmds = window.Xcmd ? Xcmd.norm(pref.exportCmds) : [];
  }

  function savePrefs() {
    try { localStorage.setItem('opentypora.prefs', JSON.stringify(pref)); } catch (err) {}
  }

  /* 严格模式切换要重解析：块类型（标题/列表归属）会变，
   * 只重渲染的话模型还是旧档位解析出来的。 */
  var lastStrict = null;
  function applyPrefs() {
    var root = document.documentElement;
    root.style.setProperty('--base-size', (+pref.size || 15.5) + 'px');
    root.style.setProperty('--content-width', (+pref.width || 830) + 'px');
    applyTypo(root);
    if (window.Editor) {
      Editor.setSpellcheck(!!pref.spellcheck);
      Editor.setTyping({ autoPair: pref.autoPair !== false, smart: !!pref.smart, codeLineNo: !!pref.lineno });
      Editor.setLivePreview(pref.live !== false);
      if (window.Snippets) Editor.setSnippets(Snippets.parseSnippets(pref.snippets));
    }
    // 渲染态的波浪线：先灌忽略表，再开关（开关打开时会立刻扫一遍当前文档）
    if (window.Spell) {
      Spell.setIgnore(Array.isArray(pref.spellIgnore) ? pref.spellIgnore : []);
      Spell.setEnabled(!!pref.spellcheck);
    }
    if (window.MD && MD.setStrict) MD.setStrict(!!pref.strict);
    if (lastStrict !== null && lastStrict !== !!pref.strict &&
        window.Editor && Editor.reparse) Editor.reparse();
    lastStrict = !!pref.strict;
    applyZoom();
    applySystemTheme();
    document.body.classList.toggle('img-center', !!pref.imgCenter);
  }

  /* 版式三件套落到 :root 的行内变量。空值 = 清掉自定义、回到 app.css / 主题的默认，
   * 所以「跟随主题」走的是 removeProperty，而不是猜一个颜色写进去。 */
  function applyTypo(root) {
    if (!window.Typo) return;
    var pairs = Typo.vars({ font: pref.font, leading: pref.leading, bg: pref.bg });
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1]) root.style.setProperty(pairs[i][0], pairs[i][1]);
      else root.style.removeProperty(pairs[i][0]);
    }
  }

  /* 当前主题的背景色：只在没自定义背景时读，这时 --bg 还没被行内样式盖住 */
  function themeBg() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) return v;
    } catch (err) {}
    return '#ffffff';
  }

  /* 视图缩放：只在正文区放大，侧边栏/工具栏保持原尺寸 */
  function applyZoom() {
    var z = Math.max(0.8, Math.min(2, (+pref.zoom || 100) / 100));
    ['editor', 'split-prev-inner'].forEach(function (id) {
      var el = $(id);
      if (el) el.style.zoom = z === 1 ? '' : String(z);
    });
    var v = $('prefs-zoom-val');
    if (v) v.textContent = Math.round(z * 100) + '%';
  }

  function setZoom(pct) {
    pref.zoom = Math.max(80, Math.min(200, Math.round(pct / 10) * 10));
    savePrefs();
    applyZoom();
    var r = $('prefs-zoom');
    if (r) { r.value = pref.zoom; }
    var v = $('prefs-zoom-val');
    if (v) v.textContent = pref.zoom + '%';
  }

  /* 跟随系统外观：prefers-color-scheme 变化时切 Night / GitHub */
  var sysMq = null;
  function applySystemTheme() {
    if (!pref.followSystem) {
      if (sysMq) { sysMq.onchange = null; sysMq = null; }
      return;
    }
    if (sysMq) return;
    try {
      sysMq = window.matchMedia('(prefers-color-scheme: dark)');
      var onDark = function (dark) {
        var cur = curTheme();
        if (dark && cur !== 'night') setThemeId('night');
        else if (!dark && cur === 'night') setThemeId('github');
      };
      onDark(sysMq.matches);
      sysMq.onchange = function (e) { onDark(e.matches); };
    } catch (err) {}
  }

  function curTheme() {
    try { return localStorage.getItem('opentypora.theme') || 'github'; } catch (err) { return 'github'; }
  }

  function setThemeId(id) {
    try { localStorage.setItem('opentypora.theme', id); } catch (err) {}
    if (String(id).indexOf('user:') === 0) {
      Editor.setTheme(pref.base || 'github');   // 自定义主题叠加在内置基底上
      loadUserThemeCss(String(id).slice(5));
    } else {
      pref.base = id;
      clearUserThemeCss();
      Editor.setTheme(id);
    }
    syncThemeSelects();
    // 「跟随主题」状态下色块要跟着换；自定义背景时它本来就不该动
    if (prefsOpen()) syncBgSwatch();
    // Mermaid 的配色是 initialize 时定死的，换主题必须整篇重画
    try { if (window.Diagram) Diagram.refresh(); } catch (err) {}
    // Flowchart 的 SVG 是同步生成的，但配色也要跟着主题走
    try { if (window.Flow) Flow.refresh(); } catch (err) {}
  }

  // 内置主题把变量挂在 html[data-theme="…"] 上，权重比 :root 高；
  // 用户主题习惯写 :root / html，这里把它们的权重抬到同一级，靠"后插入"取胜。
  function tweakUserCss(css) {
    return String(css || '')
      .replace(/(^|\})\s*:root\s*(?=[,{])/g, '$1 html[data-theme]')
      .replace(/(^|\})\s*html\s*(?=[,{])/g, '$1 html[data-theme]');
  }

  function loadUserThemeCss(name) {
    if (!window.Bridge || !window.Bridge.available) { toast('自定义主题需要桌面版应用'); return; }
    window.Bridge.readTheme(name).then(function (r) {
      var css = tweakUserCss((r && r.css) || '');
      var el = $('user-theme');
      if (!el) {
        el = document.createElement('style');
        el.id = 'user-theme';
        document.head.appendChild(el);
      }
      el.textContent = css;
      if (!css && name) toast('主题文件为空：' + name);
      try { if (window.Diagram) Diagram.refresh(); } catch (err) {}
      try { if (window.Flow) Flow.refresh(); } catch (err) {}
    }).catch(function () { toast('读取主题失败'); });
  }

  function clearUserThemeCss() {
    var el = $('user-theme');
    if (el) el.textContent = '';
  }

  function syncThemeSelects() {
    var cur = curTheme();
    ['theme-select', 'prefs-theme'].forEach(function (sid) {
      var sel = $(sid);
      if (!sel) return;
      var html = '';
      BUILTIN_THEMES.forEach(function (t) {
        html += '<option value="' + t[0] + '">' + t[1] + '</option>';
      });
      if (userThemes.length) {
        html += '<optgroup label="自定义">';
        userThemes.forEach(function (t) {
          html += '<option value="user:' + esc(t.id) + '">' + esc(t.name) + '</option>';
        });
        html += '</optgroup>';
      }
      sel.innerHTML = html;
      sel.value = cur;
      if (sel.value !== cur) sel.value = pref.base || 'github';
    });
  }

  function scanThemes() {
    if (!window.Bridge || !window.Bridge.available ||
        typeof window.Bridge.listThemes !== 'function') {
      userThemes = [];
      $('prefs-themedir').textContent = '（桌面版应用才支持自定义主题目录）';
      syncThemeSelects();
      return Promise.resolve();
    }
    return window.Bridge.listThemes().then(function (r) {
      userThemes = (r && r.themes) || [];
      $('prefs-themedir').textContent = (r && r.dir) || '—';
      syncThemeSelects();
    }).catch(function () {});
  }

  /* 字体下拉：选项表只来自 typography.js，不要第二份 */
  function buildFontSelect() {
    var sel = $('prefs-font');
    if (!sel || !window.Typo || sel.options.length) return;
    var html = '';
    Typo.FONTS.forEach(function (f) {
      html += '<option value="' + esc(f.id) + '">' + esc(f.label) + '</option>';
    });
    sel.innerHTML = html;
  }

  function syncFontRow() {
    var f = window.Typo ? Typo.pickFont(pref.font) : { id: 'system', stack: '' };
    var sel = $('prefs-font');
    if (sel) sel.value = f.id;
    var row = $('prefs-font-row');
    if (row) row.style.display = f.id === 'custom' ? '' : 'none';
    var inp = $('prefs-font-custom');
    if (inp && f.id === 'custom' && document.activeElement !== inp) inp.value = f.stack;
  }

  /* 背景色块：没自定义时禁用，并显示当前主题的背景色（此时行内变量已清掉，读到的就是主题值） */
  function syncBgSwatch() {
    var el = $('prefs-bg');
    if (!el) return;
    var bg = window.Typo ? Typo.normBg(pref.bg) : '';
    el.disabled = !bg;
    el.value = bg || themeBg();
    var btn = $('prefs-bg-reset');
    if (btn) btn.disabled = !bg;
  }

  function openPrefs() {
    $('prefs-size').value = pref.size;
    $('prefs-size-val').textContent = pref.size;
    $('prefs-width').value = pref.width;
    $('prefs-width-val').textContent = pref.width;
    buildFontSelect();
    syncFontRow();
    var ldEl = $('prefs-leading');
    if (ldEl && window.Typo) {
      ldEl.value = Typo.normLeading(pref.leading);
      $('prefs-leading-val').textContent = Typo.normLeading(pref.leading).toFixed(2);
    }
    syncBgSwatch();
    $('prefs-autosave').checked = !!pref.autosave;
    $('prefs-spell').checked = !!pref.spellcheck;
    $('prefs-autopair').checked = pref.autoPair !== false;
    $('prefs-smart').checked = !!pref.smart;
    $('prefs-lineno').checked = !!pref.lineno;
    var lvEl = $('prefs-live');
    if (lvEl) lvEl.checked = pref.live !== false;
    $('prefs-zoom').value = pref.zoom || 100;
    $('prefs-zoom-val').textContent = (pref.zoom || 100) + '%';
    var fs = $('prefs-follow');
    if (fs) fs.checked = !!pref.followSystem;
    var ic = $('prefs-imgcenter');
    if (ic) ic.checked = !!pref.imgCenter;
    var stEl = $('prefs-strict');
    if (stEl) stEl.checked = !!pref.strict;
    var snEl = $('prefs-snippets');
    if (snEl) snEl.value = pref.snippets || '';
    renderXcmds();
    $('prefs').classList.add('show');
    $('prefs').setAttribute('aria-hidden', 'false');
    scanThemes();
  }

  function closePrefs() {
    $('prefs').classList.remove('show');
    $('prefs').setAttribute('aria-hidden', 'true');
  }

  function prefsOpen() { return $('prefs').classList.contains('show'); }

  function initPrefs() {
    $('prefs-close').addEventListener('click', closePrefs);
    $('prefs').addEventListener('mousedown', function (e) {
      if (e.target === $('prefs')) closePrefs();
    });

    $('prefs-size').addEventListener('input', function () {
      pref.size = +this.value;
      $('prefs-size-val').textContent = pref.size;
      applyPrefs(); savePrefs();
    });
    $('prefs-width').addEventListener('input', function () {
      pref.width = +this.value;
      $('prefs-width-val').textContent = pref.width;
      applyPrefs(); savePrefs();
    });
    // --- 版式：字体 / 行距 / 背景 ---
    var fontSel = $('prefs-font');
    if (fontSel) fontSel.addEventListener('change', function () {
      if (this.value === 'custom') {
        var cur = window.Typo ? Typo.pickFont(pref.font) : { id: '', stack: '' };
        pref.font = Typo.CUSTOM_PREFIX + (cur.id === 'custom' ? cur.stack : '');
        syncFontRow();
        var inp = $('prefs-font-custom');
        if (inp) { inp.focus(); inp.select(); }
      } else {
        pref.font = this.value;
        syncFontRow();
      }
      applyPrefs(); savePrefs();
    });
    var fontInp = $('prefs-font-custom');
    if (fontInp) {
      var applyFontText = function () {
        var stack = window.Typo ? Typo.cleanStack(fontInp.value) : fontInp.value;
        fontInp.value = stack;
        pref.font = Typo.CUSTOM_PREFIX + stack;
        applyPrefs(); savePrefs();
      };
      fontInp.addEventListener('input', applyFontText);
      fontInp.addEventListener('change', applyFontText);
    }
    var ldEl2 = $('prefs-leading');
    if (ldEl2) ldEl2.addEventListener('input', function () {
      pref.leading = window.Typo ? Typo.normLeading(this.value) : +this.value;
      $('prefs-leading-val').textContent = (+pref.leading).toFixed(2);
      applyPrefs(); savePrefs();
    });
    var bgEl = $('prefs-bg');
    if (bgEl) {
      bgEl.addEventListener('input', function () {
        pref.bg = this.value;
        applyPrefs(); savePrefs();
        var btn = $('prefs-bg-reset');
        if (btn) btn.disabled = false;
        this.disabled = false;
      });
      var bgReset = $('prefs-bg-reset');
      if (bgReset) bgReset.addEventListener('click', function () {
        pref.bg = '';
        applyPrefs(); savePrefs();
        syncBgSwatch();
        toast('背景已跟随主题');
      });
    }
    $('prefs-autosave').addEventListener('change', function () {
      pref.autosave = this.checked; savePrefs();
      toast(pref.autosave ? '已开启自动保存' : '已关闭自动保存');
    });
    $('prefs-autopair').addEventListener('change', function () {
      pref.autoPair = this.checked; savePrefs(); applyPrefs();
    });
    $('prefs-smart').addEventListener('change', function () {
      pref.smart = this.checked; savePrefs(); applyPrefs();
    });
    $('prefs-lineno').addEventListener('change', function () {
      pref.lineno = this.checked; savePrefs(); applyPrefs();
    });
    var lvToggle = $('prefs-live');
    if (lvToggle) lvToggle.addEventListener('change', function () {
      pref.live = this.checked; savePrefs(); applyPrefs();
    });
    $('prefs-zoom').addEventListener('input', function () { setZoom(+this.value); });
    var icEl = $('prefs-imgcenter');
    if (icEl) icEl.addEventListener('change', function () {
      pref.imgCenter = this.checked; savePrefs(); applyPrefs();
    });
    var fsEl = $('prefs-follow');
    if (fsEl) fsEl.addEventListener('change', function () {
      pref.followSystem = this.checked; savePrefs(); applySystemTheme();
    });
    var strictEl = $('prefs-strict');
    if (strictEl) strictEl.addEventListener('change', function () {
      pref.strict = this.checked; savePrefs(); applyPrefs();
      toast(pref.strict ? '已开启严格模式' : '已关闭严格模式');
    });
    var snipEl = $('prefs-snippets');
    if (snipEl) {
      var saveSnips = function () {
        pref.snippets = snipEl.value;
        savePrefs();
        if (window.Snippets && window.Editor) Editor.setSnippets(Snippets.parseSnippets(pref.snippets));
      };
      snipEl.addEventListener('change', saveSnips);
      snipEl.addEventListener('blur', saveSnips);
    }
    $('prefs-spell').addEventListener('change', function () {
      pref.spellcheck = this.checked; savePrefs(); applyPrefs();
    });
    $('prefs-theme').addEventListener('change', function () { setThemeId(this.value); });

    $('prefs-openthemes').addEventListener('click', function () {
      if (!window.Bridge || !window.Bridge.available) { toast('桌面版应用才支持'); return; }
      window.Bridge.openThemeFolder().catch(function () {});
    });
    $('prefs-reloadthemes').addEventListener('click', function () {
      scanThemes().then(function () { toast('已扫描主题目录'); });
    });
    $('prefs-reset').addEventListener('click', function () {
      // 只重置「外观」这几项。之前是重建整个 pref 对象，顺手把拼写忽略表、
      // 文本片段、自定义导出命令这些跟外观无关的东西一起抹了（不可逆）。
      pref.size = PREF_DEFAULT.size;
      pref.width = PREF_DEFAULT.width;
      pref.autosave = PREF_DEFAULT.autosave;
      pref.spellcheck = PREF_DEFAULT.spellcheck;
      pref.font = PREF_DEFAULT.font;
      pref.leading = PREF_DEFAULT.leading;
      pref.bg = PREF_DEFAULT.bg;
      savePrefs(); applyPrefs(); openPrefs();
      toast('已恢复默认外观');
    });

    bindXcmds();

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && prefsOpen()) closePrefs();
    }, true);
  }



  function onDocMouseUp(e) {
    if (e.target.closest && e.target.closest('.sel-bar, .tr-panel, .findbar, .prefs')) return;
    setTimeout(showSelBarForSelection, 0);
  }

  function onDocMouseDown(e) {
    if (e.target.closest && e.target.closest('.sel-bar, .tr-panel')) return;
    hideSelBar();
    if (tr.ctx) hideTrPanel();
  }

  function onTrKeyDown(e) {
    if (e.key === 'Escape') {
      hideSelBar();
      if (tr.ctx) hideTrPanel();
      return;
    }
    // ⌘⇧Y：与原生菜单一致（⌘⇧T 归「重新打开已关闭的文件」，同一键位不能挂两份）
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      e.stopPropagation();
      // 菜单快捷键与页面快捷键可能同时到达，去重
      if (Date.now() - tr.lastKey < 350) return;
      tr.lastKey = Date.now();
      translateSelection();
    }
  }

  function showSelBarForSelection() {
    var ctx = null;
    try { ctx = Editor.selectionContext(); } catch (err) { ctx = null; }
    if (!ctx || !ctx.text || !ctx.text.trim()) { hideSelBar(); return; }
    var bar = $('sel-bar');
    bar.classList.add('show');
    var r = ctx.rect;
    var w = bar.offsetWidth || 78, h = bar.offsetHeight || 30;
    // 以选区真实中心对齐；跨行选区取整栏中心
    var cx = r.left + (r.width || 0) / 2;
    var left = cx - w / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    var top = r.top - h - 6;
    if (top < 8) top = Math.min(r.bottom + 6, window.innerHeight - h - 8);
    bar.style.left = Math.round(left) + 'px';
    bar.style.top = Math.round(top) + 'px';
  }

  function hideSelBar() {
    $('sel-bar').classList.remove('show');
  }

  // 截断过长的选区文本用于展示
  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function translateSelection() {
    var ctx = Editor.selectionContext();
    if (!ctx || !ctx.text || !ctx.text.trim()) {
      toast('请先选中要翻译的文本');
      return;
    }
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(ctx.text);
    ctx.lead = m ? m[1] : '';
    ctx.trail = m ? m[3] : '';
    ctx.core = m ? m[2] : ctx.text;
    if (!ctx.core) { toast('请先选中要翻译的文本'); return; }
    tr.ctx = ctx;
    tr.result = '';
    hideSelBar();

    $('tr-src').textContent = clip(ctx.core, 300);
    $('tr-src').title = ctx.core;
    placeTrPanel(ctx.rect);
    runTranslate();
  }

  function placeTrPanel(rect) {
    var panel = $('tr-panel');
    panel.classList.add('show');
    var w = panel.offsetWidth || 388;
    var h = panel.offsetHeight || 240;
    var left = Math.min(Math.max(12, rect.left), window.innerWidth - w - 12);
    var top = rect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 10);
    if (top < 12) top = 12;
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function hideTrPanel() {
    $('tr-panel').classList.remove('show');
    tr.ctx = null;
    tr.result = '';
    tr.busy = false;
    tr.seq++;
  }

  function setOut(html, cls) {
    var out = $('tr-out');
    out.className = 'tr-out' + (cls ? ' ' + cls : '');
    out.innerHTML = html;
  }

  function updateTrActions() {
    var has = !!tr.result;
    $('tr-copy').disabled = !has;
    $('tr-insert').disabled = !has;
    var can = false;
    if (has && tr.ctx) {
      var m = tr.ctx.mode;
      if (m === 'source' || m === 'edit' || m === 'split') can = true;
      else if (m === 'split-preview') can = tr.ctx.docStart != null;
      else can = tr.ctx.rStart != null;
    }
    $('tr-replace').disabled = !can;
    $('tr-replace').title = can ? '用译文替换原文' : '无法精确定位原文，请使用「插入下方」';
  }

  function runTranslate() {
    var ctx = tr.ctx;
    if (!ctx) return;
    var my = ++tr.seq;
    tr.busy = true;
    tr.result = '';
    updateTrActions();

    // 源语言由本地按文字体系判定（测试可覆盖 window.__trSource）
    var src = window.__trSource || detectSource(ctx.core);
    tr.source = src;

    // 原文已经是目标语言：不必调用系统（否则系统会追问要翻成什么语言）
    if (sameLang(src, tr.target)) {
      tr.busy = false;
      var alt = langBase(tr.target) === 'zh' ? 'en' : 'zh-Hans';
      setOut('<span class="tr-hint">这段文字已经是' + trTarget() + '，不需要翻译。</span>' +
        '<div class="tr-inline"><button class="tr-btn primary no-blur" id="tr-alt">改译为' + trLangName(alt) + '</button></div>');
      $('tr-note').textContent = '已识别为 ' + trLangName(src) + ' · 未调用系统翻译';
      var ab = $('tr-alt');
      if (ab) {
        ab.addEventListener('click', function () {
          tr.target = alt;
          try { localStorage.setItem('opentypora.translateTarget', alt); } catch (err) {}
          $('tr-target').value = alt;
          runTranslate();
        });
      }
      updateTrActions();
      placeTrPanel(ctx.rect);
      return;
    }

    setOut('<span class="tr-spin"></span>正在用本机模型翻译…', 'loading');
    placeTrPanel(ctx.rect);

    if (!window.Bridge || !window.Bridge.available) {
      setOut('本地翻译需要桌面版应用（当前是浏览器预览）。', 'error');
      tr.busy = false;
      return;
    }

    // 兜底：系统若弹了语言包/语言确认框，请求会长时间不返回，别让界面一直转圈
    var settled = false;
    var timer = setTimeout(function () {
      if (settled || my !== tr.seq) return;
      settled = true;
      tr.seq++;
      tr.busy = false;
      setOut('翻译超时。可能有系统弹窗在等你操作（语言包下载 / 语言确认），请看一眼屏幕后重试。' +
        '<div class="tr-inline"><button class="tr-btn primary no-blur" id="tr-retry3">重试</button>' +
        '<button class="tr-btn no-blur" id="tr-settings3">语言设置</button></div>', 'error');
      var rb = $('tr-retry3');
      if (rb) rb.addEventListener('click', runTranslate);
      var sb = $('tr-settings3');
      if (sb) sb.addEventListener('click', function () { window.Bridge.openTranslationSettings().catch(function () {}); });
      placeTrPanel(ctx.rect);
    }, 15000);

    window.Bridge.translate(ctx.core, tr.target, src).then(function (r) {
      if (settled || my !== tr.seq) return;
      settled = true;
      clearTimeout(timer);
      tr.busy = false;
      if (!r) { setOut('翻译失败：无响应', 'error'); return; }
      if (r.error) { showTranslateError(r); return; }
      tr.result = r.text || '';
      setOut(esc(tr.result));
      var from = r.sourceLang ? trLangName(r.sourceLang) : (tr.source ? trLangName(tr.source) : '自动识别');
      $('tr-note').textContent = 'Apple 本地翻译 · ' + from + ' → ' + trLangName(r.targetLang || tr.target);
      updateTrActions();
      placeTrPanel(ctx.rect);
    }).catch(function (e) {
      if (settled || my !== tr.seq) return;
      settled = true;
      clearTimeout(timer);
      tr.busy = false;
      setOut('翻译失败：' + esc(e.message || e), 'error');
      placeTrPanel(ctx.rect);
    });
  }

  function showTranslateError(r) {
    var msg = esc(r.message || '翻译失败');
    if (r.error === 'notInstalled') {
      setOut(msg + '<br><span class="tr-hint">首次使用某种语言时，系统需要先下载语言包（约几百 MB，只下一次）。</span>' +
        '<div class="tr-inline"><button class="tr-btn primary no-blur" id="tr-download">下载语言包</button></div>', 'error');
      var btn = $('tr-download');
      if (btn) btn.addEventListener('click', downloadLanguagePack);
    } else if (r.error === 'unsupported') {
      setOut(msg + '<div class="tr-inline"><button class="tr-btn no-blur" id="tr-settings">打开语言设置</button></div>', 'error');
      var b2 = $('tr-settings');
      if (b2) b2.addEventListener('click', function () { window.Bridge.openTranslationSettings().catch(function () {}); });
    } else {
      setOut(msg + '<div class="tr-inline"><button class="tr-btn no-blur" id="tr-retry">重试</button></div>', 'error');
      var b3 = $('tr-retry');
      if (b3) b3.addEventListener('click', runTranslate);
    }
    updateTrActions();
    placeTrPanel(tr.ctx.rect);
  }

  function downloadLanguagePack() {
    var my = tr.seq;
    setOut('<span class="tr-spin"></span>正在准备语言包…<br><span class="tr-hint">若出现系统提示，请点「下载」。下载完成后会自动继续翻译。</span>', 'loading');
    placeTrPanel(tr.ctx.rect);
    window.Bridge.prepareTranslation(tr.target, tr.source).then(function (r) {
      if (my !== tr.seq) return;
      if (r && r.error) {
        setOut('语言包准备失败：' + esc(r.message || r.error) +
          '<div class="tr-inline"><button class="tr-btn no-blur" id="tr-retry2">重试</button></div>', 'error');
        var b = $('tr-retry2');
        if (b) b.addEventListener('click', runTranslate);
        return;
      }
      runTranslate();
    }).catch(function (e) {
      if (my !== tr.seq) return;
      setOut('语言包准备失败：' + esc(e.message || e), 'error');
    });
  }

  function copyTranslation() {
    if (!tr.result) return;
    var done = function () { toast('已复制译文'); };
    if (window.Bridge && window.Bridge.available) {
      window.Bridge.copy(tr.result).then(done).catch(function () { fallbackCopy(tr.result) && done(); });
    } else {
      fallbackCopy(tr.result) && done();
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }

  function insertTranslation() {
    if (!tr.result || !tr.ctx) return;
    var ctx = tr.ctx, ok = true;
    if (ctx.mode === 'source') Editor.insertSourceAfterSelection(tr.result);
    else if (ctx.mode === 'split') Editor.insertSplitAfterSelection(tr.result);
    else if (ctx.mode === 'split-preview') ok = Editor.insertSplitDocAfter(ctx.docEnd, tr.result);
    else Editor.insertBlockAfter(ctx.block, tr.result);
    toast(ok ? '已插入译文' : '无法插入，请复制后手动粘贴');
    hideTrPanel();
  }

  function replaceTranslation() {
    if (!tr.result || !tr.ctx) return;
    var ctx = tr.ctx;
    var ok;
    if (ctx.mode === 'source') {
      ok = Editor.replaceSourceSelection(ctx.lead + tr.result + ctx.trail);
    } else if (ctx.mode === 'split') {
      ok = Editor.replaceSplitSelection(ctx.lead + tr.result + ctx.trail);
    } else if (ctx.mode === 'edit') {
      ok = Editor.replaceEditSelection(ctx.lead + tr.result + ctx.trail);
    } else if (ctx.mode === 'split-preview') {
      ok = Editor.replaceSplitDocRange(ctx.docStart, ctx.docEnd,
        ctx.lead + tr.result + ctx.trail, ctx.core);
    } else {
      ok = Editor.replaceRawRange(ctx.block, ctx.rStart, ctx.rEnd, tr.result);
    }
    toast(ok ? '已替换原文' : '无法替换，请用「插入下方」');
    if (ok) hideTrPanel();
  }

  /* ------------------------------------------------ 草稿
   * 没保存过的内容也要能找回：写 localStorage，重启后由 Workbench 提示恢复。
   */
  var draftTimer = null;
  function scheduleDraft() {
    if (!window.Workbench) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      if (!Editor.isDirty()) return;
      Workbench.saveDraft(Editor.getValue(), Editor.getName(), Editor.getPath());
    }, 1200);
  }

  /* ------------------------------------------------ 启动 */
  function boot() {
    loadPrefs();
    // 渲染态拼写的两个原生入口（没有原生壳时留空，Spell 自己会静默跳过）
    if (window.Spell) {
      if (window.Bridge && window.Bridge.available) {
        if (Bridge.spellCheck) Spell.setEngine(function (words, ignore) { return Bridge.spellCheck(words, ignore); });
        if (Bridge.spellGuesses) Spell.setGuesses(function (word) { return Bridge.spellGuesses(word); });
      }
      Spell.onIgnore(function (w) {
        var list = Array.isArray(pref.spellIgnore) ? pref.spellIgnore.slice() : [];
        if (list.indexOf(w) < 0) list.push(w);
        pref.spellIgnore = list;
        savePrefs();
      });
    }
    Editor.init({
      onChange: function (st) { refresh(st); scheduleDraft(); },
      onLoad: function () { if (window.Split) Split.refresh(); },
      onAutosave: function (st, src) {
        if (!pref.autosave) return;
        if (!st.path) return;
        if (!window.Bridge || !window.Bridge.available) return;
        window.Bridge.save(st.path, src).then(function () {
          // 自动保存成功 = 磁盘与编辑区一致，脏标记可以落下去（标签上的圆点跟着灭）。
          // 不改动 undo 栈。
          Editor.markSaved(st.path);
        }).catch(function () {});
      },
      onOpenFile: function (f) {
        loadInto(f.content, f.path, f.name);
      },
      onDropFile: insertDroppedFile,
      onSaveImage: savePastedImage,
      onWiki: openWiki,
      onOpenLink: openRelLink
    });

    $('btn-open-file').addEventListener('click', doOpenFile);
    $('btn-open-folder').addEventListener('click', doOpenFolder);
    $('btn-sidebar').addEventListener('click', toggleSidebar);

    $('tb-source').addEventListener('click', function () {
      if (Editor.isSplitMode()) Split.exit();
      Editor.toggleSource();
      syncSplitBtn();
    });
    $('tb-split').addEventListener('click', function () { toggleSplit(); });
    $('tb-focus').addEventListener('click', function () {
      var on = !Editor.isFocus();
      Editor.setFocus(on);
      $('tb-focus').classList.toggle('on', on);
    });
    $('tb-typewriter').addEventListener('click', function () {
      var on = !Editor.isTypewriter();
      Editor.setTypewriter(on);
      $('tb-typewriter').classList.toggle('on', on);
    });
    $('tb-export').addEventListener('click', openExportMenu);

    $('theme-select').addEventListener('change', function () { setThemeId(this.value); });
    $('sb-count').addEventListener('click', function (e) { e.stopPropagation(); toggleWc(); });
    document.addEventListener('mousedown', function (e) {
      if (wc.open && !e.target.closest('#wc-pop') && !e.target.closest('#sb-count')) toggleWc();
    }, true);

    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (b) {
      b.addEventListener('click', function () { switchPanel(b.getAttribute('data-panel')); });
    });

    var scroller = $('editor-scroll');
    scroller.addEventListener('scroll', function () {
      if (scrollTick) return;
      scrollTick = requestAnimationFrame(function () {
        scrollTick = null;
        syncOutlineByScroll();
      });
    });

    bindKeys();
    bindTabBar();
    initTranslate();
    initFind();
    if (window.Split) {
      Split.init();
      // 分栏里滚动时也收起翻译浮标
      $('split-src').addEventListener('scroll', hideSelBar);
      $('split-prev').addEventListener('scroll', hideSelBar);
    }
    renderTree();

    if (window.Workbench) {
      Workbench.init({
        notes: flatNotes,
        root: function () { return folderRoot; },
        current: function () { return currentPath; },
        open: function (p, start, len) { openPath(p, start, len); },
        reopen: function (p) { openPath(p); },
        reloadTree: function () { reloadFolder(true); },
        toast: toast,
        restoreDraft: function (dr) {
          loadInto(dr.content, dr.path || null, dr.name || '草稿.md');
          Editor.markDirty();
          toast('已恢复未保存的草稿');
        }
      });
    }

    // 偏好/主题初始化单独兜底：这里出问题不该把整个 UI（含命令表）拖死
    try {
      initPrefs();
      applyPrefs();
      setThemeId(curTheme());
      scanThemes();
    } catch (err) {
      console.warn('prefs init failed', err);
    }

    // 图片管理：右键菜单、⌘⌃I 插入、路径改写
    if (window.ImgMan) {
      ImgMan.init({
        Bridge: window.Bridge,
        getText: function () { return Editor.getText(); },
        docPath: function () { return currentPath; },
        getRaw: function (i) { return Editor.getRaw(i); },
        blockCount: function () { return Editor.blockCount(); },
        mapRaw: function (fn) { return Editor.mapRaw(fn); },
        insertBlocks: function (lines) { Editor.insertBlocks(lines); },
        touch: function () { Editor.markDirty(); },
        toast: toast,
        prompt: function (t, v) { return Workbench.prompt(t, v); },
        copyText: function (t) {
          if (window.Bridge && window.Bridge.available) window.Bridge.copy(t);
          else try { navigator.clipboard.writeText(t); } catch (err) {}
          toast('已复制');
        },
        confirm: function (m, i) {
          if (window.Bridge && window.Bridge.available) return window.Bridge.confirm(m, i);
          return Promise.resolve(window.confirm(m));
        }
      });
    }

    var oq = $('outline-q');
    if (oq) {
      oq.addEventListener('input', function () {
        outlineFilter = oq.value;
        renderOutline();
      });
    }

    // 上次退出时是不是分栏模式
    var restoreView = function () {
      var wantSplit = false;
      try { wantSplit = localStorage.getItem('opentypora.split') === '1'; } catch (err) {}
      if (wantSplit && window.Split) Split.enter();
      syncSplitBtn();
    };

    /* 第一篇文档也走标签页：即使只有一个标签（标签栏不显示），
     * 后面的 ⌘T / 打开文件才有「从哪儿切走」这回事。 */
    var bootDoc = function (content, path, name) {
      openTab(content, path, name || '欢迎.md');
      restoreView();
    };

    if (window.Bridge && window.Bridge.available) {
      window.Bridge.ready().then(function (info) {
        // 命令行/双击打开的那篇优先（用户的明确意图压过上次会话）
        if (info && info.file) {
          bootDoc(info.content, info.file, baseName(info.file));
          armSession();
          return;
        }
        return restoreSession().then(function (ok) {
          if (ok) { restoreView(); armSession(); return; }
          bootDoc(WELCOME, null, '欢迎.md');
          armSession();
        });
      }).catch(function () { bootDoc(WELCOME, null, '欢迎.md'); armSession(); });
    } else {
      bootDoc(WELCOME, null, '欢迎.md');
      armSession();
    }

  /* ------------------------------------------------ 导入（docx / html → md） */
  function safeStem(name) {
    return String(name || 'import').replace(/\.[^.]+$/, '')
      .replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'import';
  }

  function doImport() {
    // 导入现在是「再开一个标签」，不再需要为丢弃当前修改发问
    return window.Bridge.importFile().then(function (r) {
      if (!r) return;
      var stem = safeStem(r.name);
      toast('正在转换 ' + (r.name || '') + '…');
      return window.Importer.convert(r.ext, r.base64, {
        stem: stem,
        assetDir: 'assets/' + stem + '-media/'
      }).then(function (res) {
        var md = res.markdown || '';
        if (!md.trim()) { toast('这个文件里没有可转换的正文'); return; }
        var title = String(res.title || '').replace(/\s+/g, ' ').trim();

        if (res.assets && res.assets.length) {
          // 有内嵌图片：图片总得落到某个目录，所以先问存哪儿
          return window.Bridge.saveImport(stem + '.md', md, res.assets).then(function (rr) {
            if (!rr || !rr.path) { toast('已取消'); return; }
            loadInto(md, rr.path, baseName(rr.path));
            toast('已导入，' + res.assets.length + ' 张图片存到 assets/');
          });
        }

        // 纯文本：直接开成未命名文档，⌘S 再决定放哪儿
        loadInto(md, null, (title || stem) + '.md');
        toast('已转换为未命名文档（⌘S 保存）');
      });
    }).catch(function (e) {
      console.error(e);
      toast('导入失败：' + (e && e.message ? e.message : e));
    });
  }

  window.OpenTyporaCmd = {
      newDoc: doNew,
      newTab: newTab,
      setLivePreview: function (on) {
        pref.live = !!on; savePrefs(); applyPrefs();
        return Editor.isLivePreview();
      },
      closeTab: function () { return closeTab(tabsState.active); },
      closeTabById: closeTab,
      switchTab: switchTab,
      nextTab: function () { return cycleTab(1); },
      prevTab: function () { return cycleTab(-1); },
      tabInfo: function () {
        return window.Tabs ? {
          list: tabsState.list.map(function (t) {
            return { id: t.id, name: t.name, path: t.path, dirty: !!t.dirty };
          }),
          active: tabsState.active
        } : null;
      },
      open: doOpenFile,
      openPath: openPath,
      openFolder: doOpenFolder,
      importFile: doImport,
      reopenClosed: reopenClosed,
      saveSession: saveSessionNow,
      restoreSession: restoreSession,
      clearSession: clearSession,
      sessionRaw: function () {
        try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
      },
      undoFileOp: function () {
        if (window.Workbench && Workbench.canUndoFileOp()) Workbench.undoFileOp();
        else toast('没有可撤销的文件操作');
      },
      insertImage: function () { if (window.ImgMan) ImgMan.insertImages(); },
      moveImages: function () { if (window.ImgMan) ImgMan.moveAll(); },
      downloadImages: function () { if (window.ImgMan) ImgMan.downloadAll(); },
      openWiki: openWiki,
      listNotes: noteRecords,
      save: doSave,
      saveAs: doSaveAs,
      exportHTML: exportHTML,
      exportHTMLPlain: function () { exportHTML({ styles: false }); },
      htmlOptions: openHtmlOpts,
      exportPDF: exportPDF,
      pdfOptions: openPdfOpts,
      exportImage: exportImage,
      exportDocx: function () { exportDoc('docx'); },
      exportDoc: exportDoc,
      exportEpub: function () { exportDoc('epub'); },
      exportLatex: function () { exportDoc('tex'); },
      exportMenu: openExportMenu,
      toggleSidebar: toggleSidebar,
      translateSelection: translateSelection,
      find: function () { openFind(false); },
      findReplace: function () { openFind(true); },
      preferences: function () { openPrefs(); },
      toggleSplit: function () { toggleSplit(); },
      toggleSource: function () {
        if (Editor.isSplitMode()) Split.exit();
        Editor.toggleSource();
        syncSplitBtn();
      },
      toggleFocus: function () {
        var on = !Editor.isFocus();
        Editor.setFocus(on);
        $('tb-focus').classList.toggle('on', on);
      },
      toggleTypewriter: function () {
        var on = !Editor.isTypewriter();
        Editor.setTypewriter(on);
        $('tb-typewriter').classList.toggle('on', on);
      },
      toggleStrict: function () {
        pref.strict = !pref.strict;
        savePrefs();
        applyPrefs();
        var el = $('prefs-strict');
        if (el) el.checked = !!pref.strict;
        toast(pref.strict ? '已开启严格模式' : '已关闭严格模式');
      },
      handleExternalOpen: function (path) {
        if (!path) return;
        var p = String(path).replace(/\/+$/, '') || '/';
        var openFile = function () {
          window.Bridge.readFile(path).then(function (r) {
            loadInto(r.content, r.path, r.name);
          }).catch(function (e) { toast('打开失败：' + e.message); });
        };
        if (!window.Bridge || !window.Bridge.fsStat) { openFile(); return; }
        window.Bridge.fsStat(p).then(function (s) {
          if (s && s.isDir) openFolderPath(p);
          else openFile();
        }).catch(openFile);
      }
    };

    window.OpenTyporaUI = {
      openFile: doOpenFile,
      openFolder: doOpenFolder,
      importFile: doImport,
      reopenClosed: reopenClosed,
      undoFileOp: function () {
        if (window.Workbench && Workbench.canUndoFileOp()) Workbench.undoFileOp();
        else toast('没有可撤销的文件操作');
      },
      save: doSave,
      saveAs: doSaveAs,
      newDoc: doNew,
      exportHTML: exportHTML,
      exportHTMLPlain: function () { exportHTML({ styles: false }); },
      htmlOptions: openHtmlOpts,
      exportPDF: exportPDF,
      pdfOptions: openPdfOpts,
      exportImage: exportImage,
      exportDocx: function () { exportDoc('docx'); },
      exportDoc: exportDoc,
      exportEpub: function () { exportDoc('epub'); },
      exportLatex: function () { exportDoc('tex'); },
      exportMenu: openExportMenu,
      runCustomExport: function (cid) {
        var list = window.Xcmd ? Xcmd.norm(pref.exportCmds) : [];
        runCustomExport(cid || (list[0] && list[0].id));
      },
      toggleSidebar: toggleSidebar,
      toggleSplit: function () { toggleSplit(); },
      toast: toast
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
