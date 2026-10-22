/* ============================================================
 * dropfile.js — 拖文件进编辑器：从 dataTransfer 里捞路径、决定链接目标
 *
 * 为什么单独一个模块：WKWebView 拿不到 `File.path`（那是 Electron 的私货），
 * 只能从 `text/uri-list` / `text/plain` 里抠 `file:///…`。这段解析与
 * 「有路径算相对、没路径就复制进 assets、都没有只能链文件名」的决策
 * 全是纯逻辑，放进 editor.js 里就没法单测了。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dropfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* dataTransfer 里可能出现的两种载荷 → { 文件名basename: 绝对路径 }。
   * 只认绝对路径（`/…` 或 `file:///…`），相对路径/URL 一律忽略。 */
  function pathsFrom(dt) {
    var out = {};
    if (!dt) return out;
    var grab = function (type) {
      try { return String(dt.getData(type) || ''); } catch (e) { return ''; }
    };
    [grab('text/uri-list'), grab('text/plain')].forEach(function (raw) {
      String(raw).split(/\r?\n/).forEach(function (line) {
        var s = line.trim();
        if (!s) return;
        if (/^file:\/\//i.test(s)) {
          s = s.replace(/^file:\/\//i, '');
          try { s = decodeURIComponent(s); } catch (e) {}
        } else if (s.charAt(0) !== '/') return;
        if (s === '/' || s.charAt(s.length - 1) === '/') return;
        var base = s.split('/').pop();
        if (base && !out[base]) out[base] = s;
      });
    });
    return out;
  }

  /* 插入计划。rel 是「算相对路径」的函数（Imgman.relPath），由调用方注入，
   * 这样这个模块不用依赖别的文件。
   *   { kind: 'rel'  | 'abs' | 'copy' | 'name', target } */
  function plan(o) {
    o = o || {};
    var name = String(o.name || 'file');
    var docDir = String(o.docDir || '');
    if (o.path) {
      if (docDir && typeof o.rel === 'function') {
        return { kind: 'rel', target: String(o.rel(docDir, o.path)) };
      }
      return { kind: 'abs', target: String(o.path) };
    }
    // 拿不到源路径：能读到文本又有落盘位置，就复制一份进 assets
    if (o.text != null && docDir && o.canCopy) return { kind: 'copy', target: '' };
    return { kind: 'name', target: name };
  }

  /* Markdown 链接：空格与圆括号要转义，否则 `[a](b c.md)` 解析不出来。
   * 中文不转义（Typora 也是原样写的，可读性更好）。 */
  function linkText(name, target) {
    var label = String(name == null ? '' : name).replace(/([\[\]\\])/g, '\\$1');
    var url = String(target == null ? '' : target)
      .replace(/ /g, '%20')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    return '[' + label + '](' + url + ')';
  }

  function isImage(f) {
    return !!(f && f.type && f.type.indexOf('image') === 0);
  }

  return {
    pathsFrom: pathsFrom,
    plan: plan,
    linkText: linkText,
    isImage: isImage
  };
});
