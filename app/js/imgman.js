/* imgman.js — 图片管理：路径解析 + 插入 / 重命名 / 移动 / 删除
 *
 * 纯函数部分（parseFront / imgDir / refs / rewrite / relPath / uniqueName …）
 * 不碰 DOM，可以直接在 Node 里 require 做单测。
 * UI 部分通过 init(adapter) 注入依赖，adapter 由 ui.js 提供。
 *
 * 路径语义（与社区通行约定一致）：
 *   - 默认：图片路径相对「文档所在目录」
 *   - `typora-copy-images-to: assets/x` → 新插入的图片落到该目录（相对路径按文档目录解析）
 *   - `typora-root-url: ./res`         → 正文里的相对图片路径按该目录解析（相对路径同上）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./md.js'));
  else root.ImgMan = factory(root.MD);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MD) {
  'use strict';

  /* ============================================================
   * 一、纯函数
   * ============================================================ */

  // http: / data: / file: / mailto: / //cdn / #anchor 都不是本地文件
  var REMOTE_RE = /^(?:[a-z][a-z0-9+.\-]*:|\/\/|#)/i;

  function isLocal(href) {
    if (href == null) return false;
    var s = String(href).trim();
    return !!s && !REMOTE_RE.test(s);
  }

  function isAbs(p) {
    var s = String(p || '');
    return s.charAt(0) === '/' || /^[A-Za-z]:[\\/]/.test(s);
  }

  function dirOf(p) {
    var s = String(p || '').replace(/\\/g, '/');
    var k = s.lastIndexOf('/');
    if (k < 0) return '';
    if (k === 0) return '/';
    return s.slice(0, k);
  }

  function baseOf(p) {
    var s = String(p || '').replace(/\\/g, '/');
    var k = s.lastIndexOf('/');
    return k < 0 ? s : s.slice(k + 1);
  }

  function extOf(p) {
    var b = baseOf(p);
    var k = b.lastIndexOf('.');
    return k > 0 ? b.slice(k) : '';
  }

  // 折叠 `.` 与 `..`；保留前导 `/`
  function normalize(p) {
    var s = String(p == null ? '' : p).replace(/\\/g, '/');
    var abs = s.charAt(0) === '/';
    var parts = s.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!abs) out.push('..');
        continue;
      }
      out.push(seg);
    }
    var r = out.join('/');
    if (abs) r = '/' + r;
    return r || (abs ? '/' : '');
  }

  function join(dir, rel) {
    var base = normalize(dir);
    var r = normalize(rel);
    if (!base) return r;
    if (isAbs(r)) return r;
    return normalize(base.replace(/\/+$/, '') + '/' + r);
  }

  // target 相对 fromDir；算不出相对（一侧是相对路径）时原样返回 target
  function relPath(fromDir, target) {
    var from = normalize(fromDir), to = normalize(target);
    if (!to) return '';
    if (!isAbs(to)) return to;
    if (!isAbs(from)) return to;
    var a = from.split('/').filter(Boolean);
    var b = to.split('/').filter(Boolean);
    var i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    var segs = [];
    for (var k = i; k < a.length; k++) segs.push('..');
    segs = segs.concat(b.slice(i));
    return segs.join('/') || baseOf(to);
  }

  var FRONT_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

  // 只读 front matter 里跟图片有关的两项，不做完整 YAML 解析
  function parseFront(src) {
    var out = { found: false, rootUrl: '', copyTo: '' };
    var m = FRONT_RE.exec(String(src == null ? '' : src));
    if (!m) return out;
    out.found = true;
    var lines = m[1].split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var mm = /^([A-Za-z0-9_][A-Za-z0-9_\-]*)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(lines[i]);
      if (!mm) continue;
      var key = mm[1].toLowerCase();
      var val = mm[2].replace(/^["']/, '').replace(/["']$/, '');
      if (key === 'typora-root-url') out.rootUrl = val;
      else if (key === 'typora-copy-images-to') out.copyTo = val;
    }
    return out;
  }

  // 新图片落盘目录（绝对路径）；文档没保存时返回空串
  function imgDir(docPath, copyTo) {
    var c = String(copyTo || '').trim();
    var docDir = docPath ? dirOf(docPath) : '';
    if (!c) return docDir ? join(docDir, 'assets') : '';
    if (isAbs(c)) return normalize(c);
    return docDir ? join(docDir, c) : normalize(c);
  }

  // root-url 解析成绝对目录；没配就是空
  function rootDir(docPath, rootUrl) {
    var r = String(rootUrl || '').trim();
    if (!r) return '';
    if (isAbs(r)) return normalize(r);
    var docDir = docPath ? dirOf(docPath) : '';
    return docDir ? join(docDir, r) : normalize(r);
  }

  // 文档里所有图片引用（复用 md.js 的解析，保证与渲染完全一致）
  function refs(raw) {
    var s = String(raw == null ? '' : raw);
    var out = [];
    var i = 0;
    while (i < s.length) {
      var k = s.indexOf('![', i);
      if (k < 0) break;
      if (k > 0 && s.charAt(k - 1) === '\\') { i = k + 2; continue; }
      var im = (MD && MD.readImage) ? MD.readImage(s, k) : null;
      if (im) {
        out.push({
          href: im.src, alt: im.alt, title: im.title, w: im.w, h: im.h,
          raw: im.raw, start: k, end: k + im.raw.length
        });
        i = k + im.raw.length;
      } else {
        i = k + 2;
      }
    }
    return out;
  }

  // 保留 alt / title / 尺寸，只换 href
  function refText(r, href) {
    var inner = String(href);
    if (/[\s()<>]/.test(inner)) inner = '<' + inner + '>';
    if (r.title) inner += ' "' + String(r.title).replace(/"/g, '\\"') + '"';
    if (r.w && r.h) inner += ' =' + r.w + 'x' + r.h;
    else if (r.w) inner += ' =' + r.w;
    else if (r.h) inner += ' =x' + r.h;
    return '![' + r.alt + '](' + inner + ')';
  }

  // map: { 旧 href: 新 href }；返回改写后的 raw（没有命中就原样返回）
  function rewrite(raw, map) {
    var s = String(raw == null ? '' : raw);
    var list = refs(s);
    var out = '', last = 0, hit = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var nv = map[r.href];
      if (nv == null || nv === r.href) continue;
      out += s.slice(last, r.start) + refText(r, nv);
      last = r.end;
      hit++;
    }
    return hit ? out + s.slice(last) : s;
  }

  // 目录里重名时自动加 -2 / -3；exists(name) → 布尔
  function uniqueName(name, exists) {
    var n = String(name || 'image.png');
    if (!exists || !exists(n)) return n;
    var ext = extOf(n);
    var stem = ext ? n.slice(0, n.length - ext.length) : n;
    for (var k = 2; k < 9999; k++) {
      var cand = stem + '-' + k + ext;
      if (!exists(cand)) return cand;
    }
    return stem + '-' + Date.now() + ext;
  }

  // 把引用转成「绝对路径」（用于桥操作磁盘）
  function absOf(href, ctx) {
    if (!isLocal(href)) return '';
    var h = String(href).trim();
    if (isAbs(h)) return normalize(h);
    var base = (ctx && ctx.root) ? ctx.root : (ctx ? ctx.docDir : '');
    if (!base) return normalize(h);
    return join(base, h);
  }

  // 把绝对路径转成「写进文档的引用」
  function hrefOf(abs, ctx) {
    var a = normalize(abs);
    var base = (ctx && ctx.root) ? ctx.root : (ctx ? ctx.docDir : '');
    if (!base) return a;
    return relPath(base, a);
  }

  // 文档级上下文：文档路径 + front matter 选项
  function context(docPath, src) {
    var fo = parseFront(src);
    var docDir = docPath ? dirOf(docPath) : '';
    return {
      docPath: docPath || '',
      docDir: docDir,
      rootUrl: fo.rootUrl,
      copyTo: fo.copyTo,
      root: rootDir(docPath, fo.rootUrl),
      dest: imgDir(docPath, fo.copyTo)
    };
  }

  /* ============================================================
   * 二、UI（依赖 adapter 注入，纯逻辑不上 DOM）
   * ============================================================ */

  var A = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function ctxNow() {
    return context(A.docPath(), A.getText());
  }

  /* ---- 右键菜单 -------------------------------------------------- */

  function showMenu(items, x, y) {
    var menu = $('ctxmenu');
    if (!menu) return;
    menu.innerHTML = items.map(function (it, k) {
      if (it === '—') return '<div class="ctx-sep"></div>';
      var dis = it[2] === 'off' ? ' disabled' : '';
      var dan = it[2] === 'danger' ? ' danger' : '';
      return '<button class="ctx-item' + dan + dis + '" data-k="' + k + '">' + esc(it[0]) + '</button>';
    }).join('');
    Array.prototype.forEach.call(menu.querySelectorAll('.ctx-item'), function (el) {
      el.addEventListener('click', function () {
        var it = items[+el.getAttribute('data-k')];
        hideMenu();
        if (it && it[1] && it[2] !== 'off') it[1]();
      });
    });
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.left = Math.min(x, (window.innerWidth || 1200) - 210) + 'px';
    menu.style.top = Math.min(y, (window.innerHeight || 800) - menu.offsetHeight - 10) + 'px';
  }

  function hideMenu() {
    var menu = $('ctxmenu');
    if (!menu) return;
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }

  // 从被点中的 <img> 找到它在哪个块、哪个偏移
  function locate(img) {
    var blk = img.closest ? img.closest('.blk') : null;
    if (!blk) return null;
    var bi = +blk.getAttribute('data-i');
    var raw = A.getRaw(bi) || '';
    var off = img.getAttribute('data-s');
    var href = img.getAttribute('src') || '';
    var list = refs(raw);
    var hit = null;
    if (off != null) {
      for (var i = 0; i < list.length; i++) if (list[i].start === +off) { hit = list[i]; break; }
    }
    if (!hit) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].href === href) { hit = list[j]; break; }
      }
    }
    return hit ? { block: bi, ref: hit, raw: raw } : null;
  }

  /* ---- 改写引用 -------------------------------------------------- */

  function applyMap(map) {
    if (!map || !Object.keys(map).length) return 0;
    var n = A.mapRaw(function (raw) { return rewrite(raw, map); });
    if (n) A.touch();
    return n;
  }

  /* ---- 重命名 ---------------------------------------------------- */

  function renameImage(loc) {
    var ctx = ctxNow();
    if (!ctx.docPath) { A.toast('请先保存文档，再管理图片'); return; }
    var abs = absOf(loc.ref.href, ctx);
    if (!abs) { A.toast('这是网络图片，改不了文件名'); return; }
    var old = baseOf(abs);
    var ext = extOf(old);
    var stem = ext ? old.slice(0, old.length - ext.length) : old;
    A.prompt('重命名图片（扩展名 ' + ext + ' 保持不变）', stem).then(function (name) {
      if (!name) return;
      var next = String(name).replace(/[\/\\]/g, '-');
      if (next === stem) return;
      if (ext && new RegExp(ext.replace(/\./g, '\\.') + '$', 'i').test(next)) next = next.slice(0, -ext.length);
      A.Bridge.fsRename(abs, next + ext).then(function (r) {
        var to = (r && r.path) || join(dirOf(abs), next + ext);
        var map = {};
        map[loc.ref.href] = hrefOf(to, ctx);
        applyMap(map);
        A.toast('已重命名为 ' + baseOf(to));
      }).catch(function (e) { A.toast('重命名失败：' + (e.message || e)); });
    });
  }

  /* ---- 移动 / 复制到指定文件夹 ----------------------------------- */

  function moveImage(loc, isCopy) {
    var ctx = ctxNow();
    if (!ctx.docPath) { A.toast('请先保存文档，再管理图片'); return; }
    var abs = absOf(loc.ref.href, ctx);
    if (!abs) { A.toast('这是网络图片，没法搬'); return; }
    A.Bridge.chooseFolder().then(function (dir) {
      if (!dir) return;
      var fn = isCopy ? A.Bridge.fsCopyTo : A.Bridge.fsMoveTo;
      return fn(abs, dir).then(function (r) {
        var to = (r && r.path) || join(dir, baseOf(abs));
        var map = {};
        map[loc.ref.href] = hrefOf(to, ctx);
        applyMap(map);
        A.toast((isCopy ? '已复制到 ' : '已移动到 ') + baseOf(to));
      });
    }).catch(function (e) { A.toast('操作失败：' + (e.message || e)); });
  }

  /* ---- 删除（引用 + 磁盘文件） ----------------------------------- */

  function deleteImage(loc) {
    var ctx = ctxNow();
    var abs = ctx.docPath ? absOf(loc.ref.href, ctx) : '';
    var msg = abs ? '删除这张图片？' : '删除这个图片引用？';
    var info = abs ? '文件会移到废纸篓：' + baseOf(abs) : '只删除正文里的引用';
    A.confirm(msg, info).then(function (ok) {
      if (!ok) return;
      var drop = function () {
        A.mapRaw(function (raw, i) {
          if (i !== loc.block) return null;
          return raw.slice(0, loc.ref.start) + raw.slice(loc.ref.end);
        });
        A.touch();
        A.toast('已删除图片');
      };
      if (!abs) { drop(); return; }
      A.Bridge.fsTrash(abs).then(drop).catch(function (e) {
        A.toast('删除文件失败：' + (e.message || e)); 
      });
    });
  }

  /* ---- 全部图片收进 assets --------------------------------------- */

  function collectAll() {
    var ctx = ctxNow();
    var out = [];
    var n = A.blockCount();
    for (var i = 0; i < n; i++) {
      var raw = A.getRaw(i) || '';
      var list = refs(raw);
      for (var k = 0; k < list.length; k++) {
        var r = list[k];
        if (!isLocal(r.href)) continue;
        var abs = absOf(r.href, ctx);
        if (!abs) continue;
        if (ctx.dest && dirOf(abs) === normalize(ctx.dest)) continue;  // 已经在目标目录
        out.push({ href: r.href, abs: abs });
      }
    }
    // 同一个文件被引用多次只搬一次
    var seen = {}, uniq = [];
    for (var j = 0; j < out.length; j++) {
      if (seen[out[j].abs]) continue;
      seen[out[j].abs] = 1;
      uniq.push(out[j]);
    }
    return uniq;
  }

  function moveAll() {
    var ctx = ctxNow();
    if (!ctx.docPath) { A.toast('请先保存文档，再整理图片'); return; }
    if (!ctx.dest) { A.toast('无法确定目标目录'); return; }
    var list = collectAll();
    if (!list.length) { A.toast('没有需要移动的图片'); return; }
    A.confirm('把 ' + list.length + ' 张图片移到 ' + relPath(ctx.docDir, ctx.dest) + '/ ？',
      '正文里的引用会同步改成相对路径；文件会被复制过去，原文件保留（不删）。').then(function (ok) {
      if (!ok) return;
      var map = {};
      var jobs = list.map(function (it) {
        return A.Bridge.fsCopyTo(it.abs, ctx.dest).then(function (r) {
          var to = (r && r.path) || join(ctx.dest, baseOf(it.abs));
          map[it.href] = hrefOf(to, ctx);
        }).catch(function () { /* 单张失败不影响其余 */ });
      });
      return Promise.all(jobs).then(function () {
        var k = applyMap(map);
        A.toast(k ? ('已整理 ' + k + ' 处图片引用') : '没有可改写的引用');
      });
    });
  }

  /* ---- 插入本地图片（⌘⌃I） --------------------------------------- */

  function insertImages() {
    if (!A.Bridge || !A.Bridge.pickImages) { A.toast('需要桌面版应用'); return; }
    var ctx = ctxNow();
    A.Bridge.pickImages().then(function (picked) {
      if (!picked || !picked.length) return;
      var jobs = picked.map(function (it) {
        return A.Bridge.imgImport(it.path, ctx.docPath, ctx.copyTo || '')
          .then(function (r) { return (r && r.path) || it.path; });
      });
      return Promise.all(jobs).then(function (paths) {
        var lines = paths.map(function (p) {
          // 路径里有空格/括号时用 <…> 包住，否则 Markdown 会把它截断
          return refText({ alt: '', title: '', w: 0, h: 0 }, hrefOf(p, ctx));
        });
        A.insertBlocks(lines);
        A.touch();
        A.toast('已插入 ' + lines.length + ' 张图片');
      });
    }).catch(function (e) { A.toast('插入失败：' + (e.message || e)); });
  }

  /* ---- 下载远程图片 ---------------------------------------------- */

  function isRemote(href) {
    return /^https?:\/\//i.test(String(href == null ? '' : href).trim());
  }

  // 从 URL 推一个本地文件名：去 query/hash、去非法字符、没扩展名就按 .png
  function downloadName(href) {
    var u = String(href || '').split('#')[0].split('?')[0];
    var base = u.split('/').pop() || '';
    try { base = decodeURIComponent(base); } catch (e) {}
    base = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base) base = 'image';
    if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.png';
    return base;
  }

  function remoteRefs(raw) {
    return refs(raw).filter(function (r) { return isRemote(r.href); });
  }

  function downloadOne(href, ctx) {
    return A.Bridge.imgFetch(href, ctx.docPath, ctx.dest || '', downloadName(href))
      .then(function (r) {
        if (!r || !r.path) throw new Error('下载后没有拿到文件路径');
        return r.path;
      });
  }

  function downloadImage(loc) {
    var ctx = ctxNow();
    if (!ctx.docPath) { A.toast('请先保存文档，再下载图片'); return; }
    if (!isRemote(loc.ref.href)) { A.toast('这张图片已经在本地'); return; }
    A.toast('正在下载 ' + downloadName(loc.ref.href) + '…');
    downloadOne(loc.ref.href, ctx).then(function (path) {
      var map = {};
      map[loc.ref.href] = hrefOf(path, ctx);
      var n = applyMap(map);
      A.toast(n ? ('已下载到 ' + relPath(ctx.docDir, dirOf(path)) + '/') : '已下载（没有找到可改写的引用）');
    }).catch(function (e) {
      A.toast('下载失败：' + (e && e.message ? e.message : e));
    });
  }

  function collectRemote() {
    var out = [], seen = {};
    var n = A.blockCount();
    for (var i = 0; i < n; i++) {
      var list = remoteRefs(A.getRaw(i) || '');
      for (var k = 0; k < list.length; k++) {
        var h = list[k].href;
        if (seen[h]) continue;
        seen[h] = 1;
        out.push(h);
      }
    }
    return out;
  }

  function downloadAll() {
    var ctx = ctxNow();
    if (!ctx.docPath) { A.toast('请先保存文档，再下载图片'); return; }
    var list = collectRemote();
    if (!list.length) { A.toast('文档里没有远程图片'); return; }
    var where = ctx.dest ? relPath(ctx.docDir, ctx.dest) : 'assets';
    A.confirm('下载 ' + list.length + ' 张远程图片？',
      '存到 ' + where + '/，正文里的引用会改成相对路径。').then(function (ok) {
      if (!ok) return;
      var map = {}, done = 0, bad = [];
      A.toast('正在下载 1/' + list.length + '…');
      var chain = Promise.resolve();
      list.forEach(function (href, idx) {
        chain = chain.then(function () {
          return downloadOne(href, ctx).then(function (p) {
            map[href] = hrefOf(p, ctx);
            done++;
            if (idx + 1 < list.length) A.toast('正在下载 ' + (idx + 2) + '/' + list.length + '…');
          }).catch(function () { bad.push(href); });
        });
      });
      return chain.then(function () {
        var n = applyMap(map);
        A.toast('已下载 ' + done + ' 张' +
          (bad.length ? '（' + bad.length + ' 张失败）' : '') +
          (n ? '，改写 ' + n + ' 处引用' : ''));
      });
    });
  }

  /* ---- 右键入口 -------------------------------------------------- */

  function menuFor(img, x, y) {
    var loc = locate(img);
    if (!loc) return;
    var ctx = ctxNow();
    var abs = absOf(loc.ref.href, ctx);
    var remote = !abs;
    showMenu([
      ['打开图片', function () {
        if (remote) A.Bridge.openUrl(loc.ref.href);
        else A.Bridge.openUrl(abs);
      }, remote && !/^file:/i.test(loc.ref.href) ? 'off' : ''],
      ['在 Finder 中显示', function () { A.Bridge.reveal(abs); }, remote ? 'off' : ''],
      ['复制路径', function () { A.copyText(abs || loc.ref.href); }, ''],
      ['复制 Markdown', function () { A.copyText(loc.ref.raw); }, ''],
      '—',
      ['下载到本地…', function () { downloadImage(loc); }, isRemote(loc.ref.href) ? '' : 'off'],
      '—',
      ['重命名图片…', function () { renameImage(loc); }, remote ? 'off' : ''],
      ['移动到文件夹…', function () { moveImage(loc, false); }, remote ? 'off' : ''],
      ['复制到文件夹…', function () { moveImage(loc, true); }, remote ? 'off' : ''],
      '—',
      ['删除图片（移到废纸篓）', function () { deleteImage(loc); }, 'danger']
    ], x, y);
  }

  function bind() {
    document.addEventListener('contextmenu', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (!t.closest || !t.closest('#editor')) return;
      e.preventDefault();
      e.stopPropagation();
      menuFor(t, e.clientX, e.clientY);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey && e.ctrlKey) || String(e.key).toLowerCase() !== 'i') return;
      e.preventDefault();
      e.stopPropagation();
      insertImages();
    }, true);
  }

  function init(adapter) {
    A = adapter;
    if (A && A.Bridge) bind();
  }

  return {
    // 纯函数
    isLocal: isLocal,
    isAbs: isAbs,
    dirOf: dirOf,
    baseOf: baseOf,
    extOf: extOf,
    normalize: normalize,
    join: join,
    relPath: relPath,
    parseFront: parseFront,
    imgDir: imgDir,
    rootDir: rootDir,
    refs: refs,
    refText: refText,
    rewrite: rewrite,
    uniqueName: uniqueName,
    absOf: absOf,
    hrefOf: hrefOf,
    context: context,
    isRemote: isRemote,
    downloadName: downloadName,
    remoteRefs: remoteRefs,
    // UI
    init: init,
    insertImages: insertImages,
    moveAll: moveAll,
    downloadAll: downloadAll,
    menuFor: menuFor
  };
});
