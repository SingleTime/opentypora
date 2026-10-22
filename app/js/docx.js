/* ============================================================
 * docx.js — Markdown → Word (.docx) 生成器（纯 JS，无 pandoc）
 *
 * 为什么不调 pandoc：pandoc 单文件 arm64 解压后约 120 MB，塞进
 * 这个 app 会让包体从 5 MB 直接变成 130 MB。这里手写 OOXML：
 * zip.js 打 store 包 + 一小段 WordprocessingML，跑完不到 100 KB。
 *
 * 覆盖：标题 1-6 / 段落 / 引用 / 有序无序列表（含任务项）/
 * 表格（对齐继承分隔行）/ 代码块 / 行内代码 / 粗斜删高亮 /
 * 链接 / 图片（内嵌，按 PNG·JPEG·GIF 读真实像素尺寸）/
 * 脚注（真 w:footnote，不是假的尾注）/ 分隔线 / [TOC]（TOC 域）
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Docx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }
  var MDm = null, Inlinem = null, Zipm = null;
  function md() { if (!MDm) MDm = dep('md', 'MD'); return MDm; }
  function inline() { if (!Inlinem) Inlinem = dep('inline', 'Inline'); return Inlinem; }
  function zip() { if (!Zipm) Zipm = dep('zip', 'Zip'); return Zipm; }

  var MAX_W_EMU = 5731510;   // A4 左右各 2.54cm 后的正文宽度
  var PAGE_EMU_PER_TWIP = 635;

  /* ---------------------------------------------------------- 转义 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  /* ---------------------------------------------------------- 图片尺寸嗅探 */
  function sniffSize(bytes) {
    try {
      // PNG
      if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return {
          w: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0,
          h: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0
        };
      }
      // GIF
      if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        return { w: bytes[6] | (bytes[7] << 8), h: bytes[8] | (bytes[9] << 8) };
      }
      // JPEG
      if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
        var i = 2;
        while (i + 9 < bytes.length) {
          if (bytes[i] !== 0xFF) { i++; continue; }
          var marker = bytes[i + 1];
          if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
          var len = (bytes[i + 2] << 8) | bytes[i + 3];
          if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
          }
          i += 2 + len;
        }
      }
      // BMP
      if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
        return {
          w: (bytes[18] | bytes[19] << 8 | bytes[20] << 16 | bytes[21] << 24) >>> 0,
          h: Math.abs((bytes[22] | bytes[23] << 8 | bytes[24] << 16 | bytes[25] << 24) << 0)
        };
      }
    } catch (e) { }
    return null;
  }

  function mimeOf(path, bytes) {
    var p = String(path || '').toLowerCase().split('?')[0];
    if (/\.png$/.test(p)) return 'image/png';
    if (/\.jpe?g$/.test(p)) return 'image/jpeg';
    if (/\.gif$/.test(p)) return 'image/gif';
    if (/\.bmp$/.test(p)) return 'image/bmp';
    if (bytes && bytes.length > 4) {
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
      if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
    }
    return 'image/png';
  }

  /* ---------------------------------------------------------- 静态部件 */
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  function contentTypes(hasImages, hasFootnotes) {
    var exts = [
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>'
    ];
    if (hasImages) {
      exts.push('<Default Extension="png" ContentType="image/png"/>');
      exts.push('<Default Extension="jpeg" ContentType="image/jpeg"/>');
      exts.push('<Default Extension="jpg" ContentType="image/jpeg"/>');
      exts.push('<Default Extension="gif" ContentType="image/gif"/>');
      exts.push('<Default Extension="bmp" ContentType="image/bmp"/>');
    }
    var over = [
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    ];
    if (hasFootnotes) over.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      exts.join('') + over.join('') + '</Types>';
  }

  function rootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
  }

  // y: YAML front matter 覆盖（subtitle → dc:subject，keywords → cp:keywords，date → 创建时间）
  function coreXml(title, author, y) {
    y = y || {};
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var created = /^\d{4}(-\d{2}(-\d{2})?)?/.test(y.date || '') ? y.date + (y.date.length === 4 ? '-01-01T00:00:00Z' :
      (y.date.length === 7 ? '-01T00:00:00Z' : 'T00:00:00Z')) : now;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title) + '</dc:title>' +
      (y.subtitle ? '<dc:subject>' + esc(y.subtitle) + '</dc:subject>' : '') +
      '<dc:creator>' + esc(author) + '</dc:creator>' +
      (y.keywords ? '<cp:keywords>' + esc(y.keywords) + '</cp:keywords>' : '') +
      '<cp:lastModifiedBy>' + esc(author) + '</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + created + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function appXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>OpenTypora</Application><DocSecurity>0</DocSecurity>' +
      '</Properties>';
  }

  /* ---------------------------------------------------------- 样式表 */
  function rPrXml(o) {
    o = o || {};
    var s = '';
    if (o.style) s += '<w:rStyle w:val="' + o.style + '"/>';
    if (o.font) s += '<w:rFonts w:ascii="' + o.font + '" w:hAnsi="' + o.font + '" w:eastAsia="' + (o.ea || 'PingFang SC') + '" w:cs="' + o.font + '"/>';
    if (o.bold) s += '<w:b/><w:bCs/>';
    if (o.italic) s += '<w:i/><w:iCs/>';
    if (o.strike) s += '<w:strike/>';
    if (o.color) s += '<w:color w:val="' + o.color + '"/>';
    if (o.sz) s += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>';
    if (o.highlight) s += '<w:highlight w:val="yellow"/>';
    if (o.shd) s += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>';
    if (o.u) s += '<w:u w:val="single"/>';
    if (o.valign) s += '<w:vertAlign w:val="' + o.valign + '"/>';
    return s ? '<w:rPr>' + s + '</w:rPr>' : '';
  }

  function styleXml(id, name, o) {
    o = o || {};
    return '<w:style w:type="paragraph" w:styleId="' + id + '">' +
      '<w:name w:val="' + name + '"/>' +
      (o.basedOn ? '<w:basedOn w:val="' + o.basedOn + '"/>' : '') +
      (o.next ? '<w:next w:val="' + o.next + '"/>' : '') +
      (o.qFormat ? '<w:qFormat/>' : '') +
      '<w:pPr>' +
      (o.keepNext ? '<w:keepNext/>' : '') +
      (o.outline !== undefined ? '<w:outlineLvl w:val="' + o.outline + '"/>' : '') +
      (o.spacing ? '<w:spacing ' + o.spacing + '/>' : '') +
      (o.ind ? '<w:ind ' + o.ind + '/>' : '') +
      (o.pBdr ? '<w:pBdr>' + o.pBdr + '</w:pBdr>' : '') +
      (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '') +
      '</w:pPr>' +
      rPrXml(o.rPr) +
      '</w:style>';
  }

  function charStyleXml(id, name, rp) {
    return '<w:style w:type="character" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
      '<w:rPr>' + rp + '</w:rPr></w:style>';
  }

  function stylesXml() {
    var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles ' + NS + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Helvetica Neue" w:hAnsi="Helvetica Neue" w:eastAsia="PingFang SC" w:cs="Helvetica Neue"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="330" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>';

    var body = '';
    body += styleXml('Normal', 'Normal', { qFormat: true });

    var hsz = [36, 28, 24, 22, 21, 20];
    for (var i = 1; i <= 6; i++) {
      body += styleXml('Heading' + i, 'heading ' + i, {
        basedOn: 'Normal', next: 'Normal', qFormat: true, keepNext: true, outline: i - 1,
        spacing: 'before="' + (i <= 2 ? 380 : 280) + '" after="140"',
        rPr: { bold: true, sz: hsz[i - 1], color: '1A1A1A' }
      });
    }
    body += styleXml('Title', 'Title', {
      basedOn: 'Normal', next: 'Normal', qFormat: true, outline: 0,
      spacing: 'before="0" after="240"', jc: 'center',
      rPr: { bold: true, sz: 44, color: '111111' }
    });
    body += styleXml('Quote', 'Quote', {
      basedOn: 'Normal', spacing: 'before="80" after="160"',
      ind: 'left="360" right="240"',
      pBdr: '<w:left w:val="single" w:sz="18" w:space="10" w:color="D8D8D8"/>',
      rPr: { italic: true, color: '555555' }
    });
    body += styleXml('CodeBlock', 'Code Block', {
      basedOn: 'Normal', qFormat: true, spacing: 'before="60" after="180" line="240" lineRule="auto"',
      pBdr: '<w:top w:val="single" w:sz="4" w:space="6" w:color="E4E4E4"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="6" w:color="E4E4E4"/>' +
        '<w:left w:val="single" w:sz="4" w:space="6" w:color="E4E4E4"/>' +
        '<w:right w:val="single" w:sz="4" w:space="6" w:color="E4E4E4"/>',
      rPr: { font: 'Menlo', ea: 'PingFang SC', sz: 19, color: '24292E', shd: 'F6F8FA' }
    });
    body += styleXml('ListParagraph', 'List Paragraph', {
      basedOn: 'Normal', spacing: 'before="0" after="60" line="300" lineRule="auto"'
    });
    body += styleXml('FootnoteText', 'footnote text', {
      basedOn: 'Normal', spacing: 'before="0" after="40" line="240" lineRule="auto"',
      rPr: { sz: 18 }
    });
    body += charStyleXml('CodeChar', 'Code Char', '<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:shd w:val="clear" w:color="auto" w:fill="F2F3F5"/><w:sz w:val="19"/><w:szCs w:val="19"/>');
    body += charStyleXml('FootnoteReference', 'footnote reference', '<w:vertAlign w:val="superscript"/>');
    body += '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0969DA"/><w:u w:val="single"/></w:rPr></w:style>';
    body += '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
      '<w:tblPr><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>' +
      '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '</w:style>';

    return head + body + '</w:styles>';
  }

  function numberingXml(numIds) {
    function bulletLvl(lvl, ch, font) {
      var ind = 720 * (lvl + 1);
      return '<w:lvl w:ilvl="' + lvl + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
        '<w:lvlText w:val="' + ch + '"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="' + ind + '" w:hanging="360"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:hint="default"/></w:rPr></w:lvl>';
    }
    function numLvl(lvl, fmt) {
      var ind = 720 * (lvl + 1);
      return '<w:lvl w:ilvl="' + lvl + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/>' +
        '<w:lvlText w:val="%' + (lvl + 1) + '."/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="' + ind + '" w:hanging="360"/></w:pPr></w:lvl>';
    }
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ' + NS + '>';
    x += '<w:abstractNum w:abstractNumId="100"><w:multiLevelType w:val="hybridMultilevel"/>' +
      bulletLvl(0, '\u2022', 'Arial') + bulletLvl(1, '\u25E6', 'Arial') + bulletLvl(2, '\u25AA', 'Arial') +
      '</w:abstractNum>';
    x += '<w:abstractNum w:abstractNumId="101"><w:multiLevelType w:val="hybridMultilevel"/>' +
      numLvl(0, 'decimal') + numLvl(1, 'lowerLetter') + numLvl(2, 'lowerRoman') +
      '</w:abstractNum>';
    x += '<w:num w:numId="1"><w:abstractNumId w:val="100"/></w:num>';
    for (var i = 0; i < numIds; i++) {
      x += '<w:num w:numId="' + (2 + i) + '"><w:abstractNumId w:val="101"/>' +
        '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
    }
    return x + '</w:numbering>';
  }

  /* ---------------------------------------------------------- 上下文 */
  function Ctx(opts) {
    this.opts = opts || {};
    this.rels = [];
    this.rid = 4;                 // rId1-3 给了 core/app，document.xml.rels 里从 4 开始
    this.media = [];              // {name, bytes, mime}
    this.images = {};             // src -> {relId, cx, cy, name, missing}
    this.imgSize = {};            // src -> {w, h}：Markdown 里 =300x200 指定的像素尺寸
    this.fnIds = {};              // fnId -> number
    this.fnOrder = [];
    this.fnBody = {};             // fnId -> 源码正文
    this.imgSeq = 0;
    this.numSeq = 0;
    this.docPrId = 1;
  }

  Ctx.prototype.addRel = function (type, target, ext) {
    var id = 'rId' + (this.rid++);
    this.rels.push('<Relationship Id="' + id + '" Type="' + type + '" Target="' + esc(target) + '"' +
      (ext ? ' TargetMode="External"' : '') + '/>');
    return id;
  };

  /* ---------------------------------------------------------- 行内 → w:r */
  function runXml(text, rp, opts) {
    opts = opts || {};
    if (text === '\n') return '<w:r>' + rp + '<w:br/></w:r>';
    var inner = '';
    var parts = String(text).split('\t');
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) inner += '<w:tab/>';
      if (parts[i]) inner += '<w:t xml:space="preserve">' + esc(parts[i]) + '</w:t>';
    }
    if (!inner) inner = '<w:t xml:space="preserve"></w:t>';
    return '<w:r>' + rp + inner + '</w:r>';
  }

  function drawingXml(ctx, img) {
    var id = ctx.docPrId++;
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + img.cx + '" cy="' + img.cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="' + id + '" name="Picture ' + id + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(img.name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + img.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + img.cx + '" cy="' + img.cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  function rp(st) { return rPrXml(stToRPr(st || {})); }

  // 返回 {xml, single:true} 或直接串；这里统一返回串，超链接在 emitRuns 里合并
  function emitRuns(tokens, ctx, st) {
    st = st || {};
    var pieces = [];   // {rid, xml}

    function add(xml, rid) { pieces.push({ rid: rid || null, xml: xml }); }

    (tokens || []).forEach(function (t) {
      switch (t.t) {
        case 'text':
          add(runXml(t.v, rp(st)));
          break;
        case 'code':
          add(runXml(t.v, rPrXml({ style: 'CodeChar' })));
          break;
        case 'math':
          add(runXml('$' + t.v + '$', rPrXml({ font: 'Cambria Math', ea: 'Songti SC', italic: true })));
          break;
        case 'br':
          add('<w:r>' + rp(st) + '<w:br/></w:r>');
          break;
        case 'fn': {
          var n = ctx.fnIds[t.id];
          if (!n) break;
          add('<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="' + n + '"/></w:r>');
          break;
        }
        case 'img': {
          var it = ctx.images[t.src];
          if (it && it.relId) add(drawingXml(ctx, it));
          else add(runXml('[图片：' + (t.alt || t.src) + ']', rPrXml({ italic: true, color: '999999' })));
          break;
        }
        case 'link': {
          var rid = ctx.addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', t.href, true);
          var sub = emitRuns(t.kids, ctx, mergeSt(st, { link: true }));
          // 子串里可能又嵌了超链接，直接摊平（Word 不允许嵌套 hyperlink）
          sub = sub.replace(/<\/?w:hyperlink[^>]*>/g, '');
          pieces.push({ rid: rid, xml: sub });
          break;
        }
        case 'wiki': {
          // Word 里没有 wiki 链接，目标文件不在文档包内：只留显示文字
          add(emitRuns(t.kids || [{ t: 'text', v: t.label || t.target }], ctx, st));
          break;
        }
        case 'sup': add(emitRuns(t.kids, ctx, mergeSt(st, { valign: 'superscript' }))); break;
        case 'sub': add(emitRuns(t.kids, ctx, mergeSt(st, { valign: 'subscript' }))); break;
        case 'u': add(emitRuns(t.kids, ctx, mergeSt(st, { u: true }))); break;
        case 'strong': add(emitRuns(t.kids, ctx, mergeSt(st, { bold: true }))); break;
        case 'em': add(emitRuns(t.kids, ctx, mergeSt(st, { italic: true }))); break;
        case 'del': add(emitRuns(t.kids, ctx, mergeSt(st, { strike: true }))); break;
        case 'mark': add(emitRuns(t.kids, ctx, mergeSt(st, { highlight: true }))); break;
        default: break;
      }
    });

    // 相邻同 hyperlink 的 run 合并成 w:hyperlink
    var out = '', cur = null, buf = '';
    for (var i = 0; i <= pieces.length; i++) {
      var p = pieces[i];
      var rid = p ? p.rid : undefined;
      if (p && rid === cur) { buf += p.xml; continue; }
      if (buf) out += cur ? '<w:hyperlink r:id="' + cur + '">' + buf + '</w:hyperlink>' : buf;
      if (!p) break;
      cur = rid; buf = p.xml;
    }
    return out;
  }

  function mergeSt(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b) o[k] = b[k];
    return o;
  }

  function stToRPr(st) {
    var o = {};
    if (st.bold) o.bold = true;
    if (st.italic) o.italic = true;
    if (st.strike) o.strike = true;
    if (st.highlight) o.highlight = true;
    if (st.u) o.u = true;
    if (st.valign) o.valign = st.valign;
    if (st.link) { o.style = 'Hyperlink'; }
    if (st.code) { o.style = 'CodeChar'; }
    return o;
  }

  /* ---------------------------------------------------------- 块 → 段落 */
  function para(inner, pPr) {
    return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + inner + '</w:p>';
  }

  function splitCells(line) {
    var s = line.trim();
    s = s.replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.trim(); });
  }

  function parseTable(raw) {
    var lines = raw.split('\n').map(function (l) { return l; });
    var head = splitCells(lines[0]);
    var align = splitCells(lines[1] || '').map(function (c) {
      var left = /^:/.test(c), right = /:$/.test(c);
      return left && right ? 'center' : right ? 'right' : left ? 'left' : 'left';
    });
    var rows = [];
    for (var i = 2; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      rows.push(splitCells(lines[i]));
    }
    return { head: head, align: align, rows: rows };
  }

  function tableXml(tbl, ctx) {
    var cols = Math.max(tbl.head.length, tbl.align.length, 1);
    var totalTw = 9026;
    var colW = Math.floor(totalTw / cols);

    function cell(text, opts) {
      opts = opts || {};
      var pPr = '' +
        '<w:spacing w:before="40" w:after="40" w:line="260" w:lineRule="auto"/>' +
        (opts.align && opts.align !== 'left' ? '<w:jc w:val="' + opts.align + '"/>' : '');
      var toks = inline().tokenize(text);
      var runs = emitRuns(toks, ctx, opts.head ? { bold: true } : {});
      return '<w:tc><w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/>' +
        (opts.head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F3F5"/>' : '') +
        '<w:vAlign w:val="center"/></w:tcPr>' + para(runs, pPr) + '</w:tc>';
    }

    var x = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
      '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
      '</w:tblPr><w:tblGrid>';
    for (var g = 0; g < cols; g++) x += '<w:gridCol w:w="' + colW + '"/>';
    x += '</w:tblGrid>';

    x += '<w:tr><w:trPr><w:tblHeader/></w:trPr>';
    for (var h = 0; h < cols; h++) x += cell(tbl.head[h] || '', { head: true, align: 'left' });
    x += '</w:tr>';

    tbl.rows.forEach(function (r) {
      x += '<w:tr>';
      for (var c = 0; c < cols; c++) x += cell(r[c] || '', { align: tbl.align[c] });
      x += '</w:tr>';
    });
    return x + '</w:tbl>';
  }

  function listXml(items, ctx, level, ordered) {
    var out = '', numId;
    if (ordered) { ctx.numSeq += 1; numId = 1 + ctx.numSeq; }
    else numId = 1;

    items.forEach(function (it) {
      var toks = inline().tokenize(it.text);
      var prefix = '';
      if (it.task === true) prefix = '\u2611 ';
      else if (it.task === false) prefix = '\u2610 ';
      var runs = emitRuns(toks, ctx, {});
      if (prefix) runs = runXml(prefix, '') + runs;
      var pPr = '<w:pStyle w:val="ListParagraph"/>' +
        '<w:numPr><w:ilvl w:val="' + Math.min(level, 2) + '"/><w:numId w:val="' + numId + '"/></w:numPr>' +
        '<w:spacing w:before="0" w:after="60" w:line="300" w:lineRule="auto"/>' +
        '<w:ind w:left="' + (720 * (level + 1)) + '" w:hanging="360"/>';
      out += para(runs, pPr);
      if (it.children && it.children.length) {
        out += listXml(it.children, ctx, level + 1, it.children[0].ordered);
      }
    });
    return out;
  }

  function codeXml(code, lang) {
    var lines = String(code).replace(/\t/g, '    ').split('\n');
    var inner = '';
    lines.forEach(function (ln, i) {
      if (i > 0) inner += '<w:r><w:br/></w:r>';
      inner += '<w:r><w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r>';
    });
    return para(inner, '<w:pStyle w:val="CodeBlock"/>');
  }

  function tocXml() {
    return para(
      '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="19"/></w:rPr>' +
      '<w:t xml:space="preserve">（目录域：在 Word 中右键 → 更新域 即可生成页码）</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
      '<w:spacing w:before="0" w:after="240"/>'
    );
  }

  /* ---------------------------------------------------------- 预扫描 */
  function prescan(blocks, ctx) {
    // 脚注定义
    blocks.forEach(function (b) {
      if (b.type === 'footdef') ctx.fnBody[b.fnId] = b.fnBody != null ? b.fnBody : '';
    });

    // 脚注引用：按正文出现顺序编号（脚注定义块本身不算引用）
    function scanTokens(toks) {
      (toks || []).forEach(function (t) {
        if (t.t === 'fn') {
          if (!ctx.fnIds[t.id]) {
            ctx.fnIds[t.id] = ctx.fnOrder.length + 1;
            ctx.fnOrder.push(t.id);
          }
        } else if (t.kids) scanTokens(t.kids);
      });
    }
    function scanText(s) { scanTokens(inline().tokenize(s)); }

    blocks.forEach(function (b) {
      switch (b.type) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': case 'para': case 'quote':
          scanText(b.inline != null ? b.inline : (b.type === 'quote' ? b.inner : b.raw));
          break;
        case 'list':
          (function walk(items) {
            items.forEach(function (it) { scanText(it.text); if (it.children) walk(it.children); });
          })(b.items || []);
          break;
        case 'table':
          var t = parseTable(b.raw);
          t.head.forEach(scanText);
          t.rows.forEach(function (r) { r.forEach(scanText); });
          break;
        case 'footdef':
          scanText(b.fnBody || '');
          break;
        default: break;
      }
    });
  }

  function collectImages(blocks, ctx) {
    var srcs = [], seen = {};
    function scanTokens(toks) {
      (toks || []).forEach(function (t) {
        if (t.t === 'img' && !seen[t.src]) {
          seen[t.src] = 1;
          srcs.push(t.src);
          if (t.w || t.h) ctx.imgSize[t.src] = { w: t.w || 0, h: t.h || 0 };
        }
        else if (t.kids) scanTokens(t.kids);
      });
    }
    function scanText(s) { scanTokens(inline().tokenize(s)); }
    blocks.forEach(function (b) {
      if (b.type === 'list') (function walk(items) {
        items.forEach(function (it) { scanText(it.text); if (it.children) walk(it.children); });
      })(b.items || []);
      else if (b.type === 'table') {
        var t = parseTable(b.raw);
        t.head.forEach(scanText);
        t.rows.forEach(function (r) { r.forEach(scanText); });
      } else scanText(b.inline != null ? b.inline : (b.type === 'quote' ? b.inner : b.raw));
    });
    return srcs;
  }

  function registerImage(ctx, src, data) {
    var bytes = data.bytes, mime = data.mime || mimeOf(src, bytes);
    var ext = mime === 'image/jpeg' ? 'jpeg' : mime.split('/')[1] || 'png';
    var name = 'image' + (++ctx.imgSeq) + '.' + ext;
    var relId = ctx.addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + name);
    ctx.media.push({ name: name, bytes: bytes, mime: mime });

    var size = sniffSize(bytes) || { w: 480, h: 300 };
    var pxW = size.w, pxH = size.h;
    var want = ctx.imgSize[src] || null;
    if (want && (want.w || want.h)) {
      // 用户写了 =300x200：按指定像素算，缺的一边按原图比例补齐
      if (want.w && want.h) { pxW = want.w; pxH = want.h; }
      else if (want.w) { pxW = want.w; pxH = Math.max(1, Math.round(size.h * want.w / Math.max(1, size.w))); }
      else { pxH = want.h; pxW = Math.max(1, Math.round(size.w * want.h / Math.max(1, size.h))); }
    }
    var cx = pxW * 9525, cy = pxH * 9525;       // 96dpi → EMU
    if (cx > MAX_W_EMU) { cy = Math.round(cy * MAX_W_EMU / cx); cx = MAX_W_EMU; }
    ctx.images[src] = { relId: relId, cx: cx, cy: cy, name: name };
  }

  /* ---------------------------------------------------------- 正文 */
  function bodyXml(blocks, ctx) {
    var out = '';

    blocks.forEach(function (b) {
      switch (b.type) {
        case 'frontmatter':
          break;

        case 'toc':
          out += tocXml();
          break;

        case 'hr':
          out += para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr>' +
            '<w:spacing w:before="120" w:after="180"/>');
          break;

        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          out += para(emitRuns(inline().tokenize(b.inline || ''), ctx, {}),
            '<w:pStyle w:val="Heading' + b.type.slice(1) + '"/>');
          break;

        case 'para':
          out += para(emitRuns(inline().tokenize(b.raw), ctx, {}));
          break;

        case 'linkdef':
          break;

        case 'quote': {
          if (b.callout) {
            var cmeta = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
            out += para(runXml((b.calloutTitle || cmeta[b.callout] || b.callout),
              rPrXml({ bold: true, color: '444444' })), '<w:pStyle w:val="Quote"/><w:spacing w:before="120" w:after="40"/>');
          }
          var parts = String(b.inner || '').split(/\n{2,}/);
          parts.forEach(function (p) {
            out += para(emitRuns(inline().tokenize(p.replace(/\n/g, ' ')), ctx, { italic: true }),
              '<w:pStyle w:val="Quote"/>');
          });
          break;
        }

        case 'code':
          out += codeXml(b.code || '', b.lang);
          break;

        case 'math':
          out += para(runXml((b.tex || '').replace(/\n/g, ' '),
            rPrXml({ font: 'Cambria Math', ea: 'Songti SC', italic: true, sz: 22 })),
            '<w:jc w:val="center"/><w:spacing w:before="120" w:after="160"/>');
          break;

        case 'table':
          out += tableXml(parseTable(b.raw), ctx);
          out += para('', '<w:spacing w:before="0" w:after="60"/>');
          break;

        case 'list':
          out += listXml(b.items || [], ctx, 0, b.items && b.items[0] && b.items[0].ordered);
          break;

        case 'html': {
          // docx 里没有 HTML 节点这回事，只留文字（<br>/</p> 先转成换行）
          var txt = md().htmlText(b.raw);
          if (txt) {
            txt.split('\n').forEach(function (line) {
              out += para(emitRuns(inline().tokenize(line), ctx, {}));
            });
          }
          break;
        }

        case 'footdef':
          break;   // 正文位置不出现，收进 footnotes.xml

        default:
          if (b.raw) out += para(emitRuns(inline().tokenize(b.raw), ctx, {}));
          break;
      }
    });

    return out;
  }

  function footnotesXml(ctx) {
    var sep = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ' + NS + '>' +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

    var body = ctx.fnOrder.map(function (fnId) {
      var n = ctx.fnIds[fnId];
      var src = ctx.fnBody[fnId] != null ? String(ctx.fnBody[fnId]) : '（缺失的脚注定义：' + fnId + '）';
      var toks = inline().tokenize(src.replace(/\n+/g, ' '));
      var runs = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' +
        runXml(' ', rPrXml({})) + emitRuns(toks, ctx, {});
      return '<w:footnote w:id="' + n + '">' + para(runs, '<w:pStyle w:val="FootnoteText"/>') + '</w:footnote>';
    }).join('');

    return sep + body + '</w:footnotes>';
  }

  function sectionPr() {
    return '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:docGrid w:linePitch="312"/></w:sectPr>';
  }

  function documentXml(blocks, ctx) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document ' + NS + '><w:body>' + bodyXml(blocks, ctx) + sectionPr() + '</w:body></w:document>';
  }

  function documentRels(ctx, hasFn) {
    var base = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      (hasFn ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' : '');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      base + ctx.rels.join('') + '</Relationships>';
  }

  /* ---------------------------------------------------------- 入口 */
  // opts: {title, author, resolveImage(src) -> Promise<{bytes,mime}|null>}
  function build(src, opts) {
    opts = opts || {};
    var MDmod = md(), InlineMod = inline(), ZipMod = zip(), YamlMod = dep('yaml', 'Yaml');
    InlineMod.setDefs(InlineMod.scanDefs(src));       // 引用式链接定义
    var model = MDmod.parse(src);
    var blocks = model.blocks;

    // YAML front matter 覆盖导出设置（title/author/subtitle/keywords/date/toc）
    var y = YamlMod.overrides(src);
    var title = y.title || opts.title || '未命名文档';
    var author = y.author || opts.author || '';

    var ctx = new Ctx(opts);
    prescan(blocks, ctx);

    var srcs = collectImages(blocks, ctx);
    var jobs = srcs.map(function (s) {
      if (typeof opts.resolveImage !== 'function') return Promise.resolve(null);
      return Promise.resolve(opts.resolveImage(s)).then(function (r) {
        if (r && r.bytes && r.bytes.length) { registerImage(ctx, s, r); return true; }
        return false;
      }).catch(function () { return false; });
    });

    return Promise.all(jobs).then(function () {
      var missing = srcs.filter(function (s) { return !ctx.images[s]; });

      // `toc: true` 且正文没有 [TOC] 块：开头补一个目录域（Word 里更新域即可生成）
      var bodyBlocks = blocks;
      if (y.toc && !blocks.some(function (b) { return b.type === 'toc'; })) {
        bodyBlocks = [{ type: 'toc' }].concat(blocks);
      }

      var doc = documentXml(bodyBlocks, ctx);
      var hasFn = ctx.fnOrder.length > 0;
      var fnXml = hasFn ? footnotesXml(ctx) : '';   // 先出正文脚注，链接关系才会进 rels

      var files = [
        { name: '[Content_Types].xml', data: contentTypes(ctx.media.length > 0, hasFn) },
        { name: '_rels/.rels', data: rootRels() },
        { name: 'docProps/core.xml', data: coreXml(title, author, y) },
        { name: 'docProps/app.xml', data: appXml() },
        { name: 'word/document.xml', data: doc },
        { name: 'word/styles.xml', data: stylesXml() },
        { name: 'word/numbering.xml', data: numberingXml(ctx.numSeq) },
        { name: 'word/_rels/document.xml.rels', data: documentRels(ctx, hasFn) }
      ];
      if (hasFn) files.push({ name: 'word/footnotes.xml', data: fnXml });
      ctx.media.forEach(function (m) {
        files.push({ name: 'word/media/' + m.name, data: m.bytes });
      });

      return {
        bytes: ZipMod.build(files),
        title: title,
        media: ctx.media.length,
        footnotes: ctx.fnOrder.length,
        missingImages: missing,
        warnings: missing.length ? ['以下图片未能读取，已用占位文本代替：' + missing.join('、')] : []
      };
    });
  }

  return {
    build: build,
    sniffSize: sniffSize,
    mimeOf: mimeOf
  };
});
