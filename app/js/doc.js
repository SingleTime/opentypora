/* ============================================================
 * doc.js — 文档级装饰：标题锚点 / [TOC] 目录 / 脚注编号
 *
 * 为什么要有这一层：
 *   主编辑器按「块」独立 re-parse 再渲染（blockHTML → MD.parse(raw)），
 *   MD.renderBlock 拿不到整篇上下文，所以「同名标题去重」「脚注按出现顺序
 *   编号」「目录需要全文标题树」这些跨块信息没法在解析阶段算出来。
 *   统一放到渲染完成后的 DOM 后处理里做，主编辑器与分栏预览共用同一套。
 *
 * 约定：
 *   - .blk.hN  → 标题块，前面插一个 <span class="h-anchor" id="slug">
 *   - [TOC]    → 渲染成 <div class="toc-body" data-toc="1">，由本模块填充
 *   - sup.fn-ref[data-fn]      → 正文里的脚注角标
 *   - .fn-def .fn-num[data-fn-num] → 脚注定义块里的序号徽标
 * ============================================================ */
var Doc = (function () {
  'use strict';

  var CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff';
  var RE_CJK = new RegExp('[' + CJK + ']');
  var RE_STRIP = new RegExp('[^\\w' + CJK + '\\s-]', 'g');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* GitHub 风格 slug：小写、去掉标点、空白转 -、中文原样保留 */
  function slugify(text) {
    var t = String(text == null ? '' : text)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // 图片留 alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // 链接留文字
      .replace(/[`*_~=]/g, '')
      .trim()
      .toLowerCase()
      .replace(RE_STRIP, '')                       // 保留字母数字下划线中文
      .trim()
      .replace(/\s+/g, '-');
    return t || 'section';
  }

  /* 取标题的纯文本（排除锚点、目录正文这类装饰节点） */
  function textOf(el) {
    if (!el) return '';
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(
      c.querySelectorAll('.h-anchor, .toc-body, .fn-ref'),
      function (n) { if (n.parentNode) n.parentNode.removeChild(n); }
    );
    return String(c.textContent == null ? '' : c.textContent)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levelOf(el) {
    var m = /\bh([1-6])\b/.exec(el.className || '');
    return m ? +m[1] : 1;
  }

  /* ---------------------------------------------------------- 目录树 */
  function buildTree(items) {
    var root = { level: 0, children: [] }, stack = [root];
    items.forEach(function (it) {
      var node = { level: it.level, text: it.text, slug: it.slug, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    return root;
  }

  function treeHTML(node) {
    if (!node.children.length) return '';
    var h = '<ul>';
    node.children.forEach(function (c) {
      h += '<li><a class="toc-link" href="#' + esc(c.slug) + '" data-slug="' + esc(c.slug) + '">' +
        esc(c.text) + '</a>' + treeHTML(c) + '</li>';
    });
    return h + '</ul>';
  }

  function tocHTML(items) {
    if (!items.length) return '<div class="toc-empty">（文档里还没有标题）</div>';
    var min = 6;
    items.forEach(function (it) { if (it.level < min) min = it.level; });
    // 归一化：最高级标题当第 1 层，避免 h3 开头的文档整体右缩进
    var norm = items.map(function (it) { return { level: it.level - min + 1, text: it.text, slug: it.slug }; });
    return treeHTML(buildTree(norm));
  }

  /* ---------------------------------------------------------- 主流程 */
  function decorate(root) {
    var out = { headings: [], refs: [], defs: [] };
    if (!root || !root.querySelectorAll) return out;

    /* 1. 标题锚点：按文档顺序编号，同名加 -1 / -2 后缀 */
    var heads = Array.prototype.slice.call(
      root.querySelectorAll('.blk.h1, .blk.h2, .blk.h3, .blk.h4, .blk.h5, .blk.h6')
    );
    var used = {};
    heads.forEach(function (el) {
      var label = textOf(el);
      var base = slugify(label), slug = base, n = 1;
      while (used[slug]) { slug = base + '-' + (n++); }
      used[slug] = 1;

      var a = null;
      Array.prototype.forEach.call(el.children, function (c) {
        if (!a && c.classList && c.classList.contains('h-anchor')) a = c;
      });
      if (!a) a = el.querySelector('.h-anchor');
      if (!a) {
        a = document.createElement('span');
        a.className = 'h-anchor';
        el.insertBefore(a, el.firstChild);
      }
      a.id = slug;
      el.setAttribute('data-slug', slug);
      out.headings.push({ level: levelOf(el), text: label, slug: slug, el: el });
    });

    /* 2. [TOC] 目录 */
    Array.prototype.forEach.call(root.querySelectorAll('[data-toc]'), function (box) {
      box.innerHTML = tocHTML(out.headings);
      box.setAttribute('data-toc-done', '1');
    });

    /* 3. 脚注：正文角标按出现顺序重新编号（作者写的标号只作 id 用） */
    var num = {}, order = [];
    Array.prototype.forEach.call(root.querySelectorAll('.fn-ref'), function (r) {
      var id = r.getAttribute('data-fn') || '';
      if (!(id in num)) { order.push(id); num[id] = order.length; }
      var n = num[id];
      r.textContent = String(n);
      r.setAttribute('data-n', String(n));
      r.setAttribute('title', id);
      out.refs.push({ id: id, n: n, el: r });
    });

    /* 4. 脚注定义：补锚点 id 与序号徽标 */
    Array.prototype.forEach.call(root.querySelectorAll('.fn-def'), function (d) {
      var numEl = d.querySelector('.fn-num');
      var id = numEl ? (numEl.getAttribute('data-fn-num') || '') : '';
      if (id) d.id = 'fn-def-' + id;
      if (numEl && num[id]) numEl.textContent = String(num[id]);
      else if (numEl && id) numEl.textContent = id;   // 没人引用也照原样显示
      out.defs.push({ id: id, el: d });
    });

    /* 5. 角标悬停预览：把定义正文塞进 title，原生 tooltip 直接可用 */
    if (out.refs.length && out.defs.length) {
      var bodies = {};
      out.defs.forEach(function (d) {
        var t = d.el.querySelector('.fn-text');
        bodies[d.id] = t ? String(t.textContent || '').replace(/\s+/g, ' ').trim() : '';
      });
      out.refs.forEach(function (r) {
        var b = bodies[r.id];
        if (b) r.el.setAttribute('title', r.n + '. ' + b);
      });
    }

    /* 6. Mermaid 图表：懒加载 + 异步替换，失败不影响其它装饰 */
    try { if (window.Diagram) Diagram.renderAll(root); } catch (e) {}

    /* 7. flowchart.js 图表：纯函数同步出 SVG，语法错误就地显示 */
    try { if (window.Flow) Flow.renderAll(root); } catch (e) {}

    return out;
  }

  /* 点击内链 / 目录项 / 脚注角标时，在指定容器里滚动到目标 */
  function scrollTo(container, target, opts) {
    if (!container || !target) return false;
    var c = container.getBoundingClientRect();
    var t = target.getBoundingClientRect();
    var top = t.top - c.top + container.scrollTop - (opts && opts.center
      ? (container.clientHeight - t.height) / 2 : 12);
    try { container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
    catch (e) { container.scrollTop = Math.max(0, top); }
    // 高亮打在整块上：锚点是零尺寸 span，自己看不见
    var flashEl = target.closest ? (target.closest('.blk') || target) : target;
    flashEl.classList.remove('jump-flash');
    void flashEl.offsetWidth;              // 强制 reflow，让动画能重放
    flashEl.classList.add('jump-flash');
    setTimeout(function () { flashEl.classList.remove('jump-flash'); }, 900);
    return true;
  }

  function findAnchor(root, slug) {
    if (!root || !slug) return null;
    var safe = String(slug).replace(/["\\]/g, '\\$&');
    return root.querySelector('[id="' + safe + '"]');
  }

  return {
    slugify: slugify,
    decorate: decorate,
    tocHTML: tocHTML,
    scrollTo: scrollTo,
    findAnchor: findAnchor,
    textOf: textOf
  };
})();
