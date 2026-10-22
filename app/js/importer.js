/* ============================================================
 * importer.js — .docx / .html → Markdown（纯 JS，无 pandoc / 无 npm）
 *
 * 为什么自己写：
 *   · pandoc 120 MB，塞不进这个 app；
 *   · turndown / mammoth 都是 npm 包，这个项目全程零依赖（连 mermaid
 *     都是手写懒加载），而且它们默认产物会带一堆行内 HTML。
 *
 * 三层：
 *   1. 标记解析器    HTML 与 OOXML 共用（XML 模式：区分大小写、自闭合、
 *                    不做 HTML 的隐式闭合与 void 元素）
 *   2. HTML → MD     按 DOM 树走一遍，容器块展开、行内的收敛成 md 语法
 *   3. DOCX → MD     解 zip（store 直接用，deflate 走 DecompressionStream）
 *                    → 读 document.xml / styles.xml / numbering.xml / rels
 *                    → 按 WordprocessingML 语义映射到 md
 *
 * 设计取舍：
 *   · 只产 GFM + 本编辑器已有的扩展语法（`=WxH` 图片尺寸、`[^n]` 脚注），
 *     不产「只有 Typora 认识」的东西，导出的 md 在 GitHub 上也能看。
 *   · 表达不了的元素（<svg>、<details>、<video>…）原样保留成 HTML 块 ——
 *     本编辑器已经能渲染 HTML 块，保真优先于「纯 Markdown」洁癖。
 *   · 不认识的 Word 结构一律忽略，不猜。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Importer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }
  var MDm = null, Zipm = null;
  function md() { if (!MDm) MDm = dep('md', 'MD'); return MDm; }
  function zip() { if (!Zipm) Zipm = dep('zip', 'Zip'); return Zipm; }

  var TD = (typeof TextDecoder !== 'undefined') ? TextDecoder : null;

  function dec(bytes, enc) {
    try { return new TD(enc || 'utf-8').decode(bytes); }
    catch (e) { return new TD('utf-8').decode(bytes); }
  }

  function repeat(s, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  }

  /* ============================================================
   * 1. 实体
   * ============================================================ */
  var ENT = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    ensp: ' ', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0',
    plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', minus: '\u2212',
    middot: '\u00b7', bull: '\u2022', hellip: '\u2026', prime: '\u2032',
    ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
    sbquo: '\u201a', bdquo: '\u201e', dagger: '\u2020', Dagger: '\u2021',
    sect: '\u00a7', para: '\u00b6', permil: '\u2030', euro: '\u20ac',
    pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', curren: '\u00a4',
    frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
    sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3',
    larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
    harr: '\u2194', rArr: '\u21d2', hArr: '\u21d4',
    le: '\u2264', ge: '\u2265', ne: '\u2260', asymp: '\u2248', equiv: '\u2261',
    infin: '\u221e', sum: '\u2211', prod: '\u220f', radic: '\u221a',
    part: '\u2202', nabla: '\u2207', isin: '\u2208', notin: '\u2209',
    cap: '\u2229', cup: '\u222a', forall: '\u2200', exist: '\u2203',
    alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4',
    epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8',
    lambda: '\u03bb', mu: '\u03bc', pi: '\u03c0', rho: '\u03c1',
    sigma: '\u03c3', tau: '\u03c4', phi: '\u03c6', chi: '\u03c7',
    psi: '\u03c8', omega: '\u03c9', Delta: '\u0394', Sigma: '\u03a3',
    Omega: '\u03a9', Pi: '\u03a0', Lambda: '\u039b', Theta: '\u0398',
    loz: '\u25ca', spades: '\u2660', clubs: '\u2663', hearts: '\u2665', diams: '\u2666'
  };

  function decodeEnt(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{0,31});/g, function (m, g) {
      if (g[0] === '#') {
        var cp = (g[1] === 'x' || g[1] === 'X')
          ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        if (cp > 0 && cp <= 0x10ffff) {
          try { return String.fromCodePoint(cp); } catch (e) { return m; }
        }
        return m;
      }
      var v = ENT[g];
      return v == null ? m : v;
    });
  }

  /* ============================================================
   * 2. 标记解析（HTML / XML 共用）
   * ============================================================ */
  var VOID = {
    area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
    keygen: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
  };

  // 内容不按标记解析的元素
  var RAWTEXT = { script: 1, style: 1, textarea: 1, title: 1, xmp: 1, plaintext: 1 };

  var BLOCK_SET = {
    html: 1, body: 1, head: 1, title: 1, meta: 1, link: 1, base: 1,
    address: 1, article: 1, aside: 1, blockquote: 1, center: 1, caption: 1,
    dd: 1, details: 1, dialog: 1, dir: 1, div: 1, dl: 1, dt: 1, fieldset: 1,
    figcaption: 1, figure: 1, footer: 1, form: 1, h1: 1, h2: 1, h3: 1,
    h4: 1, h5: 1, h6: 1, header: 1, hgroup: 1, hr: 1, li: 1, main: 1,
    menu: 1, nav: 1, ol: 1, p: 1, pre: 1, section: 1, summary: 1, table: 1,
    tbody: 1, td: 1, tfoot: 1, th: 1, thead: 1, tr: 1, ul: 1,
    iframe: 1, video: 1, audio: 1, canvas: 1, svg: 1, math: 1, object: 1,
    picture: 1, style: 1, script: 1, noscript: 1, template: 1
  };

  // 起新块时会自动闭合的元素
  var AUTO_CLOSE = {
    li: { li: 1 },
    p: { p: 1 },
    td: { td: 1, th: 1 },
    th: { td: 1, th: 1 },
    tr: { tr: 1, td: 1, th: 1 },
    thead: { tr: 1, td: 1, th: 1 },
    tbody: { tr: 1, td: 1, th: 1 },
    tfoot: { tr: 1, td: 1, th: 1 },
    option: { option: 1 },
    dt: { dt: 1, dd: 1 },
    dd: { dt: 1, dd: 1 }
  };

  var DROP = {
    head: 1, title: 1, meta: 1, link: 1, base: 1, style: 1, script: 1,
    template: 1, noscript: 1, param: 1, source: 1, track: 1
  };

  function findTagEnd(src, from) {
    var q = 0;
    for (var i = from; i < src.length; i++) {
      var c = src.charCodeAt(i);
      if (q) { if (c === q) q = 0; continue; }
      if (c === 34 || c === 39) { q = c; continue; }
      if (c === 62) return i;
    }
    return -1;
  }

  var ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  function parseTagBody(body, xml) {
    var m = /^\s*([^\s\/>]+)/.exec(body);
    if (!m) return null;
    var name = xml ? m[1] : m[1].toLowerCase();
    var attrs = {}, rest = body.slice(m[0].length), a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(rest))) {
      var k = xml ? a[1] : a[1].toLowerCase();
      if (k === '/') continue;
      var v = a[2] != null ? a[2] : (a[3] != null ? a[3] : (a[4] != null ? a[4] : ''));
      attrs[k] = decodeEnt(v);
    }
    return { name: name, attrs: attrs, selfClose: /\/\s*$/.test(body) };
  }

  // 返回 {tag:'#root', kids:[...]}；节点形如 {tag, attrs, kids} 或 {tag:'#text', text}
  function parseMarkup(src, opt) {
    opt = opt || {};
    var xml = !!opt.xml;
    var rootNode = { tag: '#root', attrs: {}, kids: [] };
    var stack = [rootNode];
    var i = 0, n = src.length;

    function top() { return stack[stack.length - 1]; }
    function addText(s) {
      if (s === '') return;
      var p = top(), last = p.kids[p.kids.length - 1];
      if (last && last.tag === '#text') last.text += s;
      else p.kids.push({ tag: '#text', text: s });
    }

    while (i < n) {
      var lt = src.indexOf('<', i);
      if (lt < 0) { addText(decodeEnt(src.slice(i))); break; }
      if (lt > i) addText(decodeEnt(src.slice(i, lt)));

      if (src.substr(lt, 4) === '<!--') {
        var ce = src.indexOf('-->', lt + 4);
        i = ce < 0 ? n : ce + 3; continue;
      }
      if (src.substr(lt, 9) === '<![CDATA[') {
        var de = src.indexOf(']]>', lt + 9);
        addText(src.slice(lt + 9, de < 0 ? n : de));
        i = de < 0 ? n : de + 3; continue;
      }
      if (src[lt + 1] === '!' || src[lt + 1] === '?') {
        var ge = src.indexOf('>', lt);
        i = ge < 0 ? n : ge + 1; continue;
      }
      if (src[lt + 1] === '/') {
        var gt = src.indexOf('>', lt);
        if (gt < 0) { addText('<'); i = lt + 1; continue; }
        var nm = src.slice(lt + 2, gt).replace(/\s[\s\S]*$/, '');
        var endName = xml ? nm : nm.toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tag === endName) { stack.length = k; break; }
        }
        i = gt + 1; continue;
      }

      var te = findTagEnd(src, lt + 1);
      if (te < 0) { addText('<'); i = lt + 1; continue; }
      var info = parseTagBody(src.slice(lt + 1, te), xml);
      if (!info) { addText('<'); i = lt + 1; continue; }
      var tag = info.name;
      i = te + 1;

      if (!xml) {
        while (stack.length > 1) {
          var tp = stack[stack.length - 1].tag;
          if (AUTO_CLOSE[tag] && AUTO_CLOSE[tag][tp]) { stack.pop(); continue; }
          if (BLOCK_SET[tag] && tp === 'p') { stack.pop(); continue; }
          break;
        }
      }

      var node = { tag: tag, attrs: info.attrs, kids: [] };
      top().kids.push(node);

      if (xml ? info.selfClose : (info.selfClose || VOID[tag])) continue;

      stack.push(node);

      if (!xml && RAWTEXT[tag]) {
        var lower = src.toLowerCase();
        var close = lower.indexOf('</' + tag, i);
        var raw = src.slice(i, close < 0 ? n : close);
        if (tag === 'script' || tag === 'style') {
          node.kids.push({ tag: '#text', text: raw });
        } else {
          addText(decodeEnt(raw));
        }
        if (close < 0) { i = n; }
        else {
          var cgt = src.indexOf('>', close);
          i = cgt < 0 ? n : cgt + 1;
        }
        stack.pop();
      }
    }
    return rootNode;
  }

  /* ---------------------------------------------------------- 树工具 */
  function ln(tag) {
    if (!tag) return '';
    var k = tag.indexOf(':');
    return k < 0 ? tag : tag.slice(k + 1);
  }

  function each(node, fn) {
    var kids = node.kids || [];
    for (var i = 0; i < kids.length; i++) fn(kids[i], i);
  }

  function findAll(node, name, out) {
    out = out || [];
    each(node, function (n) {
      if (n.tag === '#text') return;
      if (n.tag === name || ln(n.tag) === name) out.push(n);
      findAll(n, name, out);
    });
    return out;
  }

  function first(node, name) {
    return findAll(node, name, [])[0] || null;
  }

  function child(node, name) {
    var kids = (node && node.kids) || [];
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.tag !== '#text' && (n.tag === name || ln(n.tag) === name)) return n;
    }
    return null;
  }

  function textOf(node) {
    if (!node) return '';
    if (node.tag === '#text') return node.text || '';
    var s = '';
    each(node, function (k) { s += textOf(k); });
    return s;
  }

  /* ============================================================
   * 3. HTML → Markdown
   * ============================================================ */

  // 原样保留成 HTML 块（md 里没有对应语法，硬转反而丢信息）
  var RAW_BLOCK = {
    svg: 1, math: 1, video: 1, audio: 1, iframe: 1, canvas: 1, object: 1,
    embed: 1, picture: 1, details: 1, form: 1, map: 1, frameset: 1
  };

  var BR = '\u0001';      // 行内换行占位符，出块时统一变成 "  \n"（表格里变 <br>）

  // md 没有上/下标语法，能整体的映射成 Unicode 上/下标字符就映射，
  // 映射不了（公式里的变量名之类）就退化成普通文字 —— 至少不留下源码噪音
  var SUP_MAP = {
    '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074',
    '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
    '+': '\u207a', '-': '\u207b', '=': '\u207c', '(': '\u207d', ')': '\u207e',
    'n': '\u207f', 'i': '\u2071'
  };
  var SUB_MAP = {
    '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
    '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
    '+': '\u208a', '-': '\u208b', '=': '\u208c', '(': '\u208d', ')': '\u208e'
  };

  function scriptText(s, map) {
    s = String(s == null ? '' : s);
    if (!s) return s;
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = map[s[i]];
      if (ch == null) return s;      // 有一个字符映射不了就整段放弃，别半上半下
      out += ch;
    }
    return out;
  }

  function mdEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\\`*_\[\]<]/g, '\\$&')
      .replace(/&(?=[a-zA-Z#])/g, '\\&');
  }

  function collapseWS(s) {
    return String(s == null ? '' : s).replace(/[\t\r\n\f]+/g, ' ');
  }

  function inlineText(s) {
    return mdEsc(collapseWS(s));
  }

  function codeSpan(s) {
    s = String(s == null ? '' : s);
    var runs = s.match(/`+/g) || [];
    var max = 0;
    for (var i = 0; i < runs.length; i++) if (runs[i].length > max) max = runs[i].length;
    var fence = repeat('`', max + 1);
    if (/^`|`$/.test(s) || /^\s/.test(s) || /\s$/.test(s)) s = ' ' + s + ' ';
    return fence + s + fence;
  }

  function wrapInline(m, inner) {
    if (!inner) return '';
    var lead = /^[ \t]*/.exec(inner)[0];
    var trail = /[ \t]*$/.exec(inner)[0];
    var core = inner.slice(lead.length, inner.length - trail.length);
    if (!core) return lead + trail;
    return lead + m + core + m + trail;
  }

  function pxOf(v) {
    if (v == null) return 0;
    var m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(v));
    return m ? Math.round(parseFloat(m[1])) : 0;
  }

  function imageMD(nd) {
    var a = nd.attrs || {};
    var src = a.src || '';
    if (!src) return '';
    var alt = mdEsc(a.alt != null ? a.alt : '');
    var w = pxOf(a.width), h = pxOf(a.height);
    var dest = /[\s()<>]/.test(src) ? '<' + src.replace(/>/g, '%3E') + '>' : src;
    var title = a.title ? ' "' + String(a.title).replace(/"/g, '\\"') + '"' : '';
    var size = (w || h) ? ' =' + (w || '') + 'x' + (h || '') : '';
    return '![' + alt + '](' + dest + title + size + ')';
  }

  function linkMD(nd, ctx) {
    var a = nd.attrs || {};
    var href = a.href || '';
    var text = trimInline(inlineOf(nd.kids, ctx)) || href;
    if (!href || /^\s*javascript:/i.test(href)) return text;
    var dest = /[\s()<>]/.test(href) ? '<' + href.replace(/>/g, '%3E') + '>' : href;
    var title = a.title ? ' "' + String(a.title).replace(/"/g, '\\"') + '"' : '';
    return '[' + text + '](' + dest + title + ')';
  }

  function trimInline(s) {
    return String(s == null ? '' : s)
      .replace(/^[ \t\n\u0001]+/, '')
      .replace(/[ \t\n\u0001]+$/, '');
  }

  function finalizeBlock(s) {
    return String(s == null ? '' : s)
      .replace(/[ \t]+$/gm, '')        // 先削行尾空白（源码里的缩进尾巴）
      .replace(/\u0001/g, '  \n')      // 再把行内换行变成硬换行，否则刚加的两格又被削掉
      .replace(/^[ \t]+/, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function serializeHTML(nd) {
    if (nd.tag === '#text') {
      return String(nd.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }
    var tag = nd.tag, a = nd.attrs || {}, out = '<' + tag;
    for (var k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      out += ' ' + k + '="' + String(a[k]).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
    }
    if (!nd.kids.length) return out + (VOID[tag] ? '>' : '></' + tag + '>');
    out += '>';
    each(nd, function (k2) { out += serializeHTML(k2); });
    return out + '</' + tag + '>';
  }

  /* ---------------------------------------------------------- 行内 */
  function inlineOf(nodes, ctx) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.tag === '#text') { out += inlineText(nd.text); continue; }
      var t = nd.tag;
      if (DROP[t]) continue;
      switch (t) {
        case 'br': out += BR; break;
        case 'wbr': break;
        case 'strong': case 'b':
          out += wrapInline('**', inlineOf(nd.kids, ctx)); break;
        case 'em': case 'i': case 'cite': case 'var':
          out += wrapInline('*', inlineOf(nd.kids, ctx)); break;
        case 'del': case 's': case 'strike':
          out += wrapInline('~~', inlineOf(nd.kids, ctx)); break;
        case 'code': case 'tt':
          out += codeSpan(textOf(nd).replace(/\s+/g, ' ')); break;
        case 'kbd': case 'samp':
          out += codeSpan(textOf(nd).replace(/\s+/g, ' ')); break;
        case 'a': out += linkMD(nd, ctx); break;
        case 'img': out += imageMD(nd); break;
        case 'u': case 'ins':
          out += inlineOf(nd.kids, ctx); break;
        case 'sup': out += scriptText(inlineOf(nd.kids, ctx), SUP_MAP); break;
        case 'sub': out += scriptText(inlineOf(nd.kids, ctx), SUB_MAP); break;
        case 'mark': out += inlineOf(nd.kids, ctx); break;
        case 'q': out += '\u201c' + inlineOf(nd.kids, ctx) + '\u201d'; break;
        case 'abbr': case 'dfn': case 'small': case 'big': case 'font':
        case 'span': case 'label': case 'time': case 'bdi': case 'bdo':
        case 'ruby': case 'rt': case 'rp': case 'output':
          out += inlineOf(nd.kids, ctx); break;
        case 'input': break;
        case 'svg': case 'math': case 'video': case 'audio': case 'iframe':
        case 'canvas': case 'object': case 'picture': case 'embed': case 'map':
          out += serializeHTML(nd); break;
        default:
          out += inlineOf(nd.kids, ctx);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------- 块 */
  function blocksOf(nodes, ctx) {
    var out = [], run = [];

    function flush() {
      if (!run.length) return;
      var s = finalizeBlock(inlineOf(run, ctx));
      run = [];
      if (s) out.push(s);
    }

    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.tag === '#text') { run.push(nd); continue; }
      if (DROP[nd.tag]) continue;
      if (BLOCK_SET[nd.tag] || RAW_BLOCK[nd.tag]) {
        flush();
        var got = blockOf(nd.tag, nd, ctx);
        for (var k = 0; k < got.length; k++) if (got[k]) out.push(got[k]);
      } else {
        run.push(nd);
      }
    }
    flush();
    return out;
  }

  function blockOf(t, nd, ctx) {
    switch (t) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        var s = trimInline(inlineOf(nd.kids, ctx)).replace(/\u0001/g, ' ');
        return s ? [repeat('#', +t[1]) + ' ' + s] : [];
      }
      case 'p': case 'summary': case 'dt': case 'dd': case 'figcaption': {
        var p = finalizeBlock(inlineOf(nd.kids, ctx));
        if (!p) return [];
        if (t === 'dt') return ['**' + trimInline(p) + '**'];
        if (t === 'dd') return [p];
        return [p];
      }
      case 'hr': return ['---'];
      case 'pre': return [codeBlockOf(nd)];
      case 'blockquote': {
        var inner = blocksOf(nd.kids, ctx).join('\n\n');
        if (!inner) return [];
        return [inner.split('\n').map(function (l) {
          return l ? '> ' + l : '>';
        }).join('\n')];
      }
      case 'ul': case 'ol': return [listOf(nd, ctx)];
      case 'table': return tableOf(nd, ctx);
      case 'dl': return blocksOf(nd.kids, ctx);
      case 'img': {
        var im = imageMD(nd);
        return im ? [im] : [];
      }
      case 'figure': case 'body': case 'html': case 'main': case 'article':
      case 'section': case 'div': case 'header': case 'footer': case 'nav':
      case 'aside': case 'center': case 'address': case 'fieldset':
      case 'hgroup': case 'menu': case 'dialog': case 'dir': case 'caption':
      case 'thead': case 'tbody': case 'tfoot': case 'tr': case 'td': case 'th':
      case 'li':
        return blocksOf(nd.kids, ctx);
    }
    if (RAW_BLOCK[t]) return [serializeHTML(nd)];
    return blocksOf(nd.kids, ctx);
  }

  function codeBlockOf(pre) {
    var codeEl = child(pre, 'code') || pre;
    var cls = (codeEl.attrs && codeEl.attrs['class']) || (pre.attrs && pre.attrs['class']) || '';
    var m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls);
    var lang = m ? m[1] : '';
    var text = textOf(codeEl).replace(/\r\n?/g, '\n');
    text = text.replace(/^\n+/, '').replace(/\n+$/, '');
    var runs = text.match(/`{3,}/g) || [];
    var max = 2;
    for (var i = 0; i < runs.length; i++) if (runs[i].length > max) max = runs[i].length;
    var fence = repeat('`', max + 1);
    return fence + lang + '\n' + text + '\n' + fence;
  }

  function listOf(nd, ctx) {
    var ordered = nd.tag === 'ol';
    var start = parseInt((nd.attrs && nd.attrs.start) || '1', 10);
    if (!isFinite(start)) start = 1;

    var items = [];
    (function collect(node) {
      each(node, function (n) {
        if (n.tag === '#text') return;
        if (n.tag === 'li') items.push(n);
        else if (n.tag === 'ul' || n.tag === 'ol' || n.tag === 'table' || n.tag === 'pre') return;
        else collect(n);
      });
    })(nd);

    var lines = [];
    for (var idx = 0; idx < items.length; idx++) {
      var li = items[idx];
      var task = null;
      (function findTask(node) {
        each(node, function (n) {
          if (task !== null) return;
          if (n.tag === 'input' && String(n.attrs.type || '').toLowerCase() === 'checkbox') {
            task = ('checked' in n.attrs) || n.attrs.checked === 'checked';
            return;
          }
          if (n.tag !== 'ul' && n.tag !== 'ol') findTask(n);
        });
      })(li);

      var bs = blocksOf(li.kids, ctx);
      var body = bs.join('\n');
      if (task !== null) body = '[' + (task ? 'x' : ' ') + '] ' + body;

      var marker = ordered ? (start + idx) + '.' : '-';
      var pad = repeat(' ', marker.length + 1);
      var parts = body.split('\n');
      lines.push(marker + ' ' + (parts[0] || ''));
      for (var i2 = 1; i2 < parts.length; i2++) {
        lines.push(parts[i2] ? pad + parts[i2] : '');
      }
    }
    return lines.join('\n');
  }

  function tableOf(nd, ctx) {
    var rows = [];
    (function collect(node) {
      each(node, function (n) {
        if (n.tag === '#text') return;
        if (n.tag === 'tr') { rows.push(n); return; }
        if (n.tag === 'table' && n !== nd) return;
        collect(n);
      });
    })(nd);
    if (!rows.length) return [];

    var grid = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = [], aligns = [];
      each(rows[i], function (n) {
        if (n.tag !== 'td' && n.tag !== 'th') return;
        cells.push(cellText(n, ctx));
        var al = (n.attrs.align || '');
        if (!al) {
          var st = /text-align\s*:\s*(left|right|center)/i.exec(n.attrs.style || '');
          if (st) al = st[1];
        }
        aligns.push(String(al).toLowerCase());
      });
      grid.push({ cells: cells, aligns: aligns });
    }

    var cols = 0;
    for (var r = 0; r < grid.length; r++) if (grid[r].cells.length > cols) cols = grid[r].cells.length;
    if (!cols) return [];

    for (var r2 = 0; r2 < grid.length; r2++) {
      while (grid[r2].cells.length < cols) grid[r2].cells.push('');
      while (grid[r2].aligns.length < cols) grid[r2].aligns.push('');
    }

    var model = {
      head: grid[0].cells,
      aligns: grid[0].aligns.map(function (a) {
        return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'left' ? 'left' : '';
      }),
      rows: grid.slice(1).map(function (g) { return g.cells; })
    };
    var out = md().serialTable(model);
    return out ? [out] : [];
  }

  function cellText(cell, ctx) {
    var bs = blocksOf(cell.kids, ctx);
    var s = bs.join('\n').replace(/\u0001/g, '<br>').replace(/\n+/g, '<br>');
    return s.trim();
  }

  function mdFromHTML(html) {
    var tree = parseMarkup(String(html == null ? '' : html), {});
    var titleEl = first(tree, 'title');
    var title = titleEl ? collapseWS(textOf(titleEl)).trim() : '';
    var bodyEl = first(tree, 'body');
    var root = bodyEl || tree;
    var mdText = blocksOf(root.kids, {}).join('\n\n');
    mdText = mdText.replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: mdText ? mdText + '\n' : '', title: title };
  }

  /* ============================================================
   * 4. DOCX → Markdown
   * ============================================================ */

  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('当前系统不支持解压（需要 DecompressionStream）'));
    }
    var ds = new DecompressionStream('deflate-raw');
    return new Response(new Blob([bytes]).stream().pipeThrough(ds))
      .arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function unzip(bytes) {
    var entries = zip().read(bytes);
    var map = {}, chain = Promise.resolve();
    entries.forEach(function (e) {
      chain = chain.then(function () {
        if (e.method === 0) { map[e.name] = e.data; return; }
        if (e.method === 8) {
          return inflateRaw(e.data).then(function (out) { map[e.name] = out; });
        }
        // 其它压缩方式（bzip2/lzma）在 docx 里几乎不存在，直接跳过
      });
    });
    return chain.then(function () { return map; });
  }

  function attr(el, name) {
    if (!el || !el.attrs) return undefined;
    if (el.attrs[name] != null) return el.attrs[name];
    var keys = Object.keys(el.attrs);
    for (var i = 0; i < keys.length; i++) {
      if (ln(keys[i]) === name) return el.attrs[keys[i]];
    }
    return undefined;
  }

  function val(el, name) {
    if (!el) return undefined;
    var v = attr(el, name);
    return v == null ? undefined : v;
  }

  function parseStyles(xml) {
    var map = {};
    if (!xml) return map;
    var root = parseMarkup(xml, { xml: true });
    var list = findAll(root, 'style');
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var id = attr(s, 'styleId');
      if (!id) continue;
      var nm = child(s, 'name');
      var bo = child(s, 'basedOn');
      var pPr = child(s, 'pPr');
      var rPr = child(s, 'rPr');
      var fonts = rPr && child(rPr, 'rFonts');
      var mono = !!(fonts && MONO.test(String(val(fonts, 'ascii') || val(fonts, 'hAnsi') || '')));
      var numPr = pPr && child(pPr, 'numPr');
      var numId = null, ilvl = 0;
      if (numPr) {
        var ni = child(numPr, 'numId'), il = child(numPr, 'ilvl');
        if (ni) numId = val(ni, 'val');
        if (il) ilvl = parseInt(val(il, 'val') || '0', 10) || 0;
      }
      map[id] = {
        id: id,
        name: nm ? val(nm, 'val') || '' : id,
        basedOn: bo ? val(bo, 'val') || '' : '',
        type: String(attr(s, 'type') || 'paragraph'),
        mono: mono,
        numId: numId, ilvl: ilvl
      };
    }
    return map;
  }

  function parseNumbering(xml) {
    var abs = {}, nums = {};
    if (!xml) return { abs: abs, nums: nums };
    var root = parseMarkup(xml, { xml: true });

    findAll(root, 'abstractNum').forEach(function (an) {
      var id = attr(an, 'abstractNumId');
      var levels = {};
      findAll(an, 'lvl').forEach(function (lvl) {
        var il = parseInt(attr(lvl, 'ilvl') || '0', 10) || 0;
        var fmt = child(lvl, 'numFmt');
        var st = child(lvl, 'start');
        levels[il] = {
          fmt: fmt ? String(val(fmt, 'val') || 'decimal') : 'decimal',
          start: st ? (parseInt(val(st, 'val') || '1', 10) || 1) : 1
        };
      });
      abs[id] = levels;
    });

    findAll(root, 'num').forEach(function (n) {
      var id = attr(n, 'numId');
      var anIdEl = child(n, 'abstractNumId');
      var anId = anIdEl ? val(anIdEl, 'val') : null;
      var over = {};
      findAll(n, 'lvlOverride').forEach(function (o) {
        var il = parseInt(attr(o, 'ilvl') || '0', 10) || 0;
        var so = child(o, 'startOverride');
        if (so) over[il] = parseInt(val(so, 'val') || '1', 10) || 1;
      });
      nums[id] = { abs: anId, over: over };
    });
    return { abs: abs, nums: nums };
  }

  function parseRels(xml) {
    var map = {};
    if (!xml) return map;
    var root = parseMarkup(xml, { xml: true });
    findAll(root, 'Relationship').forEach(function (r) {
      var id = attr(r, 'Id');
      if (!id) return;
      var target = String(attr(r, 'Target') || '');
      var external = String(attr(r, 'TargetMode') || '').toLowerCase() === 'external';
      if (!external) {
        target = target.replace(/^\/+/, '');
        if (target.indexOf('word/') !== 0 && target.indexOf('media/') !== 0) {
          target = 'word/' + target;
        } else if (target.indexOf('media/') === 0) {
          target = 'word/' + target;
        }
      }
      map[id] = { target: target, external: external };
    });
    return map;
  }

  function headingLevel(sid, name) {
    var m = /(?:heading|标题)[\s_-]*([1-6])\b/i.exec(name || '') ||
            /^(?:heading|标题)[\s_-]*([1-6])$/i.exec(sid || '');
    if (m) return Math.min(6, parseInt(m[1], 10));
    if (/^title$/i.test(name || '') || /^Title$/.test(sid || '')) return 1;
    if (/^subtitle$/i.test(name || '') || /^Subtitle$/.test(sid || '')) return 2;
    return 0;
  }

  function isCodeStyle(sid, name) {
    return /^(codeblock|sourcecode|htmlpreformatted|preformatted|code|plain ?text|代码)/i.test(name || '') ||
      /^(CodeBlock|SourceCode|HTMLPreformatted|Preformatted|Code)$/i.test(sid || '');
  }

  function isQuoteStyle(sid, name) {
    return /^(quote|block ?quote|intense quote|引用|引文)/i.test(name || '') ||
      /^(Quote|IntenseQuote|BlockText)$/i.test(sid || '');
  }

  var MONO = /consolas|courier|menlo|monaco|monospace|sf mono|source code|dejavu sans mono/i;

  function rPrFlags(rPr, ctx) {
    var f = { bold: false, italic: false, strike: false, under: false, sup: false, sub: false, code: false };
    if (!rPr) return f;
    var b = child(rPr, 'b');
    if (b && String(val(b, 'val') || 'true') !== '0' && String(val(b, 'val') || 'true').toLowerCase() !== 'false') f.bold = true;
    var i = child(rPr, 'i');
    if (i && String(val(i, 'val') || 'true') !== '0' && String(val(i, 'val') || 'true').toLowerCase() !== 'false') f.italic = true;
    var s = child(rPr, 'strike') || child(rPr, 'dstrike');
    if (s && String(val(s, 'val') || 'true') !== '0') f.strike = true;
    var u = child(rPr, 'u');
    if (u && String(val(u, 'val') || 'single') !== 'none') f.under = true;
    var va = child(rPr, 'vertAlign');
    if (va) {
      var v = String(val(va, 'val') || '');
      if (v === 'superscript') f.sup = true;
      else if (v === 'subscript') f.sub = true;
    }
    var fonts = child(rPr, 'rFonts');
    if (fonts) {
      var fn = String(val(fonts, 'ascii') || val(fonts, 'hAnsi') || '');
      if (MONO.test(fn)) f.code = true;
    }
    // 行内代码常常只靠字符样式（CodeChar）带字体，run 自己是空的
    var rs = child(rPr, 'rStyle');
    if (rs && ctx && ctx.styles) {
      var cs = ctx.styles[String(val(rs, 'val') || '')];
      if (cs && (cs.mono || /code|代码/i.test(cs.name || ''))) f.code = true;
    }
    return f;
  }

  function emuToPx(emu) {
    var n = parseInt(emu, 10);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n / 9525);     // 96 dpi
  }

  function drawingMD(el, ctx) {
    var blip = null;
    (function find(n) {
      each(n, function (k) {
        if (blip) return;
        if (ln(k.tag) === 'blip') { blip = k; return; }
        find(k);
      });
    })(el);

    var rid = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : null;
    if (!rid) {
      var imd = first(el, 'imagedata');     // VML 老式图片
      rid = imd ? (attr(imd, 'id') || attr(imd, 'href')) : null;
    }
    if (!rid) return '';

    var rel = ctx.rels[rid];
    if (!rel || rel.external) return '';    // 外链图片没法打包进来，跳过
    var bytes = ctx.files[rel.target];
    if (!bytes) return '';

    var ext = (rel.target.split('.').pop() || 'png').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    var name = 'image' + (++ctx.imgSeq) + '.' + ext;
    ctx.assetMap[name] = bytes;

    var w = 0, h = 0;
    var ext2 = first(el, 'extent');
    if (ext2) { w = emuToPx(attr(ext2, 'cx')); h = emuToPx(attr(ext2, 'cy')); }
    if (!w && !h) {
      var shape = first(el, 'shape');
      if (shape && attr(shape, 'style')) {
        var st = /width:\s*([\d.]+)pt/i.exec(attr(shape, 'style'));
        var ht = /height:\s*([\d.]+)pt/i.exec(attr(shape, 'style'));
        if (st) w = Math.round(parseFloat(st[1]) * 96 / 72);
        if (ht) h = Math.round(parseFloat(ht[1]) * 96 / 72);
      }
    }

    var size = (w || h) ? ' =' + (w || '') + 'x' + (h || '') : '';
    return '![](' + ctx.assetDir + name + size + ')';
  }

  // 返回序号；外面用 \u0002n\u0002 占位，等 mdEsc 跑完再还原成 [^n]
  function footnoteRef(n, ctx) {
    var id = String(attr(n, 'id'));
    if (ctx.fn[id]) return ctx.fn[id];
    var num = ctx.fnOrder.length + 1;
    ctx.fn[id] = num;
    ctx.fnOrder.push(id);
    return num;
  }

  function runMD(r, ctx) {
    var rPr = child(r, 'rPr');
    var f = rPrFlags(rPr, ctx);
    if (ctx && ctx.noItalic) f.italic = false;
    var text = '', img = '';

    each(r, function (n) {
      var l = ln(n.tag);
      switch (l) {
        case 't': text += textOf(n); break;
        case 'tab': text += '\t'; break;
        case 'br': case 'cr': text += '\n'; break;
        case 'noBreakHyphen': text += '-'; break;
        case 'softHyphen': break;
        case 'drawing': case 'pict': case 'object':
          img = drawingMD(n, ctx) || img; break;
        case 'footnoteReference': case 'endnoteReference':
          text += '\u0002' + footnoteRef(n, ctx) + '\u0002'; break;
        case 'fldChar': case 'instrText': break;
        case 'delText': break;
        case 'sym': {
          var ch = attr(n, 'char');
          if (ch) {
            var code = parseInt(String(ch), 16);
            if (isFinite(code)) text += String.fromCharCode(code);
          }
          break;
        }
      }
    });

    if (img) return img;
    if (!text) return '';

    // 行内换行在 md 里是「两个空格 + 换行」
    var parts = text.split('\n');
    if (f.sup) parts = parts.map(function (p) { return scriptText(p, SUP_MAP); });
    if (f.sub) parts = parts.map(function (p) { return scriptText(p, SUB_MAP); });
    var body;
    if (f.code) {
      body = parts.map(function (p) { return codeSpan(p); }).join('  \n');
    } else {
      body = parts.map(function (p) { return mdEsc(p); }).join('  \n');
      if (f.strike) body = '~~' + body + '~~';
      if (f.italic) body = wrapInline('*', body);
      if (f.bold) body = wrapInline('**', body);
    }
    return body.replace(/\u0002(\d+)\u0002/g, '[^$1]');
  }

  function collectRuns(node, ctx, acc) {
    each(node, function (n) {
      if (n.tag === '#text') return;
      var l = ln(n.tag);
      if (l === 'r') { acc.push(runMD(n, ctx)); return; }
      if (l === 'hyperlink') {
        var sub = [];
        collectRuns(n, ctx, sub);
        var inner = sub.join('');
        var rel = ctx.rels[attr(n, 'id')];
        var anchor = attr(n, 'anchor');
        if (rel && rel.external) acc.push('[' + inner + '](' + rel.target + ')');
        else if (anchor) acc.push('[' + inner + '](#' + anchor + ')');
        else acc.push(inner);
        return;
      }
      if (l === 'ins' || l === 'smartTag' || l === 'sdt' || l === 'sdtContent' ||
          l === 'fldSimple' || l === 'customXml' || l === 'moveTo') {
        collectRuns(n, ctx, acc); return;
      }
      if (l === 'del' || l === 'moveFrom' || l === 'pPr' || l === 'rPr') return;
    });
  }

  function paraInline(p, ctx) {
    var acc = [];
    collectRuns(p, ctx, acc);
    return acc.join('').replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, '');
  }

  function numInfo(ctx, numId, ilvl) {
    var n = ctx.nums.nums[numId];
    if (!n) return null;
    var levels = ctx.nums.abs[n.abs] || {};
    var lv = levels[ilvl] || levels[0] || { fmt: 'decimal', start: 1 };
    var start = n.over[ilvl] != null ? n.over[ilvl] : lv.start;
    return { fmt: lv.fmt, start: start || 1 };
  }

  function listMarker(ctx, numId, ilvl) {
    var info = numInfo(ctx, numId, ilvl);
    if (!info || info.fmt === 'bullet' || info.fmt === 'none') {
      return repeat('  ', ilvl) + '-';
    }
    var c = ctx.counters[numId] || (ctx.counters[numId] = []);
    c.length = ilvl + 1;
    if (c[ilvl] == null) c[ilvl] = info.start - 1;
    c[ilvl] += 1;
    return repeat('  ', ilvl) + c[ilvl] + '.';
  }

  function hasBottomBorder(pPr) {
    if (!pPr) return false;
    var bdr = child(pPr, 'pBdr');
    if (!bdr) return false;
    var b = child(bdr, 'bottom');
    if (!b) return false;
    var v = String(val(b, 'val') || '');
    return v && v !== 'none' && v !== 'nil';
  }

  function paraInfo(p, ctx) {
    var pPr = child(p, 'pPr');
    var sid = '', numId = null, ilvl = 0;
    if (pPr) {
      var ps = child(pPr, 'pStyle');
      if (ps) sid = String(val(ps, 'val') || '');
      var np = child(pPr, 'numPr');
      if (np) {
        var ni = child(np, 'numId'), il = child(np, 'ilvl');
        if (ni) numId = String(val(ni, 'val') || '');
        if (il) ilvl = parseInt(val(il, 'val') || '0', 10) || 0;
        if (numId === '0') numId = null;
      }
    }
    var st = ctx.styles[sid] || null;
    var name = st ? String(st.name || '') : '';
    if (numId == null && st && st.numId != null) { numId = String(st.numId); ilvl = st.ilvl || 0; }

    var lvl = headingLevel(sid, name);
    var code = !lvl && isCodeStyle(sid, name);
    var quote = !lvl && !code && numId == null && isQuoteStyle(sid, name);

    // 引用段整段是斜体的（Word 的 Quote 样式就这么定义），
    // md 里 "> " 已经表达了这层语义，再包一层 * * 是噪音
    var prev = ctx.noItalic;
    ctx.noItalic = quote;
    var text = paraInline(p, ctx);
    ctx.noItalic = prev;

    if (lvl) {
      var head = text.replace(/\u0001/g, ' ').trim();
      return { text: head ? repeat('#', lvl) + ' ' + head : '', code: false, list: false };
    }
    if (code) return { text: text.replace(/  \n/g, '\n'), code: true, list: false };

    // 分隔线：空段落 + 下边框
    if (!text.trim() && hasBottomBorder(pPr)) return { text: '---', code: false, list: false };

    if (numId != null) {
      var marker = listMarker(ctx, numId, ilvl);
      return { text: text ? marker + ' ' + text : '', code: false, list: !!text };
    }
    if (quote) {
      if (!text) return { text: '', code: false, list: false };
      return {
        text: text.split('\n').map(function (l) { return '> ' + l; }).join('\n'),
        code: false, list: false
      };
    }
    return { text: text, code: false, list: false };
  }

  function cellMD(tc, ctx) {
    var span = 1;
    var tcPr = child(tc, 'tcPr');
    var align = '';
    if (tcPr) {
      var gs = child(tcPr, 'gridSpan');
      if (gs) span = parseInt(val(gs, 'val') || '1', 10) || 1;
      var jc = child(tcPr, 'jc');
      if (jc) {
        var j = String(val(jc, 'val') || '');
        align = j === 'center' ? 'center' : j === 'right' || j === 'end' ? 'right'
          : j === 'left' || j === 'start' ? 'left' : '';
      }
      var vm = child(tcPr, 'vMerge');
      if (vm && String(val(vm, 'val') || 'continue') === 'continue') {
        return { cells: [''], align: align, span: 1, merged: true };
      }
    }
    var ps = [];
    each(tc, function (n) {
      if (ln(n.tag) === 'p') {
        var s = paraInline(n, ctx).replace(/  \n/g, '<br>').replace(/\n/g, '<br>');
        ps.push(s.trim());
        // Word 常把对齐写在单元格里那段落的 pPr 上，而不是 tcPr
        if (!align) {
          var pPr = child(n, 'pPr');
          var jc2 = pPr && child(pPr, 'jc');
          if (jc2) {
            var j2 = String(val(jc2, 'val') || '');
            align = j2 === 'center' ? 'center' : j2 === 'right' || j2 === 'end' ? 'right'
              : j2 === 'left' || j2 === 'start' ? 'left' : '';
          }
        }
      } else if (ln(n.tag) === 'tbl') {
        ps.push('');   // 嵌套表格不支持，留空
      }
    });
    while (ps.length && ps[0] === '') ps.shift();
    while (ps.length && ps[ps.length - 1] === '') ps.pop();
    return { cells: [ps.join('<br>')], align: align, span: span, merged: false };
  }

  function tableMD(tbl, ctx) {
    var rows = [];
    each(tbl, function (n) {
      if (ln(n.tag) === 'tr') rows.push(n);
      else if (ln(n.tag) === 'sdt') {
        var sc = child(n, 'sdtContent');
        if (sc) each(sc, function (k) { if (ln(k.tag) === 'tr') rows.push(k); });
      }
    });
    if (!rows.length) return '';

    var grid = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = [], aligns = [];
      each(rows[i], function (tc) {
        if (ln(tc.tag) !== 'tc') return;
        var c = cellMD(tc, ctx);
        cells.push(c.cells[0]);
        aligns.push(c.align);
        for (var k = 1; k < c.span; k++) { cells.push(''); aligns.push(''); }
      });
      grid.push({ cells: cells, aligns: aligns });
    }

    var cols = 0;
    for (var r = 0; r < grid.length; r++) if (grid[r].cells.length > cols) cols = grid[r].cells.length;
    if (!cols) return '';
    for (var r2 = 0; r2 < grid.length; r2++) {
      while (grid[r2].cells.length < cols) { grid[r2].cells.push(''); grid[r2].aligns.push(''); }
      while (grid[r2].aligns.length < cols) grid[r2].aligns.push('');
    }

    // 全是空的表（只有边框）没必要留
    var any = false;
    grid.forEach(function (g) { g.cells.forEach(function (c) { if (c) any = true; }); });
    if (!any) return '';

    var model = { head: grid[0].cells, aligns: grid[0].aligns, rows: [] };
    for (var r3 = 1; r3 < grid.length; r3++) model.rows.push(grid[r3].cells);
    return md().serialTable(model);
  }

  function bodyBlocks(kids, ctx, out) {
    var code = null;
    var listBuf = null;

    function flushCode() {
      if (!code) return;
      var runs = code.lines.join('\n').match(/`{3,}/g) || [];
      var max = 2;
      for (var i = 0; i < runs.length; i++) if (runs[i].length > max) max = runs[i].length;
      var fence = repeat('`', max + 1);
      out.push(fence + '\n' + code.lines.join('\n') + '\n' + fence);
      code = null;
    }

    // Word 里每个列表项是独立段落，但 md 里连续的项应该贴在一起（紧凑列表）；
    // 换成另一种列表（有序 ↔ 无序）时必须断开，否则会被当成同一个列表的续行
    var listBuf = null, listKind = '';
    function flushList() {
      if (!listBuf) return;
      out.push(listBuf.join('\n'));
      listBuf = null;
      listKind = '';
    }

    function flushAll() { flushCode(); flushList(); }

    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (!n || n.tag === '#text') continue;
      var l = ln(n.tag);

      if (l === 'p') {
        var info = paraInfo(n, ctx);
        if (info.code) {
          flushList();
          if (!code) code = { lines: [] };
          code.lines.push(info.text);
          continue;
        }
        flushCode();
        if (!info.text) { flushList(); continue; }
        if (info.list) {
          var kind = /^\s*\d+\./.test(info.text) ? 'o' : 'b';
          if (listBuf && listKind !== kind) flushList();
          if (!listBuf) { listBuf = []; listKind = kind; }
          listBuf.push(info.text);
          continue;
        }
        flushList();
        out.push(info.text);
        continue;
      }
      if (l === 'tbl') { flushAll(); var t = tableMD(n, ctx); if (t) out.push(t); continue; }
      if (l === 'sdt') {
        flushAll();
        var sc = child(n, 'sdtContent');
        if (sc) bodyBlocks(sc.kids, ctx, out);
        continue;
      }
      if (l === 'ins' || l === 'customXml' || l === 'moveTo') {
        flushAll();
        bodyBlocks(n.kids, ctx, out);
        continue;
      }
      if (l === 'sectPr' || l === 'bookmarkStart' || l === 'bookmarkEnd' ||
          l === 'del' || l === 'moveFrom') continue;
    }
    flushAll();
  }

  function fromDocx(bytes, opts) {
    opts = opts || {};
    // zip 读取是同步的，包一层 Promise.resolve 让「不是 zip」这类错误也走 reject
    return Promise.resolve().then(function () { return unzip(bytes); }).then(function (files) {
      var docBytes = files['word/document.xml'];
      if (!docBytes) throw new Error('不是有效的 .docx（缺少 word/document.xml）');

      var root = parseMarkup(dec(docBytes), { xml: true });
      var body = first(root, 'body') || root;

      var ctx = {
        styles: parseStyles(files['word/styles.xml'] ? dec(files['word/styles.xml']) : ''),
        nums: parseNumbering(files['word/numbering.xml'] ? dec(files['word/numbering.xml']) : ''),
        rels: parseRels(files['word/_rels/document.xml.rels'] ? dec(files['word/_rels/document.xml.rels']) : ''),
        files: files,
        assetDir: opts.assetDir || 'assets/media/',
        assetMap: {},
        imgSeq: 0,
        counters: {},
        fn: {},
        fnOrder: []
      };

      var out = [];
      bodyBlocks(body.kids || [], ctx, out);

      // 脚注正文
      var fnBytes = files['word/footnotes.xml'];
      var defs = [];
      if (fnBytes && ctx.fnOrder.length) {
        var froot = parseMarkup(dec(fnBytes), { xml: true });
        var fnMap = {};
        findAll(froot, 'footnote').forEach(function (f) {
          var id = String(attr(f, 'id') || '');
          var ps = [];
          each(f, function (p) {
            if (ln(p.tag) === 'p') {
              var s = paraInline(p, ctx).replace(/\s+/g, ' ').trim();
              if (s) ps.push(s);
            }
          });
          fnMap[id] = ps.join(' ');
        });
        ctx.fnOrder.forEach(function (id, idx) {
          var txt = fnMap[id];
          if (txt) defs.push('[^' + (idx + 1) + ']: ' + txt);
        });
      }

      var mdText = out.join('\n\n');
      if (defs.length) mdText += '\n\n' + defs.join('\n\n');
      mdText = mdText.replace(/\n{3,}/g, '\n\n').trim();
      if (mdText) mdText += '\n';

      var assets = [];
      Object.keys(ctx.assetMap).forEach(function (name) {
        assets.push({ path: ctx.assetDir + name, bytes: ctx.assetMap[name], name: name });
      });

      return { markdown: mdText, assets: assets, title: '' };
    });
  }

  /* ============================================================
   * 4·B. ePub → Markdown
   *
   * 走的是「解 zip → 找 OPF → 按 spine 顺序逐章 HTML 转 md」，
   * 图片按章节相对路径解出、去重后落进 assets，正文引用同步改写。
   * 真实 ePub 基本都用 deflate，所以复用 docx 那条 unzip 通道。
   * ============================================================ */
  function joinZipPath(base, href) {
    var parts = String(base + href).split('/'), out = [];
    parts.forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') { out.pop(); return; }
      out.push(p);
    });
    return out.join('/');
  }

  function dirOf(p) {
    return String(p).replace(/[^/]*$/, '');
  }

  function fromEpub(bytes, opts) {
    opts = opts || {};
    var assetDir = opts.assetDir || 'assets/media/';

    return unzip(bytes).then(function (files) {
      var names = Object.keys(files);
      var lower = {};
      names.forEach(function (n) { lower[n.toLowerCase()] = n; });

      function raw(p) {
        var key = names.indexOf(p) >= 0 ? p : lower[String(p).toLowerCase()];
        return key ? files[key] : null;
      }
      function textAt(p) {
        var b = raw(p);
        return b ? dec(b) : '';
      }

      var container = textAt('META-INF/container.xml');
      var om = /<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/i.exec(container);
      var opfPath = om ? om[1] : (names.filter(function (n) { return /\.opf$/i.test(n); })[0] || '');
      if (!opfPath) throw new Error('不是合法的 ePub：找不到 content.opf');
      var opf = textAt(opfPath);
      if (!opf) throw new Error('ePub 包损坏：' + opfPath + ' 读不出来');
      var baseDir = dirOf(opfPath);

      var tm = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
      var title = decodeEnt((tm || [])[1] || '').replace(/<[^>]+>/g, '').trim();

      // manifest：id → {href, type, props}
      var items = {}, m;
      var ire = /<item\b([^>]*?)\/?>/g;
      while ((m = ire.exec(opf)) !== null) {
        var at = m[1];
        var gid = /id\s*=\s*"([^"]*)"/.exec(at);
        var gh = /href\s*=\s*"([^"]*)"/.exec(at);
        if (!gid || !gh) continue;
        items[gid[1]] = {
          href: decodeEnt(gh[1]),
          type: (/media-type\s*=\s*"([^"]*)"/.exec(at) || [])[1] || '',
          props: (/properties\s*=\s*"([^"]*)"/.exec(at) || [])[1] || ''
        };
      }

      // spine：阅读顺序
      var spine = [];
      var sm = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf);
      if (sm) {
        var sre = /<itemref\b([^>]*?)\/?>/g;
        while ((m = sre.exec(sm[1])) !== null) {
          var ref = /idref\s*=\s*"([^"]*)"/.exec(m[1]);
          var lin = /linear\s*=\s*"([^"]*)"/.exec(m[1]);
          if (lin && lin[1] === 'no') continue;
          if (ref && items[ref[1]]) spine.push(items[ref[1]]);
        }
      }
      if (!spine.length) {
        spine = names.filter(function (n) { return /\.x?html?$/i.test(n); }).map(function (n) {
          return { href: n.slice(baseDir.length), type: 'application/xhtml+xml', props: '' };
        });
      }

      var assets = [], assetMap = {}, used = {};
      function addAsset(full, suggested) {
        if (assetMap[full]) return assetMap[full];
        var b = raw(full);
        if (!b) return null;
        var base = String(suggested || full.split('/').pop() || 'image').split('?')[0].split('#')[0];
        base = base.split('/').pop() || 'image';        // 只留文件名，目录信息不要
        try { base = decodeURIComponent(base); } catch (e) {}
        base = base.replace(/[\\/:*?"<>|]+/g, '-') || 'image';
        if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.png';
        var name = base, k = 1;
        while (used[name]) {
          var dot = base.lastIndexOf('.');
          name = (dot > 0 ? base.slice(0, dot) : base) + '-' + (++k) + (dot > 0 ? base.slice(dot) : '');
        }
        used[name] = 1;
        var target = assetDir + name;
        assets.push({ path: target, bytes: b, name: name });
        assetMap[full] = target;
        return target;
      }

      var chapters = [];
      spine.forEach(function (sp) {
        if (!sp || !sp.href) return;
        if (/(^|\s)nav(\s|$)/.test(sp.props || '')) return;   // 导航页不要
        var full = joinZipPath(baseDir, sp.href).split('#')[0];
        var text = textAt(full);
        if (!text) return;
        var bm = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(text);
        var html = bm ? bm[1] : text;

        // SVG 封面常写成 <image xlink:href>，先转成 img 再统一处理
        html = html.replace(/<image\b[^>]*?(?:xlink:)?href\s*=\s*"([^"]+)"[^>]*>/gi, function (mm, src) {
          var p = addAsset(joinZipPath(dirOf(full), src), src);
          return p ? '<img src="' + p + '" />' : '';
        });
        html = html.replace(/<img\b([^>]*)>/gi, function (mm, at2) {
          var sm2 = /\bsrc\s*=\s*"([^"]*)"/i.exec(at2) || /\bsrc\s*=\s*'([^']*)'/i.exec(at2);
          if (!sm2) return mm;
          if (/^(https?:|data:)/i.test(sm2[1])) return mm;
          var p = addAsset(joinZipPath(dirOf(full), sm2[1]), sm2[1]);
          if (!p) return mm;
          return '<img' + at2.replace(sm2[0], 'src="' + p + '"') + '>';
        });

        // 脚注：先整体摘掉文末脚注区，再处理正文里的引用锚点
        var notes = [];
        html = html.replace(/<(section|div|aside)\b[^>]*class="[^"]*footnotes?[^"]*"[\s\S]*?<\/\1>/gi, function (whole) {
          var nre = /<li\b[^>]*id="(?:fn)?([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi, nm;
          while ((nm = nre.exec(whole)) !== null) {
            var nt = decodeEnt(nm[2].replace(/<[^>]+>/g, ' '))
              .replace(/[\u21a9\u2934\u2191]/g, ' ')
              .replace(/\s+/g, ' ').trim();
            notes.push({ id: nm[1], text: nt });
          }
          return '';
        });
        html = html.replace(/<a\b[^>]*href="[^"]*#(?:fn|fnref)([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (mm, id) {
          // 先塞占位符：直接写 [^1] 会被 HTML→MD 当成普通文字转义成 \[^1\]
          return '\u0003fn' + id + '\u0004';
        });

        var mdText = mdFromHTML('<body>' + html + '</body>').markdown;
        mdText = mdText.replace(/\u0003fn([^\u0004]*)\u0004/g, '[^$1]');
        if (notes.length) {
          mdText += '\n\n' + notes.map(function (n) { return '[^' + n.id + ']: ' + n.text; }).join('\n');
        }
        if (mdText.trim()) chapters.push(mdText.trim());
      });

      var mdAll = chapters.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
      return {
        markdown: mdAll ? mdAll + '\n' : '',
        assets: assets,
        title: title
      };
    });
  }

  /* ============================================================
   * 5. 对外门面
   * ============================================================ */

  function sniffCharset(bytes) {
    var head = '';
    var n = Math.min(bytes.length, 4096);
    for (var i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
    var m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    return m ? m[1].toLowerCase() : '';
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  // ext: 'docx' | 'odt' | 'epub' | 'html' | 'htm' | 'md' | 'txt' | 'rst' | 'tex'
  function convert(ext, base64, opts) {
    opts = opts || {};
    ext = String(ext || '').toLowerCase().replace(/^\./, '');
    var bytes = b64ToBytes(base64);

    if (ext === 'odt') {
      var r0 = dep('infmt', 'InFmt').fromOdt(bytes, opts);
      if (r0.assets) {
        r0.assets = r0.assets.map(function (a) {
          return { path: a.path, base64: bytesToBase64(a.bytes) };
        });
      }
      return Promise.resolve(r0);
    }

    if (ext === 'rst' || ext === 'rest') {
      var rt = dec(bytes);
      if (rt.charCodeAt(0) === 0xFEFF) rt = rt.slice(1);
      return Promise.resolve(dep('infmt', 'InFmt').fromRst(rt));
    }

    if (ext === 'epub') {
      return fromEpub(bytes, opts).then(function (r) {
        if (r.assets) {
          r.assets = r.assets.map(function (a) {
            return { path: a.path, base64: bytesToBase64(a.bytes), name: a.name };
          });
        }
        return r;
      });
    }

    if (ext === 'tex' || ext === 'latex' || ext === 'ltx') {
      var lt = dec(bytes);
      if (lt.charCodeAt(0) === 0xFEFF) lt = lt.slice(1);
      var rl = dep('infmt', 'InFmt').fromLatex(lt, opts);
      if (!rl.title && opts.stem) rl.title = opts.stem;
      return Promise.resolve(rl);
    }

    if (ext === 'docx') {
      return fromDocx(bytes, opts).then(function (r) {
        if (r.assets) {
          r.assets = r.assets.map(function (a) {
            return { path: a.path, base64: bytesToBase64(a.bytes) };
          });
        }
        return r;
      });
    }

    if (ext === 'html' || ext === 'htm') {
      var cs = sniffCharset(bytes);
      var text;
      if (cs && cs !== 'utf-8' && cs !== 'utf8') {
        var bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
        text = dec(bom ? bytes.subarray(3) : bytes, cs);
      } else {
        text = dec(bytes);
      }
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var r = mdFromHTML(text);
      return Promise.resolve({ markdown: r.markdown, assets: [], title: r.title });
    }

    if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'text') {
      var t = dec(bytes);
      if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
      return Promise.resolve({ markdown: t, assets: [], title: '' });
    }

    return Promise.reject(new Error('不支持的文件类型：.' + ext));
  }

  return {
    // 供测试与复用
    parseMarkup: parseMarkup,
    mdFromHTML: mdFromHTML,
    fromDocx: fromDocx,
    fromEpub: fromEpub,
    convert: convert,
    decodeEntity: decodeEnt,
    b64ToBytes: b64ToBytes,
    _internals: { blocksOf: blocksOf, inlineOf: inlineOf, serializeHTML: serializeHTML }
  };
});
