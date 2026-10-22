/* ============================================================
 * textfmt.js — 纯文本系导出：RTF / reStructuredText / MediaWiki / OPML
 *
 * 这四个都是「块模型 → 文本」，不需要 zip、不需要图片二进制
 * （RTF 里图片只留占位，RST/MediaWiki 用路径引用，OPML 只做大纲）。
 * 因此全部是同步纯函数，Node 里可以直接单测。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextFmt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }

  function model(src) {
    var Inline = dep('inline', 'Inline');
    try { Inline.setDefs(Inline.scanDefs(src)); } catch (e) {}
    return dep('md', 'MD').parse(src);
  }

  function tokens(b) {
    return dep('inline', 'Inline').tokenize(b.inline != null ? b.inline : (b.raw || ''));
  }

  function plainOf(b) {
    var p = dep('inline', 'Inline').plain;
    return p(tokens(b));
  }

  function frontMeta(blocks) {
    var meta = {};
    if (blocks.length && blocks[0].type === 'frontmatter') {
      String(blocks[0].raw || '').split('\n').forEach(function (l) {
        var m = /^([\w-]+)\s*:\s*(.+?)\s*$/.exec(l);
        if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '');
      });
    }
    return meta;
  }

  function tableParts(raw) {
    var lines = String(raw).split('\n');
    function cells(l) {
      // 行内转义的 \| 不是列分隔符（否则 "a\|b" 会被拆成两列）
      var s = l.trim().replace(/^\|/, '').replace(/\|$/, '');
      var out = [], buf = '';
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === '\\' && s.charAt(i + 1) === '|') { buf += '\\|'; i++; continue; }
        if (c === '|') { out.push(buf); buf = ''; continue; }
        buf += c;
      }
      out.push(buf);
      return out.map(function (c) { return c.trim(); });
    }
    var head = cells(lines[0] || '');
    var rows = [];
    for (var i = 2; i < lines.length; i++) {
      if (lines[i].trim()) rows.push(cells(lines[i]));
    }
    return { head: head, rows: rows, cols: head.length };
  }

  /* ============================================================
   * 一、RTF
   * ============================================================ */
  function rtfEsc(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 92) out += '\\\\';
      else if (c === 123) out += '\\{';
      else if (c === 125) out += '\\}';
      else if (c === 10) out += '\\line ';
      else if (c === 13) continue;
      else if (c < 128) out += String.fromCharCode(c);
      else {
        // 非 BMP 拆成两个代理项，各自按 16 位有符号数写，Word 能正确拼回
        out += '\\u' + (c > 32767 ? c - 65536 : c) + '?';
      }
    }
    return out;
  }

  function rtfInline(ts) {
    return (ts || []).map(function (t) {
      switch (t.t) {
        case 'text': return rtfEsc(t.v);
        case 'code': return '{\\f1 ' + rtfEsc(t.v) + '}';
        case 'strong': return '{\\b ' + rtfInline(t.kids) + '}';
        case 'em': return '{\\i ' + rtfInline(t.kids) + '}';
        case 'del': return '{\\strike ' + rtfInline(t.kids) + '}';
        case 'mark': return '{\\highlight2 ' + rtfInline(t.kids) + '}';
        case 'sup': return '{\\super ' + rtfInline(t.kids) + '}';
        case 'sub': return '{\\sub ' + rtfInline(t.kids) + '}';
        case 'u': return '{\\ul ' + rtfInline(t.kids) + '}';
        case 'br': return '\\line ';
        case 'wiki': return rtfEsc(t.label || t.target || '');
        case 'math': return '{\\i ' + rtfEsc(t.v) + '}';
        case 'img': return '[' + rtfEsc('\u56fe\u7247\uff1a' + (t.alt || t.src)) + ']';
        case 'link':
          return '{\\field{\\*\\fldinst{HYPERLINK "' + String(t.href || '').replace(/"/g, '') + '"}}' +
            '{\\fldrslt{\\ul\\cf2 ' + rtfInline(t.kids) + '}}}';
        case 'fn': return '{\\super [' + (t.id || '') + ']}';
        default: return '';
      }
    }).join('');
  }

  function rtfTable(b) {
    var t = tableParts(b.raw);
    var cols = t.cols || 1;
    var total = 9360;               // A4 正文宽 ≈ 6.5in
    var cw = Math.floor(total / cols);
    function row(cells, header) {
      var s = '\\trowd\\trgaph108\\trleft0';
      for (var i = 0; i < cols; i++) {
        s += '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10' +
          '\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
        if (header) s += '\\clcbpat14';
        s += '\\cellx' + (cw * (i + 1));
      }
      for (var j = 0; j < cols; j++) {
        s += '\\pard\\intbl\\f0\\fs20' + (header ? '\\b ' : ' ') +
          rtfInline(dep('inline', 'Inline').tokenize(cells[j] || '')) +
          (header ? '\\b0' : '') + '\\cell';
      }
      return s + '\\row\n';
    }
    var out = row(t.head, true);
    t.rows.forEach(function (r) { out += row(r, false); });
    return '\\pard\\par\n' + out;
  }

  function rtfLists(items, ordered, depth) {
    var out = '';
    (items || []).forEach(function (it, i) {
      var mark = ordered ? (i + 1) + '.' : '\u2022';
      var ind = 360 + depth * 360;
      out += '\\pard\\li' + ind + '\\fi-360\\sa40 ' + rtfEsc(mark) + '\\tab ' +
        rtfInline(dep('inline', 'Inline').tokenize(it.text || '')) + '\\par\n';
      if (it.children && it.children.length) {
        out += rtfLists(it.children, !!(it.children[0] && it.children[0].ordered), depth + 1);
      }
    });
    return out;
  }

  function rtf(src, opts) {
    opts = opts || {};
    var m = model(src);
    var meta = frontMeta(m.blocks);
    var body = '';
    var HFS = [40, 32, 28, 24, 22, 20];

    m.blocks.forEach(function (b) {
      var t = b.type;
      if (t === 'frontmatter' || t === 'linkdef' || t === 'footdef') return;
      if (/^h[1-6]$/.test(t)) {
        var lv = parseInt(t.slice(1), 10);
        body += '\\pard\\sb240\\sa120\\b\\fs' + HFS[lv - 1] + ' ' + rtfInline(tokens(b)) +
          '\\b0\\fs22\\par\n';
        return;
      }
      if (t === 'hr') { body += '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n'; return; }
      if (t === 'code') {
        String(b.code || '').split('\n').forEach(function (line) {
          body += '\\pard\\f1\\fs18\\li360\\sa0\\sb0 ' + rtfEsc(line) + '\\par\n';
        });
        body += '\\pard\\fs22\\par\n';
        return;
      }
      if (t === 'math') {
        body += '\\pard\\qc\\i ' + rtfEsc(b.tex || '') + '\\i0\\par\n';
        return;
      }
      if (t === 'table') { body += rtfTable(b); return; }
      if (t === 'list') {
        body += rtfLists(b.items || [], !!(b.items && b.items[0] && b.items[0].ordered), 0);
        body += '\\pard\\par\n';
        return;
      }
      if (t === 'quote') {
        var inner = dep('md', 'MD').parse(b.inner || '').blocks;
        inner.forEach(function (q) {
          body += '\\pard\\li720\\ri360\\cbpat14 ' + rtfInline(tokens(q)) + '\\par\n';
        });
        body += '\\pard\\par\n';
        return;
      }
      if (t === 'html') {
        var txt = dep('md', 'MD').htmlText(b.raw);
        if (txt) body += '\\pard ' + rtfEsc(txt) + '\\par\n';
        return;
      }
      if (t === 'toc') { body += '\\pard\\i [TOC]\\i0\\par\n'; return; }
      var line = rtfInline(tokens(b));
      if (line) body += '\\pard ' + line + '\\par\n';
    });

    var head = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat' +
      '{\\fonttbl{\\f0\\fnil\\fcharset134 PingFang SC;}{\\f1\\fmodern\\fcharset0 Menlo;}}' +
      '{\\colortbl ;\\red242\\green242\\blue242;\\red26\\green111\\blue196;}' +
      '\\viewkind4\\uc1\\f0\\fs22\n';
    return {
      text: head + body + '}\n',
      title: opts.title || meta.title || '未命名文档',
      warnings: []
    };
  }

  /* ============================================================
   * 二、reStructuredText
   * ============================================================ */
  var RST_MARKS = ['=', '-', '~', '^', '"', "'"];

  function rstInline(ts) {
    return (ts || []).map(function (t) {
      switch (t.t) {
        case 'text': return t.v.replace(/\*/g, '\\*').replace(/`/g, '\\`').replace(/_/g, '\\_');
        case 'code': return '``' + t.v + '``';
        case 'strong': return '**' + rstInline(t.kids) + '**';
        case 'em': return '*' + rstInline(t.kids) + '*';
        case 'del': return '[strike]' + rstInline(t.kids) + '[/strike]';
        case 'mark': return '[mark]' + rstInline(t.kids) + '[/mark]';
        case 'sup': return ':sup:`' + rstInline(t.kids).replace(/`/g, '') + '`';
        case 'sub': return ':sub:`' + rstInline(t.kids).replace(/`/g, '') + '`';
        case 'u': return ':u:`' + rstInline(t.kids).replace(/`/g, '') + '`';
        case 'br': return '\n';
        case 'wiki': return rstInline(dep('inline', 'Inline').tokenize(t.label || t.target || ''));
        case 'math': return ':math:`' + t.v + '`';
        case 'img': return '_' + (t.alt || 'image');
        case 'fn': return '[#' + String(t.id || '').replace(/[^\w]/g, '') + ']_';
        case 'link': {
          var text = rstInline(t.kids);
          var href = t.href || '';
          if (text === href) return href;
          return '`' + text + ' <' + href + '>`_';
        }
        default: return '';
      }
    }).join('');
  }

  function rstTable(b) {
    var t = tableParts(b.raw);
    var cols = t.cols || 1;
    var w = [];
    for (var i = 0; i < cols; i++) {
      var max = 3;
      [t.head].concat(t.rows).forEach(function (r) {
        var len = String(r[i] || '').length;
        if (len > max) max = len;
      });
      w.push(Math.min(max, 40));
    }
    var sep = '+' + w.map(function (n) { return new Array(n + 3).join('-'); }).join('+') + '+';
    var hsep = '+' + w.map(function (n) { return new Array(n + 3).join('='); }).join('+') + '+';
    function line(cells) {
      return '|' + w.map(function (n, k) {
        var s = String(cells[k] || '');
        while (s.length < n) s += ' ';
        return ' ' + s + ' ';
      }).join('|') + '|';
    }
    var out = sep + '\n' + line(t.head) + '\n' + hsep + '\n';
    t.rows.forEach(function (r) { out += line(r) + '\n' + sep + '\n'; });
    return out;
  }

  function rstLists(items, ordered, depth) {
    var out = '';
    var pad = new Array(depth * 3 + 1).join(' ');
    (items || []).forEach(function (it, i) {
      var mark = it.task === true ? '[x] ' : it.task === false ? '[ ] ' : '';
      out += pad + (ordered ? (i + 1) + '. ' : '- ') + mark +
        rstInline(dep('inline', 'Inline').tokenize(it.text || '')) + '\n';
      if (it.children && it.children.length) {
        out += '\n' + rstLists(it.children, !!(it.children[0] && it.children[0].ordered), depth + 1);
      }
    });
    return out;
  }

  function rst(src, opts) {
    opts = opts || {};
    var m = model(src);
    var meta = frontMeta(m.blocks);
    var out = '';

    m.blocks.forEach(function (b) {
      var t = b.type;
      if (t === 'frontmatter' || t === 'linkdef') return;
      if (t === 'footdef') {
        out += '.. [#' + String(b.fnId || '').replace(/[^\w]/g, '') + '] ' +
          rstInline(dep('inline', 'Inline').tokenize(b.fnBody || '')) + '\n\n';
        return;
      }
      if (/^h[1-6]$/.test(t)) {
        var lv = parseInt(t.slice(1), 10);
        var text = dep('inline', 'Inline').plain(tokens(b)) || '';
        var mark = RST_MARKS[lv - 1];
        out += text + '\n' + new Array(Math.max(text.length, 3) + 1).join(mark) + '\n\n';
        return;
      }
      if (t === 'hr') { out += '----\n\n'; return; }
      if (t === 'code') {
        out += '.. code-block:: ' + (b.lang || 'text') + '\n\n';
        String(b.code || '').split('\n').forEach(function (l) {
          out += '   ' + l + '\n';
        });
        out += '\n';
        return;
      }
      if (t === 'math') {
        out += '.. math::\n\n';
        String(b.tex || '').split('\n').forEach(function (l) { out += '   ' + l + '\n'; });
        out += '\n';
        return;
      }
      if (t === 'table') { out += rstTable(b) + '\n'; return; }
      if (t === 'list') { out += rstLists(b.items || [], !!(b.items && b.items[0] && b.items[0].ordered), 0) + '\n'; return; }
      if (t === 'quote') {
        var inner = dep('md', 'MD').parse(b.inner || '').blocks;
        inner.forEach(function (q) {
          out += '   ' + rstInline(tokens(q)) + '\n';
        });
        out += '\n';
        return;
      }
      if (t === 'html') {
        var txt = dep('md', 'MD').htmlText(b.raw);
        if (txt) out += '.. raw:: html\n\n   ' + txt.replace(/\n/g, '\n   ') + '\n\n';
        return;
      }
      if (t === 'toc') { out += '.. contents::\n   :depth: 3\n\n'; return; }

      // 独立成段的图片 → 单独的 image 指令，别混在文字里
      var ts = tokens(b);
      var imgs = ts.filter(function (x) { return x.t === 'img'; });
      var rest = ts.filter(function (x) { return x.t !== 'img' && x.t !== 'br'; });
      imgs.forEach(function (im) {
        out += '.. image:: ' + im.src + '\n';
        if (im.alt) out += '   :alt: ' + im.alt + '\n';
        if (im.w) out += '   :width: ' + im.w + 'px\n';
        out += '\n';
      });
      var line = rstInline(rest).trim();
      if (line) out += line + '\n\n';
    });

    return {
      text: out.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'),
      title: opts.title || meta.title || '未命名文档',
      warnings: []
    };
  }

  /* ============================================================
   * 三、MediaWiki
   * ============================================================ */
  function mwInline(ts) {
    return (ts || []).map(function (t) {
      switch (t.t) {
        case 'text': return t.v;
        case 'code': return '<code>' + t.v.replace(/</g, '&lt;') + '</code>';
        case 'strong': return "'''" + mwInline(t.kids) + "'''";
        case 'em': return "''" + mwInline(t.kids) + "''";
        case 'del': return '<s>' + mwInline(t.kids) + '</s>';
        case 'mark': return '<mark>' + mwInline(t.kids) + '</mark>';
        case 'sup': return '<sup>' + mwInline(t.kids) + '</sup>';
        case 'sub': return '<sub>' + mwInline(t.kids) + '</sub>';
        case 'u': return '<u>' + mwInline(t.kids) + '</u>';
        case 'br': return '<br />';
        case 'wiki': return mwInline(dep('inline', 'Inline').tokenize(t.label || t.target || ''));
        case 'math': return '<math>' + t.v + '</math>';
        case 'img': return '[[File:' + String(t.src).split('/').pop() + '|thumb|' + (t.alt || '') + ']]';
        case 'fn': return '<ref>' + String(t.id || '') + '</ref>';
        case 'link': {
          var href = t.href || '';
          var text = mwInline(t.kids);
          if (/^https?:/i.test(href)) return '[' + href + ' ' + text + ']';
          return '[[' + href + '|' + text + ']]';
        }
        default: return '';
      }
    }).join('');
  }

  function mwTable(b) {
    var t = tableParts(b.raw);
    var out = '{| class="wikitable"\n|-\n';
    t.head.forEach(function (c) {
      out += '! ' + mwInline(dep('inline', 'Inline').tokenize(c)) + '\n';
    });
    t.rows.forEach(function (r) {
      out += '|-\n';
      r.forEach(function (c) {
        out += '| ' + mwInline(dep('inline', 'Inline').tokenize(c)) + '\n';
      });
    });
    return out + '|}\n';
  }

  function mwLists(items, ordered, depth) {
    var out = '';
    (items || []).forEach(function (it) {
      var mark = ordered ? '#' : '*';
      var pre = new Array(depth + 2).join(mark);
      var task = it.task === true ? '\u2611 ' : it.task === false ? '\u2610 ' : '';
      out += pre + ' ' + task + mwInline(dep('inline', 'Inline').tokenize(it.text || '')) + '\n';
      if (it.children && it.children.length) {
        out += mwLists(it.children, !!(it.children[0] && it.children[0].ordered), depth + 1);
      }
    });
    return out;
  }

  function mediawiki(src, opts) {
    opts = opts || {};
    var m = model(src);
    var meta = frontMeta(m.blocks);
    var out = '';

    m.blocks.forEach(function (b) {
      var t = b.type;
      if (t === 'frontmatter' || t === 'linkdef') return;
      if (t === 'footdef') {
        out += '<ref name="' + String(b.fnId || '') + '">' +
          mwInline(dep('inline', 'Inline').tokenize(b.fnBody || '')) + '</ref>\n\n';
        return;
      }
      if (/^h[1-6]$/.test(t)) {
        var lv = parseInt(t.slice(1), 10);
        var eq = new Array(lv + 1).join('=');
        out += eq + ' ' + mwInline(tokens(b)) + ' ' + eq + '\n\n';
        return;
      }
      if (t === 'hr') { out += '----\n\n'; return; }
      if (t === 'code') {
        out += '<syntaxhighlight lang="' + (b.lang || 'text') + '">\n' +
          String(b.code || '') + '\n</syntaxhighlight>\n\n';
        return;
      }
      if (t === 'math') { out += '<math>' + (b.tex || '') + '</math>\n\n'; return; }
      if (t === 'table') { out += mwTable(b) + '\n'; return; }
      if (t === 'list') { out += mwLists(b.items || [], !!(b.items && b.items[0] && b.items[0].ordered), 0) + '\n'; return; }
      if (t === 'quote') {
        var inner = dep('md', 'MD').parse(b.inner || '').blocks;
        inner.forEach(function (q) { out += ': ' + mwInline(tokens(q)) + '\n'; });
        out += '\n';
        return;
      }
      if (t === 'html') {
        var txt = dep('md', 'MD').htmlText(b.raw);
        if (txt) out += '<pre>' + txt.replace(/</g, '&lt;') + '</pre>\n\n';
        return;
      }
      if (t === 'toc') { out += '__TOC__\n\n'; return; }
      var line = mwInline(tokens(b)).trim();
      if (line) out += line + '\n\n';
    });

    return {
      text: out.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'),
      title: opts.title || meta.title || '未命名文档',
      warnings: []
    };
  }

  /* ============================================================
   * 四、OPML（大纲）
   * ============================================================ */
  function xesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  // OPML 的 _note 是给人看的摘要：列表/表格/代码要摊平成文字，不能塞原始标记
  function plainBlock(b) {
    var t = b.type;
    if (t === 'list') {
      return (b.items || []).map(function (it) {
        return '\u2022 ' + dep('inline', 'Inline').plain(dep('inline', 'Inline').tokenize(it.text || ''));
      }).join('\n');
    }
    if (t === 'table') {
      return String(b.raw || '').split('\n').filter(function (l, i) {
        return i !== 1 && l.trim();
      }).map(function (l) {
        return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
          .map(function (c) { return c.trim(); }).join(' \u00b7 ');
      }).join('\n');
    }
    if (t === 'code') return b.code || '';
    if (t === 'math') return b.tex || '';
    if (t === 'hr' || t === 'toc') return '';
    if (t === 'quote') {
      return dep('md', 'MD').parse(b.inner || '').blocks.map(plainBlock).filter(Boolean).join('\n');
    }
    return plainOf(b);
  }

  function opml(src, opts) {
    opts = opts || {};
    var m = model(src);
    var meta = frontMeta(m.blocks);
    var title = opts.title || meta.title || '未命名文档';

    // 标题栈：每个标题一个节点，低级别挂到最近的更高级别下面
    var root = { level: 0, text: title, note: '', children: [] };
    var stack = [root];

    m.blocks.forEach(function (b) {
      if (b.type === 'frontmatter' || b.type === 'linkdef' || b.type === 'footdef') return;
      if (/^h[1-6]$/.test(b.type)) {
        var lv = parseInt(b.type.slice(1), 10);
        var node = { level: lv, text: plainOf(b) || '(\u65e0\u6807\u9898)', note: '', children: [] };
        while (stack.length > 1 && stack[stack.length - 1].level >= lv) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        return;
      }
      var txt = plainBlock(b);
      if (!txt) return;
      stack[stack.length - 1].note += (stack[stack.length - 1].note ? '\n' : '') + txt;
    });

    function emit(node, ind) {
      var pad = new Array(ind + 1).join('  ');
      var attrs = 'text="' + xesc(node.text) + '"';
      if (node.note) attrs += ' _note="' + xesc(node.note) + '"';
      if (!node.children.length) return pad + '<outline ' + attrs + '/>\n';
      var s = pad + '<outline ' + attrs + '>\n';
      node.children.forEach(function (c) { s += emit(c, ind + 1); });
      return s + pad + '</outline>\n';
    }

    var body = '';
    root.children.forEach(function (c) { body += emit(c, 2); });
    if (!body) {
      // 没有标题：整篇作为一条
      body = '  <outline text="' + xesc(title) + '" _note="' + xesc(root.note) + '"/>\n';
    }

    return {
      text: '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<opml version="2.0">\n<head>\n<title>' + xesc(title) + '</title>\n' +
        '<dateCreated>' + new Date().toUTCString() + '</dateCreated>\n</head>\n' +
        '<body>\n' + body + '</body>\n</opml>\n',
      title: title,
      warnings: []
    };
  }

  /* ============================================================
   * 五、Textile（RedCloth / Textile 2）
   *
   * 与 RST 同构：块签名（h1. / bq. / bc..）＋行内成对标记。
   * 表格用 |_. 表头、行内文字里的竖线要转义成 &#124;，否则会被拆列。
   * ============================================================ */
  function txText(s) {
    // 竖线是表格分隔符；连续的 ---- 会被当成 <hr>（RedCloth 的规则），一并挡掉
    return String(s == null ? '' : s)
      .replace(/\|/g, '&#124;')
      .replace(/^([-*=#]{4,})$/gm, function (m) { return m.charAt(0) + ' ' + m.slice(1); });
  }

  function txInline(ts, ctx) {
    return (ts || []).map(function (t) {
      switch (t.t) {
        case 'text': return txText(t.v);
        case 'code': return '@' + String(t.v).replace(/@/g, '&#64;') + '@';
        case 'strong': return '*' + txInline(t.kids, ctx) + '*';
        case 'em': return '_' + txInline(t.kids, ctx) + '_';
        case 'del': return '-' + txInline(t.kids, ctx) + '-';
        case 'mark': return '%{background:yellow}' + txInline(t.kids, ctx) + '%';
        case 'sup': return '^' + txInline(t.kids, ctx) + '^';
        case 'sub': return '~' + txInline(t.kids, ctx) + '~';
        case 'u': return '+' + txInline(t.kids, ctx) + '+';
        case 'br': return '\n';
        case 'wiki': return txInline(dep('inline', 'Inline').tokenize(t.label || t.target || ''), ctx);
        case 'math': return '$' + t.v + '$';
        case 'img': {
          var alt = String(t.alt || '').replace(/[()]/g, ' ').trim();
          return '!' + t.src + (alt ? '(' + alt + ')' : '') + '!';
        }
        case 'fn': {
          var id = String(t.id == null ? '' : t.id);
          if (!ctx.fnNum[id]) { ctx.fnNum[id] = ctx.fnOrder.length + 1; ctx.fnOrder.push(id); }
          return '[' + ctx.fnNum[id] + ']';
        }
        case 'link': {
          var href = t.href || '';
          var text = txInline(t.kids, ctx);
          if (!href) return text;
          if (text === href) return '"' + txText(href) + '":' + href;
          return '"' + text + '":' + href;
        }
        default: return '';
      }
    }).join('');
  }

  function txTable(b) {
    var t = tableParts(b.raw);
    var sep = String(b.raw).split('\n')[1] || '';
    var aligns = sep.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) {
      c = c.trim();
      if (/^:.*:$/.test(c)) return '=';
      if (/:$/.test(c)) return '>';
      return '<';
    });
    function row(cells) {
      var s = '|';
      for (var i = 0; i < t.cols; i++) {
        var a = aligns[i] && aligns[i] !== '<' ? aligns[i] : '';
        s += (a ? a + '.' : '') + ' ' + txInline(dep('inline', 'Inline').tokenize(cells[i] || ''), { fnNum: {}, fnOrder: [] }) + ' |';
      }
      return s;
    }
    var head = '|';
    for (var i = 0; i < t.cols; i++) {
      head += '_' + (aligns[i] && aligns[i] !== '<' ? aligns[i] + '.' : '.') + ' ' +
        txInline(dep('inline', 'Inline').tokenize(t.head[i] || ''), { fnNum: {}, fnOrder: [] }) + ' |';
    }
    var out = head + '\n';
    t.rows.forEach(function (r) { out += row(r) + '\n'; });
    return out;
  }

  function txLists(items, ordered, depth, ctx) {
    var out = '';
    (items || []).forEach(function (it) {
      var mark = (ordered ? '#' : '*').repeat(depth + 1);
      var task = it.task === true ? '[x] ' : it.task === false ? '[ ] ' : '';
      out += mark + ' ' + task + txInline(dep('inline', 'Inline').tokenize(it.text || ''), ctx) + '\n';
      if (it.children && it.children.length) {
        out += txLists(it.children, !!(it.children[0] && it.children[0].ordered), depth + 1, ctx);
      }
    });
    return out;
  }

  function textile(src, opts) {
    opts = opts || {};
    var m = model(src);
    var meta = frontMeta(m.blocks);
    var ctx = { fnNum: {}, fnOrder: [] };

    // 标题预先编号，[TOC] 才有东西可指
    var heads = [];
    m.blocks.forEach(function (b) {
      if (!/^h[1-6]$/.test(b.type)) return;
      heads.push({
        level: parseInt(b.type.slice(1), 10),
        id: 'sec' + (heads.length + 1),
        text: plainOf(b) || ''
      });
    });

    var out = '';
    var headSeq = 0;

    m.blocks.forEach(function (b) {
      var t = b.type;
      if (t === 'frontmatter' || t === 'linkdef') return;

      if (t === 'footdef') {
        var num = ctx.fnNum[b.fnId];
        if (!num) { num = ctx.fnOrder.length + 1; ctx.fnNum[b.fnId] = num; ctx.fnOrder.push(b.fnId); }
        out += 'fn' + num + '. ' +
          txInline(dep('inline', 'Inline').tokenize(b.fnBody || ''), ctx) + '\n\n';
        return;
      }

      if (/^h[1-6]$/.test(t)) {
        var lv = parseInt(t.slice(1), 10);
        var h = heads[headSeq++] || { id: 'sec' + headSeq };
        out += 'h' + lv + '(#' + h.id + '). ' + txInline(tokens(b), ctx) + '\n\n';
        return;
      }

      if (t === 'hr') { out += '<hr />\n\n'; return; }

      if (t === 'code') {
        var lines = String(b.code || '').replace(/\n+$/, '').split('\n');
        if (lines.length === 1) {
          out += 'bc. ' + lines[0] + '\n\n';
        } else {
          // 扩展块：bc.. 一直延续到下一个块签名（p.）为止
          out += 'bc.. ' + lines[0] + '\n' + lines.slice(1).join('\n') + '\n\np.\n\n';
        }
        return;
      }

      if (t === 'math') {
        out += '<div class="math">\n' + String(b.tex || '') + '\n</div>\n\n';
        return;
      }

      if (t === 'table') { out += txTable(b) + '\n'; return; }

      if (t === 'list') {
        out += txLists(b.items || [], !!(b.items && b.items[0] && b.items[0].ordered), 0, ctx) + '\n';
        return;
      }

      if (t === 'quote') {
        var inner = dep('md', 'MD').parse(b.inner || '').blocks;
        var qs = [];
        inner.forEach(function (q) {
          qs.push(txInline(tokens(q), ctx));
        });
        var qtext = qs.filter(Boolean).join('\n');
        if (qtext) {
          var qlines = qtext.split('\n');
          if (qlines.length === 1) out += 'bq. ' + qlines[0] + '\n\n';
          else out += 'bq.. ' + qlines[0] + '\n' + qlines.slice(1).join('\n') + '\n\np.\n\n';
        }
        return;
      }

      if (t === 'html') {
        var raw = String(b.raw || '').trim();
        if (raw) out += '<notextile>\n' + raw + '\n</notextile>\n\n';
        return;
      }

      if (t === 'toc') {
        if (!heads.length) return;
        out += 'h2. 目录\n\n';
        var root = { level: 0, kids: [] }, stack = [root];
        heads.forEach(function (h) {
          var node = { level: h.level, text: h.text, id: h.id, kids: [] };
          while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
          stack[stack.length - 1].kids.push(node);
          stack.push(node);
        });
        (function walk(nodes, depth) {
          nodes.forEach(function (n) {
            out += '*'.repeat(depth + 1) + ' "' + txText(n.text) + '":#' + n.id + '\n';
            walk(n.kids, depth + 1);
          });
        })(root.kids, 0);
        out += '\n';
        return;
      }

      var line = txInline(tokens(b), ctx).trim();
      if (line) out += line + '\n\n';
    });

    return {
      text: out.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'),
      title: opts.title || meta.title || '未命名文档',
      warnings: []
    };
  }

  return {
    rtf: rtf, rst: rst, mediawiki: mediawiki, opml: opml, textile: textile,
    rtfEsc: rtfEsc, tableParts: tableParts
  };
});
