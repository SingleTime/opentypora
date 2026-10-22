/* ============================================================
 * odt.js — OpenDocument 文本（.odt）导出
 *
 * 出 ODT 的常见做法是靠 pandoc，这里不依赖任何外部二进制：
 * odt 就是一个 zip（mimetype + content.xml + styles.xml + meta.xml +
 * META-INF/manifest.xml），复用 zip.js 的 store 写入器即可。
 *
 * 映射：标题 → text:h（带 outline-level，LibreOffice 里可直接出目录）、
 * 段落 → text:p、列表 → text:list、表格 → table:table、代码 → 等宽段落、
 * 脚注 → text:note（ODT 原生脚注，不是文末列表）、图片 → Pictures/ + draw:frame。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Odt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }

  var NS =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" ' +
    'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"';

  /* ------------------------------------------------------------ 文本转义 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ODT 里连续空格会被折叠；两连及以上要写成 <text:s text:c="n"/>
  function textXml(s) {
    var out = esc(s);
    out = out.replace(/(\u0020){2,}/g, function (m) {
      return '<text:s text:c="' + m.length + '"/>';
    });
    out = out.replace(/\t/g, '<text:tab/>');
    return out;
  }

  function attr(s) { return esc(s).replace(/\n/g, ' '); }

  /* ------------------------------------------------------------ 图片尺寸 */
  function imgSize(bytes) {
    try {
      if (!bytes || bytes.length < 10) return null;
      var b = bytes;
      // PNG: \x89PNG ... IHDR
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
        var w = (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0;
        var h = (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0;
        return w && h ? { w: w, h: h } : null;
      }
      // GIF: GIF87a / GIF89a
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
        return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
      }
      // JPEG: 扫 SOF0..SOF3 / SOF5..SOF15
      if (b[0] === 0xFF && b[1] === 0xD8) {
        var p = 2;
        while (p + 9 < b.length) {
          if (b[p] !== 0xFF) { p++; continue; }
          var mk = b[p + 1];
          var len = (b[p + 2] << 8) | b[p + 3];
          if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
            return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
          }
          if (len <= 0) break;
          p += 2 + len;
        }
      }
    } catch (e) {}
    return null;
  }

  // 96dpi → cm，宽度封顶 15cm（A4 去掉 2.5cm 边距的可用宽度是 16cm）
  var MAXW = 15;
  function sizeCm(px) { return Math.round((px / 96) * 2.54 * 100) / 100; }

  /* ------------------------------------------------------------ 自动样式 */
  function autoStyles() {
    var s = '<office:automatic-styles>';
    s += '<style:style style:name="Tb" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>';
    s += '<style:style style:name="Ti" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>';
    s += '<style:style style:name="Tbi" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>';
    s += '<style:style style:name="Tdel" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>';
    s += '<style:style style:name="Tmono" style:family="text"><style:text-properties style:font-name="Mono" fo:font-family="Menlo, Consolas, monospace" style:font-pitch="fixed" fo:font-size="90%"/></style:style>';
    s += '<style:style style:name="Tsup" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>';
    s += '<style:style style:name="Tsub" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>';
    s += '<style:style style:name="Tmark" style:family="text"><style:text-properties fo:background-color="#fff3a8"/></style:style>';
    s += '<style:style style:name="Tlink" style:family="text"><style:text-properties fo:color="#1a6fc4" style:text-underline-style="solid" style:text-underline-width="auto"/></style:style>';

    // 段落样式
    s += '<style:style style:name="Pstd" style:family="paragraph">' +
      '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.32cm" fo:line-height="150%"/></style:style>';
    s += '<style:style style:name="Pquote" style:family="paragraph">' +
      '<style:paragraph-properties fo:margin-left="0.8cm" fo:margin-right="0.4cm" fo:margin-bottom="0.2cm" ' +
      'fo:border-left="0.06cm solid #cccccc" fo:padding-left="0.4cm" fo:line-height="140%"/></style:style>';
    s += '<style:style style:name="Pcode" style:family="paragraph">' +
      '<style:paragraph-properties fo:margin-left="0.4cm" fo:margin-bottom="0cm" fo:line-height="120%" ' +
      'fo:background-color="#f4f5f7" fo:padding="0.1cm"/>' +
      '<style:text-properties style:font-name="Mono" fo:font-family="Menlo, Consolas, monospace" ' +
      'style:font-pitch="fixed" fo:font-size="88%"/></style:style>';
    s += '<style:style style:name="Phr" style:family="paragraph">' +
      '<style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.3cm" ' +
      'fo:border-bottom="0.02cm solid #cccccc"/></style:style>';
    s += '<style:style style:name="Pfig" style:family="paragraph">' +
      '<style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.4cm"/></style:style>';

    // 表格
    s += '<style:style style:name="Tbl" style:family="table">' +
      '<style:table-properties style:width="16cm" table:align="margins" table:border-model="collapsing"/></style:style>';
    s += '<style:style style:name="Tcell" style:family="table-cell">' +
      '<style:table-cell-properties fo:border="0.02cm solid #999999" fo:padding="0.12cm"/></style:style>';
    s += '<style:style style:name="Thead" style:family="table-cell">' +
      '<style:table-cell-properties fo:border="0.02cm solid #999999" fo:padding="0.12cm" fo:background-color="#f2f2f2"/>' +
      '<style:text-properties fo:font-weight="bold"/></style:style>';

    // 列表：项目符号 + 编号，各六级
    var lv;
    s += '<text:list-style style:name="LB">';
    for (lv = 1; lv <= 6; lv++) {
      s += '<text:list-level-style-bullet text:level="' + lv + '" text:bullet-char="' +
        (lv === 1 ? '\u2022' : lv === 2 ? '\u25e6' : '\u25aa') + '">' +
        '<style:list-level-properties text:space-before="' + (lv * 0.6) + 'cm" text:min-label-width="0.5cm"/></text:list-level-style-bullet>';
    }
    s += '</text:list-style>';
    s += '<text:list-style style:name="LN">';
    for (lv = 1; lv <= 6; lv++) {
      s += '<text:list-level-style-number text:level="' + lv + '" style:num-format="1" style:num-suffix=".">' +
        '<style:list-level-properties text:space-before="' + (lv * 0.6) + 'cm" text:min-label-width="0.6cm"/></text:list-level-style-number>';
    }
    s += '</text:list-style>';

    s += '</office:automatic-styles>';
    return s;
  }

  /* ------------------------------------------------------------ 行内 */
  function inlineXml(tokens, ctx, base) {
    base = base || {};
    return (tokens || []).map(function (t) {
      switch (t.t) {
        case 'text': return textXml(t.v);
        case 'code': return '<text:span text:style-name="Tmono">' + textXml(t.v) + '</text:span>';
        case 'strong': return wrap('Tb', inlineXml(t.kids, ctx, base));
        case 'em': return wrap('Ti', inlineXml(t.kids, ctx, base));
        case 'del': return wrap('Tdel', inlineXml(t.kids, ctx, base));
        case 'mark': return wrap('Tmark', inlineXml(t.kids, ctx, base));
        case 'sup': return wrap('Tsup', inlineXml(t.kids, ctx, base));
        case 'sub': return wrap('Tsub', inlineXml(t.kids, ctx, base));
        case 'u': return wrap('Tlink', inlineXml(t.kids, ctx, base));
        case 'br': return '<text:line-break/>';
        case 'wiki': return textXml(t.label || t.target || '');
        case 'link':
          return '<text:a xlink:type="simple" xlink:href="' + esc(t.href || '') + '">' +
            inlineXml(t.kids, ctx, base) + '</text:a>';
        case 'math': return '<text:span text:style-name="Tmono">' + textXml(t.v) + '</text:span>';
        case 'fn': return noteXml(t.id, ctx);
        case 'img': return imgXml(t, ctx);
        default: return '';
      }
    }).join('');
  }

  function wrap(style, inner) {
    if (!inner) return '';
    return '<text:span text:style-name="' + style + '">' + inner + '</text:span>';
  }

  function imgXml(t, ctx) {
    var im = ctx.imgMap[t.src];
    if (!im) return '<text:span text:style-name="Tmono">[\u56fe\u7247\uff1a' + esc(t.alt || t.src) + ']</text:span>';
    return '<draw:frame draw:name="' + esc(im.name) + '" text:anchor-type="as-char" ' +
      'svg:width="' + im.wcm + 'cm" svg:height="' + im.hcm + 'cm">' +
      '<draw:image xlink:href="Pictures/' + esc(im.name) + '" xlink:type="simple" ' +
      'xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>';
  }

  function noteXml(id, ctx) {
    if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
    var n = ctx.fnNum[id];
    var body = ctx.fnBody[id] || '';
    var xml = '<text:note text:id="ftn' + n + '" text:note-class="footnote">' +
      '<text:note-citation>' + n + '</text:note-citation><text:note-body>';
    var blocks = body ? dep('md', 'MD').parse(body).blocks : [];
    if (!blocks.length) xml += '<text:p>' + textXml(body) + '</text:p>';
    else {
      blocks.forEach(function (b) {
        xml += '<text:p text:style-name="Pstd">' + inlineXml(tokensOf(b), ctx) + '</text:p>';
      });
    }
    return xml + '</text:note-body></text:note>';
  }

  function tokensOf(b) {
    var Inline = dep('inline', 'Inline');
    if (b.inline != null) return Inline.tokenize(b.inline);
    return Inline.tokenize(b.raw || '');
  }

  /* ------------------------------------------------------------ 表格 */
  function tableXml(raw, ctx) {
    var lines = String(raw).split('\n');
    function cells(l) {
      return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
        .map(function (c) { return c.trim(); });
    }
    var head = cells(lines[0] || '');
    var sep = cells(lines[1] || '');
    var cols = Math.max(head.length, 1);
    var out = '<table:table table:name="T' + (ctx.tblSeq++) + '" table:style-name="Tbl">';
    out += '<table:table-column table:number-columns-repeated="' + cols + '"/>';
    function row(cs, cellStyle) {
      var r = '<table:table-row>';
      for (var i = 0; i < cols; i++) {
        r += '<table:table-cell table:style-name="' + cellStyle + '" office:value-type="string">' +
          '<text:p text:style-name="Pstd">' +
          inlineXml(dep('inline', 'Inline').tokenize(cs[i] || ''), ctx) + '</text:p></table:table-cell>';
      }
      return r + '</table:table-row>';
    }
    out += row(head, 'Thead');
    for (var i = 2; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      out += row(cells(lines[i]), 'Tcell');
    }
    void sep;
    return out + '</table:table>';
  }

  /* ------------------------------------------------------------ 列表 */
  function listXml(items, ordered, ctx, depth) {
    if (!items || !items.length) return '';
    var style = ordered ? 'LN' : 'LB';
    var out = '<text:list text:style-name="' + style + '">';
    items.forEach(function (it) {
      var mark = it.task === true ? '\u2611 ' : it.task === false ? '\u2610 ' : '';
      out += '<text:list-item><text:p text:style-name="Pstd">' +
        textXml(mark) + inlineXml(dep('inline', 'Inline').tokenize(it.text || ''), ctx) + '</text:p>';
      if (it.children && it.children.length) {
        out += listXml(it.children, !!(it.children[0] && it.children[0].ordered), ctx, depth + 1);
      }
      out += '</text:list-item>';
    });
    return out + '</text:list>';
  }

  /* ------------------------------------------------------------ 主体 */
  function bodyFor(blocks, ctx, style) {
    var out = '';
    blocks.forEach(function (b) {
      var t = b.type;
      if (t === 'frontmatter' || t === 'linkdef') return;
      if (t === 'footdef') { ctx.fnBody[b.fnId] = b.fnBody || ''; return; }
      if (t === 'toc') {
        out += '<text:p text:style-name="Pstd"><text:span text:style-name="Ti">[TOC]</text:span></text:p>';
        return;
      }
      if (/^h[1-6]$/.test(t)) {
        var lv = parseInt(t.slice(1), 10);
        out += '<text:h text:outline-level="' + lv + '" text:style-name="Heading_' + lv + '_20_">' +
          inlineXml(dep('inline', 'Inline').tokenize(b.inline || ''), ctx) + '</text:h>';
        return;
      }
      if (t === 'hr') { out += '<text:p text:style-name="Phr"/>'; return; }
      if (t === 'code') {
        String(b.code || '').split('\n').forEach(function (line) {
          out += '<text:p text:style-name="Pcode">' + (line ? textXml(line) : '') + '</text:p>';
        });
        return;
      }
      if (t === 'math') {
        out += '<text:p text:style-name="Pcode">' + textXml(b.tex || '') + '</text:p>';
        return;
      }
      if (t === 'table') { out += tableXml(b.raw, ctx); return; }
      if (t === 'list') {
        out += listXml(b.items || [], !!(b.items && b.items[0] && b.items[0].ordered), ctx, 0);
        return;
      }
      if (t === 'quote') {
        var inner = dep('md', 'MD').parse(b.inner || '').blocks;
        out += bodyFor(inner, ctx, 'Pquote');
        return;
      }
      if (t === 'html') {
        var txt = dep('md', 'MD').htmlText(b.raw);
        if (txt) {
          txt.split('\n').forEach(function (l) {
            out += '<text:p text:style-name="' + (style || 'Pstd') + '">' + textXml(l) + '</text:p>';
          });
        }
        return;
      }
      // 普通段落 / 图片段
      var xml = inlineXml(dep('inline', 'Inline').tokenize(b.raw || ''), ctx);
      if (!xml) return;
      out += '<text:p text:style-name="' + (style || 'Pstd') + '">' + xml + '</text:p>';
    });
    return out;
  }

  /* ------------------------------------------------------------ 收集图片 */
  function collectImgs(blocks, acc) {
    var Inline = dep('inline', 'Inline');
    function scan(str) {
      if (!str) return;
      Inline.tokenize(str).forEach(function (t) {
        if (t.t === 'img') acc.push(t.src);
        else if (t.kids) walk(t.kids);
      });
    }
    function walk(ts) {
      (ts || []).forEach(function (t) {
        if (t.t === 'img') acc.push(t.src);
        else if (t.kids) walk(t.kids);
      });
    }
    function items(list) {
      (list || []).forEach(function (it) { scan(it.text); items(it.children); });
    }
    (blocks || []).forEach(function (b) {
      if (b.type === 'frontmatter' || b.type === 'linkdef') return;
      if (b.inline != null) scan(b.inline);
      else if (b.type === 'list') items(b.items);
      else if (b.type === 'quote') collectImgs(dep('md', 'MD').parse(b.inner || '').blocks, acc);
      else if (b.type === 'footdef') scan(b.fnBody);
      else if (b.type === 'table') {
        String(b.raw || '').split('\n').forEach(function (l) {
          l.split('|').forEach(function (c) { scan(c.trim()); });
        });
      } else if (b.raw && !/^(code|math|html|hr|toc)$/.test(b.type)) scan(b.raw);
    });
    return acc;
  }

  /* ------------------------------------------------------------ 样式表 */
  function headingStyles() {
    var s = '';
    var sizes = [26, 21, 18, 16, 14.5, 13];
    for (var i = 1; i <= 6; i++) {
      s += '<style:style style:name="Heading_' + i + '_20_" style:family="paragraph" style:parent-style-name="Standard" ' +
        'style:default-outline-level="' + i + '" style:class="text">' +
        '<style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.25cm" fo:keep-with-next="always"/>' +
        '<style:text-properties fo:font-size="' + sizes[i - 1] + 'pt" fo:font-weight="bold"/></style:style>';
    }
    return s;
  }

  function contentXml(body) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<office:document-content ' + NS + ' office:version="1.2">' +
      '<office:font-face-decls>' +
      '<style:font-face style:name="Mono" svg:font-family="Menlo, Consolas, monospace" style:font-pitch="fixed"/>' +
      '</office:font-face-decls>' +
      autoStyles() +
      '<office:body><office:text>' + body + '</office:text></office:body>' +
      '</office:document-content>';
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<office:document-styles ' + NS + ' office:version="1.2">' +
      '<office:font-face-decls>' +
      '<style:font-face style:name="Mono" svg:font-family="Menlo, Consolas, monospace" style:font-pitch="fixed"/>' +
      '</office:font-face-decls>' +
      '<office:styles>' +
      '<style:default-style style:family="paragraph">' +
      '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.32cm" fo:line-height="150%"/>' +
      '<style:text-properties fo:font-size="11pt" style:font-name="PingFang SC" fo:font-family="PingFang SC"/>' +
      '</style:default-style>' +
      '<style:style style:name="Standard" style:family="paragraph" style:class="text">' +
      '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.32cm" fo:line-height="150%"/></style:style>' +
      headingStyles() +
      '</office:styles>' +
      '<office:automatic-styles>' +
      '<style:page-layout style:name="pm1">' +
      '<style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" ' +
      'fo:margin-top="2.5cm" fo:margin-bottom="2.5cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm"/>' +
      '</style:page-layout></office:automatic-styles>' +
      '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>' +
      '</office:document-styles>';
  }

  // y: YAML front matter 覆盖（subtitle → dc:subject，keywords → meta:keyword，date → 创建时间）
  function metaXml(title, author, y) {
    y = y || {};
    var created = /^\d{4}(-\d{2}(-\d{2})?)?/.test(y.date || '')
      ? y.date + (y.date.length === 4 ? '-01-01T00:00:00Z' : (y.date.length === 7 ? '-01T00:00:00Z' : 'T00:00:00Z'))
      : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<office:document-meta ' + NS + ' office:version="1.2"><office:meta>' +
      '<meta:generator>OpenTypora ODT</meta:generator>' +
      '<dc:title>' + esc(title) + '</dc:title>' +
      (y.subtitle ? '<dc:subject>' + esc(y.subtitle) + '</dc:subject>' : '') +
      (author ? '<dc:creator>' + esc(author) + '</dc:creator>' : '') +
      (y.keywords ? '<meta:keyword>' + esc(y.keywords) + '</meta:keyword>' : '') +
      '<meta:creation-date>' + created + '</meta:creation-date>' +
      '</office:meta></office:document-meta>';
  }

  function manifestXml(images) {
    var m = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" ' +
      'manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>';
    images.forEach(function (im) {
      m += '<manifest:file-entry manifest:full-path="Pictures/' + esc(im.name) + '" manifest:media-type="' + im.mime + '"/>';
    });
    return m + '</manifest:manifest>';
  }

  /* ------------------------------------------------------------ 入口 */
  function odt(src, opts) {
    opts = opts || {};
    var MD = dep('md', 'MD');
    var Zip = dep('zip', 'Zip');
    var Inline = dep('inline', 'Inline');
    var Yaml = dep('yaml', 'Yaml');
    try { Inline.setDefs(Inline.scanDefs(src)); } catch (e) {}

    var model = MD.parse(src);
    // YAML front matter 覆盖导出设置
    var y = Yaml.overrides(src);
    var title = y.title || opts.title || '未命名文档';
    var author = y.author || opts.author || '';

    var srcs = [];
    collectImgs(model.blocks, srcs);
    var uniq = [];
    srcs.forEach(function (s) { if (uniq.indexOf(s) < 0) uniq.push(s); });

    var missing = [];
    var jobs = uniq.map(function (s) {
      if (typeof opts.resolveImage !== 'function') { missing.push(s); return Promise.resolve(null); }
      return Promise.resolve(opts.resolveImage(s)).then(function (r) {
        if (!r || !r.bytes) { missing.push(s); return null; }
        return r;
      }).catch(function () { missing.push(s); return null; });
    });

    return Promise.all(jobs).then(function (results) {
      var ctx = {
        imgMap: {}, images: [], fnBody: {}, fnNum: {}, fnOrder: [], tblSeq: 0
      };
      // 先登记脚注正文，引用可能在正文任何位置
      model.blocks.forEach(function (b) {
        if (b.type === 'footdef') ctx.fnBody[b.fnId] = b.fnBody || '';
      });

      results.forEach(function (r, i) {
        if (!r) return;
        var s = uniq[i];
        var mime = r.mime || (dep('docx', 'Docx').mimeOf ? dep('docx', 'Docx').mimeOf(s, r.bytes) : 'image/png');
        var ext = mime === 'image/jpeg' ? 'jpg' : mime.indexOf('svg') >= 0 ? 'svg' : (mime.split('/')[1] || 'png');
        var name = 'img' + (ctx.images.length + 1) + '.' + ext;
        var dim = imgSize(r.bytes) || { w: 720, h: 480 };
        var wcm = sizeCm(dim.w), hcm = sizeCm(dim.h);
        if (wcm > MAXW) { hcm = Math.round(hcm * (MAXW / wcm) * 100) / 100; wcm = MAXW; }
        ctx.imgMap[s] = { name: name, wcm: wcm, hcm: hcm };
        ctx.images.push({ name: name, bytes: r.bytes, mime: mime });
      });

      var body = bodyFor(model.blocks, ctx, null);

      // 只定义没引用的脚注也别丢
      Object.keys(ctx.fnBody).forEach(function (id) {
        if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
      });

      var files = [
        { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
        { name: 'content.xml', data: contentXml(body) },
        { name: 'styles.xml', data: stylesXml() },
        { name: 'meta.xml', data: metaXml(title, author, y) },
        { name: 'META-INF/manifest.xml', data: manifestXml(ctx.images) }
      ];
      ctx.images.forEach(function (im) { files.push({ name: 'Pictures/' + im.name, data: im.bytes }); });

      return {
        bytes: Zip.build(files),
        title: title,
        headings: model.blocks.filter(function (b) { return /^h[1-6]$/.test(b.type); }).length,
        footnotes: ctx.fnOrder.length,
        images: ctx.images.length,
        warnings: missing.length
          ? ['部分图片未能读取，已用文字代替：' + missing.join('、')]
          : []
      };
    });
  }

  return { odt: odt, imgSize: imgSize, textXml: textXml, sizeCm: sizeCm };
});
