/* ============================================================
 * export.js — 内置导出引擎（ePub / LaTeX / 分发）
 *
 * 设计取舍：不依赖 pandoc、不依赖任何 native 二进制。
 * docx 走 docx.js（手写 OOXML），ePub 走「HTML→XHTML + zip」，
 * LaTeX 走「块模型 → 文本」。三个都在 app 包内，离线可用。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Export = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }

  /* ============================================================
   * 一、LaTeX
   * ============================================================ */
  var TEX_ESC = {
    '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#',
    '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}', '<': '\\textless{}', '>': '\\textgreater{}'
  };

  function texEsc(s) {
    return String(s == null ? '' : s).replace(/[\\&%$#_{}~^<>]/g, function (c) { return TEX_ESC[c]; });
  }

  function texPath(p) {
    // 文件名里的 _ 之类交给 \detokenize 处理，避免 graphicx 把参数当文本吞掉
    return /[\\{}%#_~^&]/.test(p) ? '\\detokenize{' + p.replace(/[{}%#]/g, '') + '}' : p;
  }

  function texInline(tokens, ctx) {
    var I = dep('inline', 'Inline');
    return (tokens || []).map(function (t) {
      switch (t.t) {
        case 'text': return texEsc(t.v);
        case 'code': return '\\texttt{' + texEsc(t.v) + '}';
        case 'math': return '$' + t.v + '$';
        case 'br': return '\\\\\n';
        case 'img':
          if (/^https?:/i.test(t.src)) return '\\href{' + texEsc(t.src) + '}{' + texEsc('[图片] ' + (t.alt || '')) + '}';
          var opt = 'width=0.9\\linewidth';
          if (t.w && t.h) opt = 'width=' + (t.w * 0.75).toFixed(1) + 'pt,height=' + (t.h * 0.75).toFixed(1) + 'pt';
          else if (t.w) opt = 'width=' + (t.w * 0.75).toFixed(1) + 'pt';
          else if (t.h) opt = 'height=' + (t.h * 0.75).toFixed(1) + 'pt';
          return '\\includegraphics[' + opt + ',keepaspectratio]{' + texPath(t.src) + '}';
        case 'fn': {
          var body = ctx.fn[t.id];
          return '\\footnote{' + texInline(I.tokenize(body == null ? '（缺失脚注：' + t.id + '）' : body), ctx) + '}';
        }
        case 'wiki': return texInline(t.kids && t.kids.length ? t.kids : [{ t: 'text', v: t.label || t.target }], ctx);
        case 'link': return '\\href{' + texEsc(t.href) + '}{' + texInline(t.kids, ctx) + '}';
        case 'strong': return '\\textbf{' + texInline(t.kids, ctx) + '}';
        case 'em': return '\\emph{' + texInline(t.kids, ctx) + '}';
        case 'del': return '\\sout{' + texInline(t.kids, ctx) + '}';
        case 'mark': return '\\colorbox{yellow!35}{' + texInline(t.kids, ctx) + '}';
        case 'sup': return '\\textsuperscript{' + texInline(t.kids, ctx) + '}';
        case 'sub': return '\\textsubscript{' + texInline(t.kids, ctx) + '}';
        case 'u': return '\\underline{' + texInline(t.kids, ctx) + '}';
        default: return '';
      }
    }).join('');
  }

  function texTable(raw) {
    var lines = String(raw).split('\n');
    function cells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
    var head = cells(lines[0] || '');
    var sep = cells(lines[1] || '');
    var cols = head.length;
    var spec = sep.map(function (c) {
      if (/^:.*:$/.test(c)) return 'c';
      if (/:$/.test(c)) return 'r';
      return 'l';
    }).join('') || 'l'.repeat(cols);

    var out = '\\begin{center}\n\\begin{tabular}{' + spec + '}\n\\hline\n';
    out += head.map(function (c) { return '\\textbf{' + texEsc(c) + '}'; }).join(' & ') + ' \\\\\n\\hline\n';
    for (var i = 2; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var cs = cells(lines[i]);
      var row = [];
      for (var c = 0; c < cols; c++) row.push(texInline(dep('inline', 'Inline').tokenize(cs[c] || ''), { fn: {} }));
      out += row.join(' & ') + ' \\\\\n';
    }
    return out + '\\hline\n\\end{tabular}\n\\end{center}\n';
  }

  function latex(src, opts) {
    try { dep('inline', 'Inline').setDefs(dep('inline', 'Inline').scanDefs(src)); } catch (e) {}
    opts = opts || {};
    var MD = dep('md', 'MD');
    var I = dep('inline', 'Inline');
    var Yaml = dep('yaml', 'Yaml');
    var model = MD.parse(src);
    var blocks = model.blocks;

    // YAML front matter 覆盖导出设置（pandoc 惯例）
    var y = Yaml.overrides(src);
    var title = y.title || opts.title || '';
    var author = y.author || opts.author || '';
    var hasH1 = blocks.some(function (b) { return b.type === 'h1'; });

    var ctx = { fn: {} };
    blocks.forEach(function (b) { if (b.type === 'footdef') ctx.fn[b.fnId] = b.fnBody || ''; });

    var out = [];
    out.push('% 由 OpenTypora 导出。中文排版请用 XeLaTeX 编译：');
    out.push('%   xelatex ' + (opts.filename || 'document') + '.tex');
    var clsOpts = [(y.fontsize || '11pt'), (PAPERS[y.paper] ? y.paper + 'paper' : 'a4paper')].join(',');
    out.push('\\documentclass[' + clsOpts + ']{' + (y.docclass || 'ctexart') + '}');
    out.push(y.geometry ? '\\usepackage[' + y.geometry + ']{geometry}' : '\\usepackage[margin=2.5cm]{geometry}');
    out.push('\\usepackage{graphicx}');
    out.push('\\usepackage{xcolor}');
    out.push('\\usepackage[normalem]{ulem}');
    out.push('\\usepackage{amssymb}');
    out.push('\\usepackage{hyperref}');
    out.push('\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue,citecolor=blue}');
    if (y.keywords) out.push('\\hypersetup{pdfkeywords={' + y.keywords + '}}');
    out.push('\\setlength{\\parindent}{0pt}');
    out.push('\\setlength{\\parskip}{0.6em}');
    if (y.linestretch) out.push('\\linespread{' + y.linestretch + '}');
    if (y.tocTitle) out.push('\\renewcommand{\\contentsname}{' + texEsc(y.tocTitle) + '}');
    if (title && !hasH1) {
      var titleTex = texEsc(title);
      if (y.subtitle) titleTex += ' \\\\ {\\Large ' + texEsc(y.subtitle) + '}';
      out.push('\\title{' + titleTex + '}');
    }
    if (author) out.push('\\author{' + texEsc(author) + '}');
    out.push(y.date ? '\\date{' + texEsc(y.date) + '}' : '\\date{}');
    out.push('\\begin{document}');
    if (title && !hasH1) out.push('\\maketitle');
    if (author && title && hasH1) out.push('\\noindent\\textit{' + texEsc(author) + '}\\par');
    // `toc: true` 且正文没有 [TOC] 块：在标题页后补一份目录
    if (y.toc && !blocks.some(function (b) { return b.type === 'toc'; })) {
      out.push('\\tableofcontents\n\\newpage');
    }

    var heads = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

    blocks.forEach(function (b) {
      switch (b.type) {
        case 'frontmatter': case 'footdef': case 'linkdef': break;

        case 'toc':
          out.push('\\tableofcontents\n\\newpage');
          break;

        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': {
          var lvl = parseInt(b.type.slice(1), 10) - 1;
          out.push('\\' + heads[Math.min(lvl, 4)] + '{' + texInline(I.tokenize(b.inline || ''), ctx) + '}');
          break;
        }
        case 'h6':
          out.push('\\textbf{' + texInline(I.tokenize(b.inline || ''), ctx) + '}\\par');
          break;

        case 'para':
          out.push(texInline(I.tokenize(b.raw), ctx));
          break;

        case 'quote': {
          var head2 = '';
          if (b.callout) {
            var cnames = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
            head2 = '\\textbf{' + texEsc(b.calloutTitle || cnames[b.callout] || b.callout) + '}\\\n';
          }
          out.push('\\begin{quote}\n' + head2 + texInline(I.tokenize(String(b.inner || '').replace(/\n+/g, ' ')), ctx) + '\n\\end{quote}');
          break;
        }

        case 'code': {
          var code = String(b.code || '').replace(/\\end\{verbatim\}/g, '\\end {verbatim}');
          out.push('\\begin{verbatim}\n' + code + '\n\\end{verbatim}');
          break;
        }

        case 'math':
          out.push('\\[\n' + (b.tex || '') + '\n\\]');
          break;

        case 'hr':
          out.push('\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par');
          break;

        case 'table':
          out.push(texTable(b.raw));
          break;

        case 'list': {
          function walk(items, ordered, depth) {
            var env = ordered ? 'enumerate' : 'itemize';
            var s = '\\begin{' + env + '}\n';
            items.forEach(function (it) {
              var mark = it.task === true ? '[($\\boxtimes$)]' : it.task === false ? '[($\\square$)]' : '';
              s += '\\item' + (mark ? '[' + mark.slice(1, -1) + ']' : '') + ' ' +
                texInline(I.tokenize(it.text || ''), ctx) + '\n';
              if (it.children && it.children.length) {
                s += walk(it.children, it.children[0].ordered, depth + 1);
              }
            });
            return s + '\\end{' + env + '}\n';
          }
          out.push(walk(b.items || [], b.items && b.items[0] && b.items[0].ordered, 0));
          break;
        }

        case 'html':
          var txt = dep('md', 'MD').htmlText(b.raw);
          if (txt) out.push('\\begin{quote}\\small ' + texEsc(txt) + '\\end{quote}');
          break;

        default:
          if (b.raw) out.push(texEsc(b.raw));
          break;
      }
    });

    out.push('\\end{document}');
    return out.join('\n\n') + '\n';
  }

  /* ============================================================
   * 二、ePub 3
   * ============================================================ */
  var ENT = {
    '&nbsp;': '&#160;', '&mdash;': '&#8212;', '&ndash;': '&#8211;', '&hellip;': '&#8230;',
    '&ldquo;': '&#8220;', '&rdquo;': '&#8221;', '&lsquo;': '&#8216;', '&rsquo;': '&#8217;',
    '&times;': '&#215;', '&copy;': '&#169;', '&reg;': '&#174;', '&middot;': '&#183;',
    '&rarr;': '&#8594;', '&larr;': '&#8592;', '&lsaquo;': '&#8249;', '&rsaquo;': '&#8250;'
  };

  function toXhtml(html) {
    var s = String(html || '');
    s = s.replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, function (m) {
      return ENT[m] || (m === '&amp;' || m === '&lt;' || m === '&gt;' || m === '&quot;' || m === '&apos;' ? m : '');
    });
    // 任务列表的 input 换成字符（XHTML 里不想管 disabled/checked 布尔属性）
    s = s.replace(/<input[^>]*class="task"[^>]*>/g, function (m) { return /checked/.test(m) ? '\u2611 ' : '\u2610 '; });
    // 空元素自闭合
    s = s.replace(/<(br|hr|img|col|input|source|wbr)(\s[^>]*)?\/?>/gi, function (m, tag, attrs) {
      return '<' + tag + (attrs || '') + '/>';
    });
    return s;
  }

  /* flowchart 代码块 → 内嵌 SVG（ePub / RevealJS 这类 HTML 系导出）。
   * 纯字符串替换，语法错误就原样留下源码块——与编辑器里的降级路径一致。
   * 读取时按 xesc 的转义反向解一遍（&amp; 必须最后解，否则 &amp;lt; 会错）。 */
  function unescCode(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function inlineFlow(html) {
    var FlowMod = dep('flow', 'Flow');
    if (!FlowMod || !FlowMod.svg) return html;
    return String(html || '').replace(
      /<pre><code class="language-(?:flow|flowchart)">([\s\S]*?)<\/code><\/pre>/g,
      function (m, body) {
        try {
          return '<div class="flow-fig">' + FlowMod.svg(unescCode(body), { dark: false }) + '</div>';
        } catch (e) {
          return m;
        }
      });
  }

  function stripDataAttrs(html) {
    return String(html)
      .replace(/\sdata-s="[^"]*"/g, '')
      .replace(/\sdata-i="[^"]*"/g, '')
      .replace(/\sdata-ds="[^"]*"/g, '');
  }

  function tocMarkup(list, prefix) {
    if (!list.length) return '';
    prefix = prefix || '';

    var root = { children: [], level: 0 };
    var stack = [root];
    list.forEach(function (h) {
      var node = { text: h.text, id: h.id, children: [], level: h.level };
      while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });

    function render(nodes) {
      var s = '<ol>';
      nodes.forEach(function (n) {
        s += '<li><a href="' + prefix + '#' + n.id + '">' + xesc(n.text || '（无标题）') + '</a>';
        if (n.children.length) s += render(n.children);
        s += '</li>';
      });
      return s + '</ol>';
    }

    return '<nav class="toc">' + render(root.children) + '</nav>\n';
  }

  /* ---------------------------------------------------------- 块模型 → 语义 HTML
   * md.js 的 renderBlock 输出的是「块级 WYSIWYG」结构（标题是
   * <div class="blk h1"><span>…</span></div>，靠 CSS 装成标题）。
   * ePub 不能这么干：阅读器和目录都只认真正的 h1..h6。
   * 所以这里按块模型重新产出一次语义化 HTML。
   */
  function slots() {
    var ctx = { heads: [], toc: [], fnBody: {}, fnNum: {}, fnOrder: [], imgSeq: 0 };

    function inline(src) { return dep('md', 'MD').renderInline(src, 0); }

    function listHtml(items, ordered) {
      var tag = ordered ? 'ol' : 'ul';
      var s = '<' + tag + '>';
      items.forEach(function (it) {
        var mark = it.task === true ? '\u2611 ' : it.task === false ? '\u2610 ' : '';
        var cls = it.task !== null && it.task !== undefined ? ' class="task"' : '';
        s += '<li' + cls + '>' + mark + inline(it.text || '');
        if (it.children && it.children.length) s += listHtml(it.children, it.children[0].ordered);
        s += '</li>';
      });
      return s + '</' + tag + '>';
    }

    function tableHtml(raw) {
      var lines = String(raw).split('\n');
      function cells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
      var head = cells(lines[0] || '');
      var sep = cells(lines[1] || '');
      var cols = head.length;
      var align = sep.map(function (c) {
        return (/^:.*:$/.test(c)) ? 'center' : /:$/.test(c) ? 'right' : '';
      });
      function tr(cs, cellTag) {
        var s = '<tr>';
        for (var i = 0; i < cols; i++) {
          s += '<' + cellTag + (align[i] ? ' style="text-align:' + align[i] + '"' : '') + '>' +
            inline(cs[i] || '') + '</' + cellTag + '>';
        }
        return s + '</tr>';
      }
      var out = '<table><thead>' + tr(head, 'th') + '</thead><tbody>';
      for (var i = 2; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        out += tr(cells(lines[i]), 'td');
      }
      return out + '</tbody></table>';
    }

    function emit(blocks) {
      var out = '';
      blocks.forEach(function (b) {
        switch (b.type) {
          case 'frontmatter': break;

          case 'toc':
            ctx.toc.push(1);
            out += '<div class="toc-body" data-toc="1"></div>';
            break;

          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
            var id = 'sec' + (ctx.heads.length + 1);
            var text = dep('inline', 'Inline').plain(dep('inline', 'Inline').tokenize(b.inline || ''));
            ctx.heads.push({ level: parseInt(b.type.slice(1), 10), id: id, text: text });
            out += '<h' + b.type.slice(1) + ' id="' + id + '">' + inline(b.inline || '') + '</h' + b.type.slice(1) + '>';
            break;
          }

          case 'hr':
            out += '<hr/>';
            break;

          case 'quote':
            out += '<blockquote>' + emit(dep('md', 'MD').parse(b.inner || '').blocks) + '</blockquote>';
            break;

          case 'code':
            out += '<pre><code' + (b.lang ? ' class="language-' + xesc(b.lang) + '"' : '') + '>' +
              xesc(b.code || '') + '</code></pre>';
            break;

          case 'math':
            out += '<div class="mathblock">' + dep('md', 'MD').texFallback(b.tex || '', true) + '</div>';
            break;

          case 'table':
            out += tableHtml(b.raw);
            break;

          case 'list':
            out += listHtml(b.items || [], b.items && b.items[0] && b.items[0].ordered);
            break;

          case 'html': {
            // ePub 是 XHTML：把原样 HTML 塞进去，未闭合的标签会让整本书不合法，
            // 所以这里只留文字（排版信息丢掉，但书能过校验）
            var txt = dep('md', 'MD').htmlText(b.raw);
            if (txt) out += '<div class="raw-html">' + txt.split('\n').map(function (l) {
              return '<p>' + xesc(l) + '</p>';
            }).join('') + '</div>';
            break;
          }

          case 'footdef':
            ctx.fnBody[b.fnId] = b.fnBody || '';
            break;

          default:
            out += '<p>' + inline(b.raw) + '</p>';
            break;
        }
      });
      return out;
    }

    ctx.emit = emit;
    return ctx;
  }

  function epub(src, opts) {
    try { dep('inline', 'Inline').setDefs(dep('inline', 'Inline').scanDefs(src)); } catch (e) {}
    opts = opts || {};
    var MD = dep('md', 'MD');
    var Zip = dep('zip', 'Zip');
    var Yaml = dep('yaml', 'Yaml');
    var model = MD.parse(src);

    // YAML front matter 覆盖导出设置
    var y = Yaml.overrides(src);
    var title = y.title || opts.title || '未命名文档';
    var author = y.author || opts.author || '';

    var ctx = slots();
    var html = stripDataAttrs(ctx.emit(model.blocks));
    // 图片尺寸：ePub 里用 width/height 属性（XHTML 合法），否则 data-* 会被剥掉
    html = html.replace(/<img\b([^>]*)>/g, function (m, attrs) {
      var wm = /\bdata-w="(\d+)"/.exec(attrs);
      var hm = /\bdata-h="(\d+)"/.exec(attrs);
      if (!wm && !hm) return m;
      var add = '';
      if (wm && parseInt(wm[1], 10)) add += ' width="' + parseInt(wm[1], 10) + '"';
      if (hm && parseInt(hm[1], 10)) add += ' height="' + parseInt(hm[1], 10) + '"';
      // data-* 只对编辑器有意义，ePub 里去掉
      return '<img' + attrs.replace(/\sdata-[wh]="\d+"/g, '') + add + '>';
    });
    // wiki 链接：目标 .md 不在包里，链接会指向一个不存在的文件 → 只留文字
    html = html.replace(/<a class="wiki-link"[^>]*>([\s\S]*?)<\/a>/g, function (m, inner) {
      return '<span class="wiki">' + inner + '</span>';
    });
    html = toXhtml(html);
    // flowchart 代码块换成内嵌 SVG（XHTML 合法：flow.js 产出的是自闭合 XML）
    html = inlineFlow(html);
    // 脚注引用 → 编号锚点（按首次出现顺序）
    html = html.replace(/<sup class="fn-ref" data-fn="([^"]*)"[^>]*>[\s\S]*?<\/sup>/g, function (m, id) {
      if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
      var n = ctx.fnNum[id];
      return '<a class="fn-ref" id="fnref' + n + '" href="#fn' + n + '">' + n + '</a>';
    });
    // 只定义没引用的脚注，也排在后面，别丢
    Object.keys(ctx.fnBody).forEach(function (id) {
      if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
    });

    if (ctx.fnOrder.length) {
      var sec = '<section class="footnotes">\n<h2>\u811a\u6ce8</h2>\n<ol>\n';
      ctx.fnOrder.forEach(function (id, i) {
        var n = i + 1;
        sec += '<li id="fn' + n + '">' + toXhtml(stripDataAttrs(MD.renderInline(ctx.fnBody[id] || '', 0))) +
          ' <a class="fn-back" href="#fnref' + n + '">\u21a9</a></li>\n';
      });
      sec += '</ol>\n</section>\n';
      html += sec;
    }

    // [TOC] 占位填内容
    var tocHtml = tocMarkup(ctx.heads) || '<p class="toc-empty">\uff08\u65e0\u6807\u9898\uff09</p>';
    html = html.split('<div class="toc-body" data-toc="1"></div>').join(tocHtml);

    // 图片：收集 + 重写成本地 images/ 路径
    var images = [], imgMap = {}, imgSrcs = [], seen = {}, mm;
    var imgRe = /<img\b[^>]*?\ssrc="([^"]*)"[^>]*>/g;
    while ((mm = imgRe.exec(html)) !== null) {
      if (!seen[mm[1]]) { seen[mm[1]] = 1; imgSrcs.push(mm[1]); }
    }

    var jobs = imgSrcs.map(function (s) {
      if (typeof opts.resolveImage !== 'function') return Promise.resolve(null);
      return Promise.resolve(opts.resolveImage(s)).then(function (r) {
        if (!r || !r.bytes) return null;
        var mime = r.mime || dep('docx', 'Docx').mimeOf(s, r.bytes);
        var ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png';
        var name = 'img' + (images.length + 1) + '.' + ext;
        images.push({ name: name, bytes: r.bytes, mime: mime });
        imgMap[s] = 'images/' + name;
        return s;
      }).catch(function () { return null; });
    });

    return Promise.all(jobs).then(function () {
      html = html.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*?)>/g, function (m, pre, s2, post) {
        if (imgMap[s2]) return '<img' + pre + ' src="' + imgMap[s2] + '"' + post + '>';
        var alt = /alt="([^"]*)"/.exec(pre + post);
        return '<span class="img-missing">[\u56fe\u7247\uff1a' + (alt ? alt[1] : s2) + ']</span>';
      });

      var uuid = 'urn:uuid:' + uuidish(title + Date.now());
      var modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      // YAML date 形如 2026-10-18 / 2026-10 时直接用作 dc:date，否则回落导出时刻
      var pubDate = /^\d{4}(-\d{2}(-\d{2})?)?/.test(y.date || '') ? y.date : modified;
      // keywords：中英文逗号 / 分号都能切
      var subjects = String(y.keywords || '').split(/[,;\uff0c\uff1b]/).map(function (s) { return s.trim(); })
        .filter(function (s) { return !!s; });

      var chapter =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n' +
        '<head><meta charset="utf-8"/><title>' + xesc(title) + '</title>' +
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n' +
        '<body class="opentypora-export">\n' + html + '\n</body>\n</html>\n';

      var navTitle = y.tocTitle || '\u76ee\u5f55';
      var nav =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n' +
        '<head><meta charset="utf-8"/><title>' + xesc(navTitle) + '</title>' +
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n' +
        '<body><nav epub:type="toc" id="toc"><h1>' + xesc(navTitle) + '</h1>' +
        (tocMarkup(ctx.heads, 'chapter.xhtml') || '<ol><li><a href="chapter.xhtml">\u6b63\u6587</a></li></ol>') +
        '</nav></body></html>\n';

      var manifestImgs = images.map(function (im, i) {
        return '<item id="img' + (i + 1) + '" href="images/' + im.name + '" media-type="' + im.mime + '"/>';
      }).join('');

      // EPUB3 副标题：主标题 + refines 元数据；没有副标题时保持单行 dc:title（与旧输出一致）
      var titleXml = y.subtitle
        ? '<dc:title id="t-main">' + xesc(title) + '</dc:title>\n' +
          '<meta refines="#t-main" property="title-type">main</meta>\n' +
          '<dc:title id="t-sub">' + xesc(y.subtitle) + '</dc:title>\n' +
          '<meta refines="#t-sub" property="title-type">subtitle</meta>\n'
        : '<dc:title>' + xesc(title) + '</dc:title>\n';

      var opf =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">\n' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
        '<dc:identifier id="bookid">' + uuid + '</dc:identifier>\n' +
        titleXml +
        '<dc:language>zh-CN</dc:language>\n' +
        (author ? '<dc:creator>' + xesc(author) + '</dc:creator>\n' : '') +
        subjects.map(function (s) { return '<dc:subject>' + xesc(s) + '</dc:subject>\n'; }).join('') +
        '<dc:date>' + pubDate + '</dc:date>\n' +
        '<meta property="dcterms:modified">' + modified + '</meta>\n' +
        '</metadata>\n' +
        '<manifest>\n' +
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
        '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>\n' +
        '<item id="css" href="style.css" media-type="text/css"/>\n' +
        manifestImgs + '\n' +
        '</manifest>\n' +
        '<spine><itemref idref="chapter"/></spine>\n' +
        '</package>\n';

      var container =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
        '</container>\n';

      var files = [
        { name: 'mimetype', data: 'application/epub+zip' },
        { name: 'META-INF/container.xml', data: container },
        { name: 'OEBPS/content.opf', data: opf },
        { name: 'OEBPS/nav.xhtml', data: nav },
        { name: 'OEBPS/chapter.xhtml', data: chapter },
        { name: 'OEBPS/style.css', data: epubCss() }
      ];
      images.forEach(function (im) { files.push({ name: 'OEBPS/images/' + im.name, data: im.bytes }); });

      return {
        bytes: Zip.build(files),
        title: title,
        chapters: 1,
        headings: ctx.heads.length,
        footnotes: ctx.fnOrder.length,
        images: images.length,
        warnings: imgSrcs.length > images.length
          ? ['\u90e8\u5206\u56fe\u7247\u672a\u80fd\u8bfb\u53d6\uff0c\u5df2\u7528\u6587\u5b57\u4ee3\u66ff\uff1a' + imgSrcs.filter(function (s2) { return !imgMap[s2]; }).join('\u3001')]
          : []
      };
    });
  }

  /* ============================================================
   * 二·B、RevealJS 幻灯片（单文件 HTML）
   *
   * 分片规则照 pandoc：先找出「幻灯片层级」——
   * 有 h1 时以 h1 横向分页、h2 纵向分页；没有 h1 时改以 h2 横向。
   * 正文沿用 ePub 那套语义块渲染（slots），标题 id 一并拿到，
   * 所以 [TOC] 在幻灯片里也是真链接。
   * ============================================================ */
  function bytesToB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function reveal(src, opts) {
    opts = opts || {};
    try { dep('inline', 'Inline').setDefs(dep('inline', 'Inline').scanDefs(src)); } catch (e) {}
    var MD = dep('md', 'MD');
    var Yaml = dep('yaml', 'Yaml');
    var model = MD.parse(src);

    // YAML front matter 覆盖导出设置
    var y = Yaml.overrides(src);
    var title = y.title || opts.title || '未命名文档';

    var hasH1 = model.blocks.some(function (b) { return b.type === 'h1'; });
    var slideLevel = hasH1 ? 1 : 2;

    var ctx = slots();
    var hs = [], curH = null, curV = null;

    function startH(b) { curH = { head: b || null, subs: [] }; hs.push(curH); curV = null; }
    function startV(b) {
      if (!curH) startH(null);
      curV = { head: b || null, blocks: [] };
      curH.subs.push(curV);
    }
    function addBlock(b) {
      if (!curV) startV(null);
      curV.blocks.push(b);
    }

    model.blocks.forEach(function (b) {
      if (b.type === 'frontmatter' || b.type === 'linkdef') return;
      var hm = /^h([1-6])$/.exec(b.type);
      var lv = hm ? parseInt(hm[1], 10) : 0;
      if (lv && lv <= slideLevel) { startH(b); return; }
      if (lv === slideLevel + 1) { startV(b); return; }
      addBlock(b);
    });
    if (!hs.length) startH(null);

    var slideCount = 0;
    var slides = hs.map(function (h) {
      var headHtml = h.head ? ctx.emit([h.head]) : '';
      // 第一个没有标题的分片属于本页正文，直接铺在 <section> 里；
      // 后面的才是有标题的纵向子页
      var subs = h.subs.slice();
      var lead = '';
      if (subs.length && !subs[0].head) { lead = ctx.emit(subs[0].blocks); subs.shift(); }

      if (!subs.length) {
        slideCount += 1;
        return '<section>\n' + headHtml + lead + '\n</section>';
      }
      // 有纵向子页时，外层 <section> 里只能放 <section>（reveal 的 vertical stack 规则），
      // 标题与引言得自己包成第一页，否则会叠在一起
      var inner = '<section>' + headHtml + lead + '</section>' +
        subs.map(function (v) { return '<section>' + ctx.emit([v.head]) + ctx.emit(v.blocks) + '</section>'; }).join('');
      slideCount += 1 + subs.length;
      return '<section>\n' + inner + '\n</section>';
    }).join('\n');

    var html = stripDataAttrs(slides);

    // 图片尺寸：与 ePub 同样搬到 width/height 属性
    html = html.replace(/<img\b([^>]*)>/g, function (m, attrs) {
      var wm = /\bdata-w="(\d+)"/.exec(attrs);
      var hm = /\bdata-h="(\d+)"/.exec(attrs);
      if (!wm && !hm) return m;
      var add = '';
      if (wm && parseInt(wm[1], 10)) add += ' width="' + parseInt(wm[1], 10) + '"';
      if (hm && parseInt(hm[1], 10)) add += ' height="' + parseInt(hm[1], 10) + '"';
      return '<img' + attrs.replace(/\sdata-[wh]="\d+"/g, '') + add + '>';
    });
    html = html.replace(/<a class="wiki-link"[^>]*>([\s\S]*?)<\/a>/g, '<span class="wiki">$1</span>');
    // flowchart 代码块换成内嵌 SVG（RevealJS 是 HTML5，SVG 直接可用）
    html = inlineFlow(html);

    // 脚注：编号锚点 + 末尾一页
    html = html.replace(/<sup class="fn-ref" data-fn="([^"]*)"[^>]*>[\s\S]*?<\/sup>/g, function (m, id) {
      if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
      var n = ctx.fnNum[id];
      return '<a class="fn-ref" href="#fn' + n + '">' + n + '</a>';
    });
    Object.keys(ctx.fnBody).forEach(function (id) {
      if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
    });

    if (ctx.fnOrder.length) {
      var fsec = '<section class="footnotes">\n<h2 class="fn-title">脚注</h2>\n<ol>\n';
      ctx.fnOrder.forEach(function (id, i) {
        var n = i + 1;
        fsec += '<li id="fn' + n + '">' + toXhtml(stripDataAttrs(MD.renderInline(ctx.fnBody[id] || '', 0))) + '</li>\n';
      });
      html += '\n' + fsec + '</ol>\n</section>';
    }

    var tocHtml = tocMarkup(ctx.heads);
    if (tocHtml) html = html.split('<div class="toc-body" data-toc="1"></div>').join(tocHtml);

    // 图片：能读到字节就内嵌成 data URI，做出来的单文件可以直接发出去
    var srcs = [], seen = {}, mm;
    var imgRe = /<img\b[^>]*?\ssrc="([^"]*)"[^>]*>/g;
    while ((mm = imgRe.exec(html)) !== null) {
      if (!seen[mm[1]]) { seen[mm[1]] = 1; srcs.push(mm[1]); }
    }

    var jobs = srcs.map(function (s) {
      if (typeof opts.resolveImage !== 'function' || /^(https?:|data:)/i.test(s)) return Promise.resolve(null);
      return Promise.resolve(opts.resolveImage(s)).then(function (r) {
        if (!r || !r.bytes) return null;
        var mime = r.mime || dep('docx', 'Docx').mimeOf(s, r.bytes);
        return { src: s, uri: 'data:' + mime + ';base64,' + bytesToB64(r.bytes) };
      }).catch(function () { return null; });
    });

    return Promise.all(jobs).then(function (got) {
      var map = {};
      got.forEach(function (g) { if (g) map[g.src] = g.uri; });
      html = html.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*?)>/g, function (m, pre, s2, post) {
        return map[s2] ? '<img' + pre + ' src="' + map[s2] + '"' + post + '>' : m;
      });

      var theme = String(opts.theme || 'white').replace(/[^\w-]/g, '') || 'white';
      var transition = String(opts.transition || 'slide').replace(/[^\w-]/g, '') || 'slide';

      // 有副标题 / 作者时补一张标题页（标题本身不用——正文的 h1 通常就是）
      var titleSlide = '';
      if (y.subtitle || y.author) {
        titleSlide = '<section class="title-slide">\n<h1>' + xesc(title) + '</h1>\n' +
          (y.subtitle ? '<p class="rv-sub">' + xesc(y.subtitle) + '</p>\n' : '') +
          (y.author ? '<p class="rv-au">' + xesc(y.author) + (y.date ? ' \u00b7 ' + xesc(y.date) : '') + '</p>\n' : '') +
          '</section>\n';
      }

      var doc =
        '<!DOCTYPE html>\n' +
        '<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<title>' + xesc(title) + '</title>\n' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.css">\n' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/theme/' + theme + '.css" id="theme">\n' +
        '<style>\n' + revealCss() + '</style>\n' +
        '</head>\n<body>\n<div class="reveal">\n<div class="slides">\n' +
        titleSlide + html + '\n</div>\n</div>\n' +
        '<script src="https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js"></script>\n' +
        '<script>\n' +
        '  if (window.Reveal) {\n' +
        '    Reveal.initialize({ hash: true, slideNumber: "c/t", controls: true,' +
        ' progress: true, transition: "' + transition + '", width: 1100, height: 720 });\n' +
        '  } else {\n' +
        '    document.documentElement.className += " no-reveal";\n' +
        '  }\n' +
        '</script>\n</body>\n</html>\n';

      return {
        text: doc,
        title: title,
        // 横向一页 + 每个纵向子页都算一页
        slides: slideCount + (ctx.fnOrder.length ? 1 : 0) + (titleSlide ? 1 : 0),
        headings: ctx.heads.length,
        footnotes: ctx.fnOrder.length,
        warnings: []
      };
    });
  }

  function revealCss() {
    return [
      '.reveal .slides { text-align: left; }',
      '.reveal .slides h1, .reveal .slides h2, .reveal .slides h3,',
      '.reveal .slides h4, .reveal .slides h5, .reveal .slides h6 {',
      '  text-transform: none; letter-spacing: 0; font-family: -apple-system, "PingFang SC", "Heiti SC", sans-serif; }',
      '.reveal .slides section { line-height: 1.6; font-family: -apple-system, "PingFang SC", "Songti SC", Georgia, serif; }',
      '.reveal .slides p { margin: 0 0 .7em; }',
      '.reveal .slides pre { width: 100%; font-size: .55em; box-shadow: none; }',
      '.reveal .slides code { font-family: Menlo, Consolas, monospace; }',
      '.reveal .slides table { font-size: .7em; border-collapse: collapse; width: 100%; }',
      '.reveal .slides th, .reveal .slides td { border: 1px solid #d0d7de; padding: .3em .5em; }',
      '.reveal .slides th { background: rgba(0,0,0,.04); }',
      '.reveal .slides img { max-width: 100%; max-height: 60vh; }',
      '.reveal .slides .flow-fig { text-align: center; }',
      '.reveal .slides .flow-fig svg { max-width: 100%; max-height: 56vh; height: auto; }',
      '.reveal .slides blockquote { border-left: 4px solid #d0d7de; padding-left: 1em; color: #555; }',
      '.reveal .slides .footnotes, .reveal .slides section.footnotes { font-size: .5em; }',
      '.reveal .slides .fn-ref { font-size: .7em; vertical-align: super; }',
      '.reveal .slides .wiki { border-bottom: 1px dashed #999; }',
      '.reveal .slides .mathblock { font-size: .8em; overflow-x: auto; }',
      /* 标题页（YAML 里有 subtitle / author 时生成） */
      '.reveal .slides section.title-slide { text-align: center; }',
      '.reveal .slides .title-slide h1 { font-size: 1.9em; margin-bottom: .35em; }',
      '.reveal .slides .rv-sub { font-size: .95em; color: #666; }',
      '.reveal .slides .rv-au { font-size: .72em; color: #888; margin-top: 1.4em; }',
      '.no-reveal .reveal .slides section.title-slide { border-bottom: 1px solid #e6e6e6; }',
      /* 离线打开（CDN 拿不到 reveal.js）时退化成纵向滚动的文档 */
      '.no-reveal body { background: #fff; }',
      '.no-reveal .reveal { position: static; width: auto; height: auto; }',
      '.no-reveal .reveal .slides { position: static; transform: none !important; width: auto; height: auto; }',
      '.no-reveal .reveal .slides section {',
      '  display: block !important; position: static; max-width: 900px; margin: 0 auto 2em;',
      '  padding: 1.4em 2em; border-bottom: 1px solid #e6e6e6; box-sizing: border-box; }',
      '.no-reveal .reveal .slides section section { border: none; padding: .4em 0; margin: 0; }'
    ].join('\n') + '\n';
  }

  function xesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function uuidish(seed) {
    // 稳定、够散的 128 位（FNV-1a 双向混），只为满足 epub 的 urn:uuid 形状
    var h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (var i = 0; i < seed.length; i++) {
      var c = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 + c * (i + 7), 2654435761) >>> 0;
    }
    function hex(n) { var t = (n >>> 0).toString(16); while (t.length < 8) t = '0' + t; return t; }
    var s = hex(h1) + hex(h2) + hex((h1 ^ h2) >>> 0) + hex((h1 + Math.imul(h2, 31)) >>> 0);
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) +
      '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
  }

  function epubCss() {
    return [
      'html, body { margin: 0; padding: 0; }',
      'body { font-family: -apple-system, "PingFang SC", "Songti SC", Georgia, serif;',
      '  line-height: 1.65; padding: 1.2em; color: #1a1a1a; word-wrap: break-word; }',
      'h1, h2, h3, h4, h5, h6 { font-family: -apple-system, "PingFang SC", "Heiti SC", sans-serif;',
      '  line-height: 1.3; margin: 1.4em 0 .6em; page-break-after: avoid; }',
      'h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }',
      'h4, h5, h6 { font-size: 1em; }',
      'p { margin: 0 0 .9em; text-align: justify; }',
      'a { color: #0969da; text-decoration: none; }',
      'blockquote { margin: .9em 0; padding: .2em 0 .2em 1em; border-left: 3px solid #ddd; color: #555; }',
      'pre { background: #f6f8fa; padding: .8em; border-radius: 4px; overflow-x: auto;',
      '  font-family: Menlo, Consolas, monospace; font-size: .85em; line-height: 1.5; white-space: pre-wrap; }',
      'code { font-family: Menlo, Consolas, monospace; font-size: .88em; background: #f2f3f5;',
      '  padding: .1em .3em; border-radius: 3px; }',
      'pre code { background: none; padding: 0; }',
      'table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }',
      'th, td { border: 1px solid #d0d7de; padding: .4em .6em; text-align: left; }',
      'th { background: #f2f3f5; }',
      'img { max-width: 100%; height: auto; }',
      '.flow-fig { text-align: center; margin: 1em 0; }',
      '.flow-fig svg { max-width: 100%; height: auto; }',
      'hr { border: none; border-top: 1px solid #ddd; margin: 1.6em 0; }',
      '.task { list-style: none; }',
      '.fn-ref { font-size: .75em; vertical-align: super; }',
      '.footnotes { margin-top: 2em; border-top: 1px solid #ddd; font-size: .9em; }',
      '.footnotes h2 { font-size: 1em; margin: .8em 0; }',
      '.img-missing { color: #999; font-style: italic; }',
      '.toc ol { padding-left: 1.2em; } .toc a { color: #1a1a1a; }',
      'ul, ol { padding-left: 1.4em; } li { margin: .2em 0; }'
    ].join('\n') + '\n';
  }

  /* ============================================================
   * 三、分发
   * ============================================================ */
  // PDF 纸张：尺寸与原生侧 NSPrintInfo 里写死的值保持一份来源，避免两边漂移
  var PAPERS = {
    a4: { label: 'A4', w: 595.28, h: 841.89 },
    letter: { label: 'Letter', w: 612, h: 792 },
    a3: { label: 'A3', w: 841.89, h: 1190.55 },
    a5: { label: 'A5', w: 419.53, h: 595.28 }
  };

  // 把偏好设置里可能被手改成垃圾值的字段夹回合法区间，
  // 再交给桥。纯函数，便于单测。
  function pdfOptions(o) {
    o = o || {};
    var paper = String(o.paper == null ? 'a4' : o.paper).toLowerCase();
    if (!PAPERS[paper]) paper = 'a4';
    var margin = Number(o.margin);
    if (!isFinite(margin)) margin = 42;
    margin = Math.max(0, Math.min(120, Math.round(margin)));
    return {
      paper: paper,
      margin: margin,
      headerFooter: !!o.headerFooter,
      h1page: !!o.h1page,
      // 书签默认开：有标题的大多数是长文，没有书签反而难翻。
      // 只有「没给」才算默认，给了 false/0 都当关掉
      bookmarks: o.bookmarks == null ? true : !!o.bookmarks
    };
  }

  /* ---------------------------------------------------------- PDF 书签
   * 原生侧拿这串标题去 PDF 里找页（PDFKit 的 findString），所以文字必须是
   * 「渲染后能搜到」的纯文本：去掉 `**`、反引号、链接语法、脚注标记。
   * 围栏里的 `#` 不是标题，必须跳过 —— 否则代码里的注释会变成书签。
   */
  function plainHeading(s) {
    return String(s == null ? '' : s)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')          // 图片 → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')            // 链接 → 文字
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')           // 引用式链接
      .replace(/\[\^[^\]]*\]/g, '')                        // 脚注引用
      .replace(/`+([^`]*)`+/g, '$1')                       // 行内代码
      .replace(/(\*\*|__)(.*?)\1/g, '$2')                  // 粗体
      .replace(/(\*|_)(.*?)\1/g, '$2')                     // 斜体
      .replace(/~~(.*?)~~/g, '$1')                         // 删除线
      .replace(/<[^>]+>/g, '')                             // 行内 HTML
      .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')         // 转义
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pdfOutline(src) {
    var lines = String(src == null ? '' : src).split('\n');
    var out = [], fence = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        // 同一种围栏字符才闭合，避免 ``` 里套 ~~~ 时提前收尾
        if (!fence) fence = f[1][0];
        else if (fence === f[1][0]) fence = null;
        continue;
      }
      if (fence) continue;
      var m = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
      if (!m) continue;
      var text = plainHeading(m[2]);
      if (text) out.push({ level: m[1].length, text: text });
    }
    return out;
  }

  // 图片导出只认 PNG / JPEG，其它一律退成 PNG
  function imageFormat(f) {
    return String(f == null ? 'png' : f).toLowerCase() === 'jpeg' ? 'jpeg' : 'png';
  }

  function imageExt(f) {
    return imageFormat(f) === 'jpeg' ? 'jpg' : 'png';
  }

  var FORMATS = {
    docx: { ext: 'docx', label: 'Word 文档', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    odt: { ext: 'odt', label: 'OpenDocument 文本', type: 'application/vnd.oasis.opendocument.text' },
    epub: { ext: 'epub', label: 'ePub 电子书', type: 'application/epub+zip' },
    tex: { ext: 'tex', label: 'LaTeX 源码', type: 'text/x-tex' },
    rtf: { ext: 'rtf', label: 'RTF 富文本', type: 'application/rtf' },
    rst: { ext: 'rst', label: 'reStructuredText', type: 'text/x-rst' },
    mediawiki: { ext: 'wiki', label: 'MediaWiki 源码', type: 'text/x-wiki' },
    textile: { ext: 'textile', label: 'Textile', type: 'text/x-textile' },
    opml: { ext: 'opml', label: 'OPML 大纲', type: 'text/x-opml' },
    revealjs: { ext: 'html', label: 'RevealJS 幻灯片', type: 'text/html' }
  };

  function build(kind, src, opts) {
    opts = opts || {};
    if (kind === 'docx') return dep('docx', 'Docx').build(src, opts);
    if (kind === 'odt') return dep('odt', 'Odt').odt(src, opts);
    if (kind === 'epub') return epub(src, opts);
    if (kind === 'revealjs') return reveal(src, opts);
    if (kind === 'tex') {
      return Promise.resolve({ text: latex(src, opts), warnings: [] });
    }
    if (kind === 'rtf' || kind === 'rst' || kind === 'mediawiki' || kind === 'textile' || kind === 'opml') {
      var TF = dep('textfmt', 'TextFmt');
      return Promise.resolve(TF[kind](src, opts));
    }
    return Promise.reject(new Error('不支持的导出格式：' + kind));
  }

  /* ---------------------------------------------------------- HTML 导出
   * 纯字符串处理：包壳、扫图片引用、回填 data URI。
   * 真正读文件由 ui.js 走 Bridge（这里不碰 fs，保持 Node 可测）。
   */
  var HTML_OPTS = { styles: true, embed: false, width: true };

  /* 内置主题：必须与 app.css 里的 html[data-theme="…"] 一一对应。
   * 导出时把 id 写进 <html data-theme>，样式内联进 <head> 就能换皮。 */
  var THEMES = [
    { id: 'github', label: 'GitHub' },
    { id: 'night', label: 'Night' },
    { id: 'newsprint', label: 'Newsprint' },
    { id: 'pixyll', label: 'Pixyll' },
    { id: 'whitey', label: 'Whitey' },
    { id: 'gothic', label: 'Gothic' }
  ];

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  /* 主题选择归一化：'night' → 内置；'user:my.css' → 自定义主题叠在 base 上。
   * 未知值一律回落 github，别让一个手改坏的偏好把导出搞成白板。 */
  function themePick(v, base) {
    var s = String(v == null ? '' : v).trim(), file = '';
    if (s.indexOf('user:') === 0) {
      file = s.slice(5).replace(/[\\/]/g, '').replace(/^\.+/, '');
      s = '';
    }
    if (!s) s = String(base == null ? '' : base);
    s = s.toLowerCase();
    if (!themeById(s)) s = 'github';
    return { id: s, file: file, raw: file ? 'user:' + file : s };
  }

  function htmlOptions(o) {
    o = o || {};
    var pick = themePick(o.theme, o.base);
    return {
      styles: o.styles !== false,
      embed: !!o.embed,
      width: o.width !== false,
      // 选中的主题（内置 id）与自定义主题文件名（空串 = 纯内置）
      theme: pick.id,
      themeFile: pick.file,
      title: String(o.title == null ? '' : o.title),
      // YAML front matter 带来的元信息（HTML <head> 的 meta 标签）
      author: String(o.author == null ? '' : o.author),
      keywords: String(o.keywords == null ? '' : o.keywords),
      description: String(o.description == null ? '' : o.description),
      date: String(o.date == null ? '' : o.date),
      // 用户自定义片段：原样拼进 <head> 末尾与 </body> 之前
      head: String(o.head == null ? '' : o.head),
      tail: String(o.tail == null ? '' : o.tail),
      // 版式三件套：字体族 / 行距 / 背景色（原值透传，htmlDoc 用 typography.js 归一化）
      font: String(o.font == null ? '' : o.font),
      leading: o.leading == null ? '' : o.leading,
      bg: String(o.bg == null ? '' : o.bg)
    };
  }

  function hesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function htmlDoc(body, o) {
    var opt = htmlOptions(o);
    var style = opt.width ? ' style="max-width:830px;margin:0 auto;padding:40px 20px"' : '';
    var metas = '';
    if (opt.author) metas += '<meta name="author" content="' + hesc(opt.author) + '">\n';
    if (opt.keywords) metas += '<meta name="keywords" content="' + hesc(opt.keywords) + '">\n';
    if (opt.description) metas += '<meta name="description" content="' + hesc(opt.description) + '">\n';
    if (opt.date) metas += '<meta name="dcterms.created" content="' + hesc(opt.date) + '">\n';
    // 自定义片段原样输出（用户自己负责它是合法 HTML），只补一个换行便于阅读
    var head = opt.head.trim() ? opt.head.replace(/\s+$/, '') + '\n' : '';
    var tail = opt.tail.trim() ? opt.tail.replace(/\s+$/, '') + '\n' : '';
    // data-theme 让 app.css 里 html[data-theme="…"] 那套变量生效；
    // opentypora-export 用来摘掉应用外壳的 overflow:hidden / height:100%
    // 版式（字体/行距/背景）写成 <html> 的行内变量：app.css 是后注入的，
    // 只有行内样式才压得住 html[data-theme] 里的同名变量，导出页才与所见一致。
    var tstyle = '';
    var T = dep('typography', 'Typo');
    if (T && T.styleOf) {
      var s = T.styleOf({ font: opt.font, leading: opt.leading, bg: opt.bg });
      if (s) tstyle = ' style="' + hesc(s) + '"';
    }
    return '<!DOCTYPE html>\n<html data-theme="' + opt.theme + '" class="opentypora-export"' + tstyle + '>\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + hesc(opt.title) + '</title>\n' +
      metas + head + '</head>\n<body class="opentypora-export">\n' +
      '<div class="editor"' + style + '>' + body + '</div>\n' + tail + '</body>\n</html>\n';
  }

  var RE_IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi;

  /* 需要读盘的图片引用（去重；data:/http(s):/协议相对/blob: 都跳过） */
  function imageRefs(html) {
    var out = [], seen = {}, m;
    var re = new RegExp(RE_IMG_SRC.source, 'gi');
    while ((m = re.exec(String(html || ''))) !== null) {
      var src = m[3];
      if (!src || seen[src]) continue;
      if (/^(data:|https?:|\/\/|blob:|file:)/i.test(src)) continue;
      seen[src] = 1;
      out.push(src);
    }
    return out;
  }

  /* map: { 原引用 → data URI }；没命中的保持原样 */
  function applyImageMap(html, map) {
    if (!map) return String(html || '');
    return String(html || '').replace(RE_IMG_SRC, function (all, pre, q, src) {
      return Object.prototype.hasOwnProperty.call(map, src) ? pre + q + map[src] + q : all;
    });
  }

  var MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
    ico: 'image/x-icon'
  };

  function mimeOf(path) {
    var m = /\.([a-z0-9]+)$/i.exec(String(path || '').split('?')[0]);
    return (m && MIME[m[1].toLowerCase()]) || 'application/octet-stream';
  }

  function dataUri(path, base64) {
    return 'data:' + mimeOf(path) + ';base64,' + String(base64 || '');
  }

  return {
    build: build,
    latex: latex,
    epub: epub,
    reveal: reveal,
    formats: FORMATS,
    papers: PAPERS,
    pdfOptions: pdfOptions,
    pdfOutline: pdfOutline,
    imageFormat: imageFormat,
    imageExt: imageExt,
    texEsc: texEsc,
    toXhtml: toXhtml,
    // HTML 导出
    htmlOptions: htmlOptions,
    htmlDoc: htmlDoc,
    themes: THEMES,
    themePick: themePick,
    imageRefs: imageRefs,
    applyImageMap: applyImageMap,
    mimeOf: mimeOf,
    dataUri: dataUri,
    inlineFlow: inlineFlow,
    unescCode: unescCode,
    HTML_OPTS: HTML_OPTS,
    // YAML front matter → 导出覆盖（ui.js 的 HTML / PDF 导出用）
    readYaml: function (src) { return dep('yaml', 'Yaml').overrides(src); }
  };
});
