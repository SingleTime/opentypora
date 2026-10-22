/* ============================================================
 * infmt.js — 把 ODT / reStructuredText 还原成 Markdown
 *
 * ODT 是 zip：解 content.xml 之后按 text:h / text:p / text:list /
 * table:table 逐块还原，图片从 Pictures/ 里取出来交回给上层落盘。
 * RST 是纯文本：行扫描 —— 下划线标题、code-block、grid 表格、
 * 链接 `` `文字 <url>`_ ``、脚注 `` .. [#x] ``。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InFmt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dep(name, globalName) {
    if (typeof module !== 'undefined' && module.exports) return require('./' + name);
    return (typeof globalThis !== 'undefined' ? globalThis : window)[globalName];
  }

  function dec(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  function unent(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&amp;/g, '&');
  }

  /* ============================================================
   * 一、ODT
   * ============================================================ */
  var SPAN_MARK = {
    Tb: '**', Tbi: '***', Ti: '*', Tdel: '~~', Tmono: '`',
    Tsup: '^', Tsub: '~', Tmark: '==', Tlink: ''
  };

  // 脚注先整体替换掉，否则 note-body 里的 <text:p> 会被外层扫描器吞进去
  function odtNotes(xml, ctx) {
    return String(xml).replace(/<text:note\b[\s\S]*?<\/text:note>/g, function (whole) {
      var cit = (/<text:note-citation>([\s\S]*?)<\/text:note-citation>/.exec(whole) || [])[1] || '';
      var bodyXml = (/<text:note-body>([\s\S]*?)<\/text:note-body>/.exec(whole) || [])[1] || '';
      var id = String(cit).replace(/[^\w]/g, '').trim() || String(ctx.notes.length + 1);
      var text = unent(bodyXml.replace(/<\/text:p>/g, ' ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ').trim();
      ctx.notes.push({ id: id, text: text });
      return '[^' + id + ']';
    });
  }

  // 行内：span / 链接 / 图片 / 空白控制（脚注已在 odtNotes 里处理）
  function odtInline(xml, ctx) {
    xml = odtNotes(xml, ctx);
    var out = '';
    var stack = [];
    var re = /<(\/?)([a-zA-Z]+:[a-zA-Z-]+)([^>]*?)(\/?)>|([^<]+)/g;
    var m;
    while ((m = re.exec(xml)) !== null) {
      if (m[5] != null) { out += unent(m[5]); continue; }
      var close = m[1] === '/';
      var name = m[2];
      var attrs = m[3] || '';
      var self = m[4] === '/';

      if (name === 'text:span') {
        if (self) continue;
        if (close) {
          var mk = stack.pop();
          if (mk) out += mk;
          continue;
        }
        var sn = /text:style-name="([^"]*)"/.exec(attrs);
        var mark = sn ? (SPAN_MARK[sn[1]] || '') : '';
        stack.push(mark);
        out += mark;
        continue;
      }
      if (name === 'text:a') {
        if (close) {
          var href = stack.pop() || '';
          out += '](' + href + ')';
          continue;
        }
        var ha = /xlink:href="([^"]*)"/.exec(attrs);
        stack.push(ha ? ha[1] : '');
        out += '[';
        continue;
      }
      if (name === 'text:s') {
        var cm = /text:c="(\d+)"/.exec(attrs);
        out += new Array((cm ? parseInt(cm[1], 10) : 1) + 1).join(' ');
        continue;
      }
      if (name === 'text:tab') { out += '\t'; continue; }
      if (name === 'text:line-break') { out += '\n'; continue; }
      if (name === 'draw:image') {
        var ia = /xlink:href="([^"]*)"/.exec(attrs);
        if (ia) out += ctx.image(ia[1]);
        continue;
      }
      // 其它标签一律丢弃（text:p 的边界由外层负责）
    }
    while (stack.length) {
      var mk2 = stack.pop();
      if (mk2 && mk2.charAt(0) !== '[') out += mk2;
    }
    return out;
  }

  function odtTable(xml, ctx) {
    var rows = [];
    var rowRe = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
    var rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      var cells = [];
      var cellRe = /<table:table-cell([^>]*?)(\/?)>([\s\S]*?)<\/table:table-cell>|<table:table-cell([^>]*?)\/>/g;
      var cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        if (cm[4] != null) { cells.push(''); continue; }
        var rep = /table:number-columns-repeated="(\d+)"/.exec(cm[1] || '');
        var txt = odtInline(cm[3] || '', ctx).replace(/\s+/g, ' ').trim();
        cells.push(txt);
        if (rep && parseInt(rep[1], 10) > 1) {
          for (var r = 1; r < parseInt(rep[1], 10); r++) cells.push('');
        }
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    function line(cs) {
      var s = '|';
      for (var i = 0; i < cols; i++) s += ' ' + (cs[i] || '') + ' |';
      return s;
    }
    var out = line(rows[0]) + '\n|' + new Array(cols + 1).join(' --- |') + '\n';
    rows.slice(1).forEach(function (r) { out += line(r) + '\n'; });
    return out;
  }

  function fromOdt(bytes, opts) {
    opts = opts || {};
    var Zip = dep('zip', 'Zip');
    var files = Zip.read(bytes);
    var cm = files.filter(function (f) { return f.name === 'content.xml'; })[0];
    if (!cm || cm.text == null) throw new Error('ODT 里找不到 content.xml');

    // 图片资产：Pictures/ 下的全部取出来
    var assets = [];
    var imgMap = {};
    files.forEach(function (f) {
      if (!/^Pictures\//.test(f.name)) return;
      var base = f.name.replace(/^Pictures\//, '');
      var target = (opts.assetDir || 'assets/') + base;
      assets.push({ path: target, bytes: f.data || f.bytes });
      imgMap[base] = target;
      imgMap[f.name] = target;
    });

    var notes = [];
    var ctx = {
      notes: notes,
      image: function (href) {
        var key = String(href || '').replace(/^\.\//, '');
        var p = imgMap[key] || imgMap[key.replace(/^Pictures\//, '')] || key;
        return '![](' + p + ')';
      }
    };

    var xml = cm.text;
    var body = xml.replace(/^[\s\S]*?<office:body>/, '').replace(/<\/office:body>[\s\S]*$/, '');
    body = odtNotes(body, ctx);

    // 表格先整体摘出来，避免逐段扫描时被打散
    var tables = [];
    body = body.replace(/<table:table\b[\s\S]*?<\/table:table>/g, function (mt) {
      tables.push(odtTable(mt, ctx));
      return '\n\u0000T' + (tables.length - 1) + '\u0000\n';
    });

    var out = [];
    var listDepth = 0;
    var listType = [];        // 每层的 'b' | 'n'
    var listCount = [];       // 有序列表每层已编号到几
    var listFresh = [];       // 该层是不是刚开（要在前面补空行）
    var itemStarted = [];     // 每层当前项是否已经吐过正文
    var re = /<text:h\b([^>]*)>([\s\S]*?)<\/text:h>|<text:p\b([^>]*?)(\/?)>([\s\S]*?)<\/text:p>|<text:list(?=[\s>])([^>]*)>|<\/text:list>|<text:list-item>|<\/text:list-item>|\u0000(T\d+)\u0000/g;
    var m;
    while ((m = re.exec(body)) !== null) {
      if (m[7] != null) { out.push('', tables[parseInt(m[7].slice(1), 10)] || '', ''); continue; }
      if (m[1] != null) {
        var lv = (/text:outline-level="(\d+)"/.exec(m[1]) || [])[1] || '1';
        var htext = odtInline(m[2], ctx).trim();
        out.push('', new Array(parseInt(lv, 10) + 1).join('#') + ' ' + htext, '');
        continue;
      }
      if (m[3] != null && !m[4]) {
        var ptext = odtInline(m[5], ctx);
        if (listDepth > 0) {
          if (!itemStarted[listDepth - 1]) {
            itemStarted[listDepth - 1] = true;
            var pad = new Array((listDepth - 1) * 2 + 1).join(' ');
            var mark = listType[listDepth - 1] === 'n' ? (listCount[listDepth - 1] || 1) + '.' : '-';
            // 列表紧跟在段落后面时补一个空行，否则 Markdown 会把第一项当段落续行
            if (listDepth === 1 && listFresh[0] && out.length && out[out.length - 1] !== '') out.push('');
            if (listDepth === 1) listFresh[0] = false;
            out.push(pad + mark + ' ' + ptext.trim());
          } else {
            out.push(new Array((listDepth - 1) * 2 + 1).join(' ') + '  ' + ptext.trim());
          }
        } else {
          out.push('', ptext.trim());
        }
        continue;
      }
      if (m[6] != null) {
        var style = (/text:style-name="([^"]*)"/.exec(m[6]) || [])[1] || '';
        listDepth++;
        listType[listDepth - 1] = /^LN/.test(style) ? 'n' : 'b';
        listCount[listDepth - 1] = 0;
        listFresh[listDepth - 1] = true;
        itemStarted[listDepth - 1] = false;
        continue;
      }
      if (m[0] === '</text:list>') {
        if (listDepth > 0) { listDepth--; listType.length = listDepth; itemStarted.length = listDepth; listCount.length = listDepth; listFresh.length = listDepth; }
        if (listDepth === 0) out.push('');
        continue;
      }
      if (m[0] === '<text:list-item>') {
        if (listDepth > 0) {
          itemStarted[listDepth - 1] = false;
          listCount[listDepth - 1] = (listCount[listDepth - 1] || 0) + 1;
        }
        continue;
      }
    }

    var md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (notes.length) {
      md += '\n\n' + notes.map(function (n) { return '[^' + n.id + ']: ' + n.text; }).join('\n');
    }
    return {
      markdown: md + '\n',
      assets: assets,
      title: (opts.title || '').trim()
    };
  }

  /* ============================================================
   * 二、reStructuredText
   * ============================================================ */
  var RST_LV = { '=': 1, '-': 2, '~': 3, '^': 4, '"': 5, "'": 6 };

  function rstInline(s) {
    return String(s || '')
      // `文字 <url>`_ / `url`_
      .replace(/`([^`<]+?)\s*<([^>]+)>`_+/g, function (m, t, u) { return '[' + t.trim() + '](' + u.trim() + ')'; })
      .replace(/`([^`]+?)`_+/g, function (m, t) { return '[' + t + '](' + t + ')'; })
      // ``code``
      .replace(/``([^`]+)``/g, '`$1`')
      // :math:`x`
      .replace(/:math:`([^`]+)`/g, function (m, x) { return '$' + x + '$'; })
      // :sup: / :sub:
      .replace(/:sup:`([^`]+)`/g, '^$1^')
      .replace(/:sub:`([^`]+)`/g, '~$1~')
      // 脚注 [#x]_ / [1]_
      .replace(/\[#([^\]]*)\]_/g, '[^$1]')
      // 转义字符
      .replace(/\\([*`_|])/g, '$1');
  }

  function isUnderline(line, ch) {
    if (!line) return false;
    var t = line.replace(/\s+$/, '');
    if (t.length < 3) return false;
    var c = t.charAt(0);
    if (ch && c !== ch) return false;
    if (!RST_LV[c]) return false;
    for (var i = 0; i < t.length; i++) if (t.charAt(i) !== c) return false;
    return true;
  }

  function indentOf(line) {
    var m = /^[ \t]*/.exec(line);
    return m[0].replace(/\t/g, '    ').length;
  }

  function dedent(lines, n) {
    return lines.map(function (l) {
      var k = 0;
      while (k < n && (l.charAt(k) === ' ' || l.charAt(k) === '\t')) k++;
      return l.slice(k);
    });
  }

  function gridTable(lines) {
    // +----+----+ 形式的网格表 → GFM
    var rows = [], buf = null;
    lines.forEach(function (l) {
      if (/^\+[-=+]+\+/.test(l.trim())) {
        if (buf && buf.length) { rows = rows.concat(buf); buf = null; }
        return;
      }
      if (/^\|/.test(l.trim())) {
        if (!buf) buf = [];
        var cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
          .map(function (c) { return c.trim(); });
        buf.push(cells);
      }
    });
    if (buf && buf.length) rows = rows.concat(buf);
    if (!rows.length) return '';
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    function line(cs) {
      var s = '|';
      for (var i = 0; i < cols; i++) s += ' ' + (cs[i] || '') + ' |';
      return s;
    }
    var out = line(rows[0]) + '\n|' + new Array(cols + 1).join(' --- |') + '\n';
    rows.slice(1).forEach(function (r) { out += line(r) + '\n'; });
    return out;
  }

  function fromRst(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    var listStack = [];   // 缩进层级

    function blank() {
      if (out.length && out[out.length - 1] !== '') out.push('');
    }

    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();

      if (!t) { blank(); i++; continue; }

      // 网格表
      if (/^\+[-=+]+\+$/.test(t)) {
        var tb = [];
        while (i < lines.length && (/^[-=+|]/.test(lines[i].trim()) || !lines[i].trim())) {
          if (!lines[i].trim() && (i + 1 >= lines.length || !/^[-=+|]/.test(lines[i + 1].trim()))) break;
          tb.push(lines[i]); i++;
        }
        var gt = gridTable(tb);
        if (gt) { blank(); out.push(gt.replace(/\n$/, '')); blank(); }
        continue;
      }

      // 下划线标题（当前行 + 下一行全是同一个符号）
      if (i + 1 < lines.length && isUnderline(lines[i + 1]) && t.length && !isUnderline(line)) {
        var lv = RST_LV[lines[i + 1].trim().charAt(0)] || 1;
        blank();
        out.push(new Array(lv + 1).join('#') + ' ' + rstInline(t));
        blank();
        i += 2;
        continue;
      }
      // 上划线 + 标题 + 下划线
      if (isUnderline(line) && i + 2 < lines.length && isUnderline(lines[i + 2], line.trim().charAt(0))) {
        var lv2 = RST_LV[line.trim().charAt(0)] || 1;
        blank();
        out.push(new Array(lv2 + 1).join('#') + ' ' + rstInline(lines[i + 1].trim()));
        blank();
        i += 3;
        continue;
      }

      // 脚注定义：.. [#x] 正文 / .. [1] 正文
      var fnm = /^\.\.\s+\[#?([^\]]*)\]\s*([\s\S]*)$/.exec(t);
      if (fnm) {
        i++;
        var fx = [fnm[2] || ''];
        while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > 0) {
          fx.push(lines[i].trim()); i++;
        }
        var fid = String(fnm[1] || '').trim() || String(out.length);
        blank();
        out.push('[^' + fid + ']: ' + rstInline(fx.join(' ').replace(/\s+/g, ' ').trim()));
        blank();
        continue;
      }

      // 指令
      var dm = /^\.\.\s+([a-zA-Z-]+)::\s*(.*)$/.exec(t);
      if (dm) {
        var dir = dm[1].toLowerCase();
        var arg = dm[2].trim();
        i++;
        // 收集缩进块
        var base = null;
        var body = [];
        while (i < lines.length) {
          var l = lines[i];
          if (!l.trim()) {
            if (base == null) { i++; continue; }
            body.push(''); i++; continue;
          }
          var ind = indentOf(l);
          if (base == null) base = ind;
          if (ind < base) break;
          body.push(l);
          i++;
        }
        var bodyLines = dedent(body, base || 0);
        while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();

        if (dir === 'code-block' || dir === 'code' || dir === 'sourcecode') {
          blank();
          out.push('```' + (arg || ''));
          bodyLines.forEach(function (b) { out.push(b); });
          out.push('```');
          blank();
        } else if (dir === 'math') {
          blank();
          out.push('$$');
          bodyLines.forEach(function (b) { out.push(b); });
          out.push('$$');
          blank();
        } else if (dir === 'image' || dir === 'figure') {
          var alt = '';
          bodyLines.forEach(function (b) {
            var am = /^:alt:\s*(.*)$/.exec(b.trim());
            if (am) alt = am[1];
          });
          blank();
          out.push('![' + alt + '](' + arg + ')');
          blank();
        } else if (dir === 'contents') {
          blank();
          out.push('[TOC]');
          blank();
        } else if (dir === 'raw' && /html/.test(arg)) {
          blank();
          bodyLines.forEach(function (b) { out.push(b); });
          blank();
        } else if (/^(note|warning|tip|important|caution)$/.test(dir)) {
          blank();
          out.push('> [!' + dir.toUpperCase() + ']');
          bodyLines.forEach(function (b) { out.push('> ' + b); });
          blank();
        } else if (/^(\[#|\[)/.test(arg)) {
          // 脚注定义 .. [#x] 正文 / .. [1] 正文
          var fm = /^\[#?([^\]]*)\]\s*([\s\S]*)$/.exec(arg);
          if (fm) {
            var fid = fm[1] || String(i);
            var ftext = (fm[2] + ' ' + bodyLines.join(' ')).replace(/\s+/g, ' ').trim();
            blank();
            out.push('[^' + fid + ']: ' + rstInline(ftext));
            blank();
          }
        }
        // 其它指令（comment / target / meta…）直接丢掉
        continue;
      }

      // 注释块 .. 开头
      if (/^\.\.(\s|$)/.test(t)) {
        i++;
        while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > 0) i++;
        continue;
      }

      // 引用块：整体缩进
      if (indentOf(line) > 0 && !/^\s*([-*+]|\d+[.)])\s/.test(line) && listStack.length === 0) {
        var q = [];
        var qInd = indentOf(line);
        while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) >= qInd)) {
          q.push(lines[i].trim()); i++;
        }
        while (q.length && !q[q.length - 1]) q.pop();
        blank();
        q.forEach(function (b) { out.push(b ? '> ' + rstInline(b) : '>'); });
        blank();
        continue;
      }

      // 列表
      var lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (lm) {
        var ind2 = lm[1].replace(/\t/g, '    ').length;
        while (listStack.length && ind2 < listStack[listStack.length - 1]) listStack.pop();
        if (!listStack.length) { blank(); listStack.push(ind2); }
        else if (ind2 > listStack[listStack.length - 1]) listStack.push(ind2);
        var depth = listStack.length - 1;
        out.push(new Array(depth * 2 + 1).join(' ') + lm[2].replace(')', '.') + ' ' + rstInline(lm[3]));
        i++;
        continue;
      }

      // 普通段落：连续的顶层行拼成一段
      var para = [t];
      i++;
      while (i < lines.length && lines[i].trim() &&
        !isUnderline(lines[i]) &&
        !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
        !/^\.\.\s/.test(lines[i].trim()) &&
        !/^\+[-=+]+\+$/.test(lines[i].trim()) &&
        !/^\|/.test(lines[i].trim())) {
        para.push(lines[i].trim());
        i++;
      }
      blank();
      out.push(rstInline(para.join(' ')));
      blank();
      listStack.length = 0;
    }

    var md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: md + '\n', assets: [], title: '' };
  }

  /* ============================================================
   * 三、LaTeX
   *
   * 不是完整 TeX 解释器：只认「写文档时会用到的」那一层——
   * 分节命令、itemize/enumerate、tabular、verbatim、公式环境，
   * 以及 textbf/emph/texttt/href/footnote/includegraphics 一类行内命令。
   * 未知命令默认保留花括号里的内容（只掉样式），比整段丢掉安全。
   * ============================================================ */
  var TEX_LEVEL = {
    article: { chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 },
    book: { chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 }
  };

  function takeGroup(s, i) {
    // s[i] === '{'
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      var c = s.charAt(j);
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
      }
    }
    return { body: s.slice(i + 1), end: s.length };
  }

  // 顶层切分：花括号与 $…$ 内部的 sep 不算
  function splitTop(s, sep) {
    var out = [], buf = '', depth = 0, math = false, i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '\\') {
        if (sep === '\\\\' && s.substr(i, 2) === '\\\\' && !math && depth === 0) {
          out.push(buf); buf = ''; i += 2; continue;
        }
        buf += s.substr(i, 2); i += 2; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '$') math = !math;
      else if (sep === '&' && c === '&' && !math && depth === 0) {
        out.push(buf); buf = ''; i += 1; continue;
      }
      buf += c; i++;
    }
    out.push(buf);
    return out;
  }

  function texInline(s, ctx) {
    s = String(s == null ? '' : s);
    var out = '', i = 0, n = s.length;

    while (i < n) {
      var c = s.charAt(i);

      if (c === '\\') {
        var m = /^\\([a-zA-Z]+\*?)/.exec(s.slice(i));
        if (!m) {
          var nx = s.charAt(i + 1);
          if (nx === '\\') {
            // 换行命令，可能带 \\[2ex] 间距参数
            var j2 = i + 2;
            if (s.charAt(j2) === '[') {
              var be = s.indexOf(']', j2);
              if (be > 0) j2 = be + 1;
            }
            out += '\n';
            i = j2; continue;
          }
          if ('&%_#${}'.indexOf(nx) >= 0) { out += nx; i += 2; continue; }
          if (nx === ' ') { out += ' '; i += 2; continue; }
          if (nx === ',' || nx === ';' || nx === ':' || nx === '~') { out += ' '; i += 2; continue; }
          if (nx === '!' || nx === '/' || nx === '-') { i += 2; continue; }
          out += nx; i += 2; continue;
        }

        var name = m[1].replace(/\*$/, '');
        var j = i + m[0].length;
        var opt = null, arg = null;

        if (name === 'verb') {
          var d = s.charAt(j), k = d ? s.indexOf(d, j + 1) : -1;
          if (k < 0) { i = n; continue; }
          out += '`' + s.slice(j + 1, k).replace(/`/g, "'") + '`';
          i = k + 1; continue;
        }

        if (s.charAt(j) === '[') {
          var oe = s.indexOf(']', j);
          if (oe > 0) { opt = s.slice(j + 1, oe); j = oe + 1; }
        }
        if (s.charAt(j) === '{') { var g = takeGroup(s, j); arg = g.body; j = g.end; }

        switch (name) {
          case 'textbf': out += '**' + texInline(arg, ctx) + '**'; break;
          case 'textit': case 'emph': case 'textsl': case 'textup': case 'textsc':
            out += '*' + texInline(arg, ctx) + '*'; break;
          case 'texttt': out += '`' + String(arg || '').replace(/`/g, "'") + '`'; break;
          case 'underline': out += '<u>' + texInline(arg, ctx) + '</u>'; break;
          case 'sout': case 'st': case 'xout': out += '~~' + texInline(arg, ctx) + '~~'; break;
          case 'textsuperscript': case 'textone': out += '^' + texInline(arg, ctx) + '^'; break;
          case 'textsubscript': out += '~' + texInline(arg, ctx) + '~'; break;
          case 'highlightbox': case 'hl': out += '==' + texInline(arg, ctx) + '=='; break;
          case 'href': {
            var t2 = '';
            if (s.charAt(j) === '{') { var g2 = takeGroup(s, j); t2 = g2.body; j = g2.end; }
            out += '[' + texInline(t2, ctx) + '](' + String(arg || '').trim() + ')';
            break;
          }
          case 'url': out += '<' + String(arg || '').trim() + '>'; break;
          case 'includegraphics': {
            var src = String(arg || '').trim();
            var size = '';
            var wm = /width\s*=\s*([\d.]+)\s*(cm|mm|in|pt|em)/.exec(String(opt || ''));
            if (wm) {
              var v = parseFloat(wm[1]), unit = wm[2];
              var px = unit === 'cm' ? v * 96 / 2.54 : unit === 'mm' ? v * 96 / 25.4 :
                unit === 'in' ? v * 96 : unit === 'pt' ? v * 96 / 72 : v * 16;
              size = ' =' + Math.round(px);
            }
            out += '![](' + (/[\s()<>]/.test(src) ? '<' + src + '>' : src) + size + ')';
            break;
          }
          case 'footnote': {
            ctx.fnCount = (ctx.fnCount || 0) + 1;
            ctx.fn.push({ n: ctx.fnCount, body: arg || '' });
            out += '[^' + ctx.fnCount + ']';
            break;
          }
          case 'cite': case 'citep': case 'citet':
            out += '[@' + String(arg || '').replace(/\s+/g, ', @') + ']'; break;
          case 'ref': case 'eqref': case 'autoref': case 'pageref':
            out += '[' + String(arg || '').trim() + ']'; break;
          case 'label': break;
          case 'caption': out += '*' + texInline(arg, ctx) + '*' + (opt ? ' ' : ''); break;
          case 'textbackslash': out += '\\'; break;
          case 'quad': case 'qquad': out += ' '; break;
          case 'ldots': case 'dots': case 'textellipsis': out += '\u2026'; break;
          case 'textendash': out += '\u2013'; break;
          case 'textemdash': out += '\u2014'; break;
          case 'copyright': case 'textcopyright': out += '\u00a9'; break;
          case 'textregistered': out += '\u00ae'; break;
          case 'texttrademark': out += '\u2122'; break;
          case 'textdegree': out += '\u00b0'; break;
          case 'textpm': out += '\u00b1'; break;
          case 'texttimes': out += '\u00d7'; break;
          case 'S': out += '\u00a7'; break;
          case 'par': out += '\n\n'; break;
          case 'newline': case 'linebreak': case 'newpage': case 'clearpage': break;
          case 'hspace': case 'vspace': if (s.charAt(j) === '{') { var g3 = takeGroup(s, j); j = g3.end; } break;
          case 'makebox': case 'framebox': case 'parbox': case 'resizebox': case 'scalebox':
          case 'mbox': case 'hbox': case 'text': case 'textrm': case 'textsf':
          case 'textnormal': case 'ensuremath': case 'smash': case 'raisebox':
            out += texInline(arg, ctx);
            break;
          case 'item': break;   // 块级由 texList 处理，跑到这里说明是异常位置
          default:
            // 未知命令：有参数就保留内容，没有就整条丢掉（\centering 之类）
            if (arg != null) out += texInline(arg, ctx);
            else if (opt != null) out += opt;
        }
        i = j; continue;
      }

      if (c === '$') {
        // 公式原样保留，里面的 \alpha 之类不参与转换
        var dd = s.charAt(i + 1) === '$';
        var close = s.indexOf(dd ? '$$' : '$', i + (dd ? 2 : 1));
        if (close < 0) { out += s.slice(i); i = n; continue; }
        out += s.slice(i, close + (dd ? 2 : 1));
        i = close + (dd ? 2 : 1); continue;
      }

      if (c === '~') { out += ' '; i++; continue; }
      if (c === '`' && s.substr(i, 2) === '``') { out += '\u201c'; i += 2; continue; }
      if (c === "'" && s.substr(i, 2) === "''") { out += '\u201d'; i += 2; continue; }
      if (c === '-' && s.substr(i, 3) === '---') { out += '\u2014'; i += 3; continue; }
      if (c === '-' && s.substr(i, 2) === '--') { out += '\u2013'; i += 2; continue; }
      out += c; i++;
    }
    return out;
  }

  function texEnvBody(s, from, env) {
    var pat = new RegExp('\\\\(begin|end)\\s*\\{' + env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'g');
    pat.lastIndex = from;
    var depth = 1, m;
    while ((m = pat.exec(s))) {
      if (m[1] === 'begin') depth++;
      else {
        depth--;
        if (depth === 0) return { body: s.slice(from, m.index), end: m.index + m[0].length };
      }
    }
    return { body: s.slice(from), end: s.length };
  }

  function texList(body, env, ctx) {
    // 顶层 \item 切分（嵌套环境里的 \item 属于内层）
    var items = [];
    var depth = 0, mark = -1;
    for (var i = 0; i < body.length; i++) {
      if (body.charAt(i) === '\\') {
        var rest = body.slice(i);
        if (/^\\begin\s*\{/.test(rest)) depth++;
        else if (/^\\end\s*\{/.test(rest)) depth--;
        else if (depth === 0 && /^\\item\b/.test(rest)) {
          if (mark >= 0) items.push(body.slice(mark, i));
          mark = i;
        }
        i += 1;
      }
    }
    if (mark >= 0) items.push(body.slice(mark));

    var out = '';
    items.forEach(function (raw, k) {
      var t = raw.replace(/^\\item\b/, '').trim();
      var label = '';
      if (t.charAt(0) === '[') {
        var be = t.indexOf(']');
        if (be > 0) { label = t.slice(1, be); t = t.slice(be + 1).trim(); }
      }
      var md = texBlocks(t, ctx).trim();
      if (env === 'description' && label) md = '**' + texInline(label, ctx) + '** ' + md;
      // 段落与子列表之间不能留空行：解析器按缩进判层，空行会把子列表切出去
      md = md.split('\n').filter(function (l, k, arr) {
        return !(l.trim() === '' && k + 1 < arr.length && /^\s*(?:[-*+]|\d+[.)])\s/.test(arr[k + 1]));
      }).join('\n');
      var lines = md.split('\n');
      var head = env === 'enumerate' ? (k + 1) + '.' : '-';
      out += head + ' ' + (lines.shift() || '') + '\n';
      lines.forEach(function (l) { out += (l ? '  ' + l : '') + '\n'; });
    });
    return out.replace(/\n+$/, '');
  }

  function texTable(body, ctx) {
    // 列格式说明 {|l|c|}、位置参数 [t]、tabularx 的宽度参数都要先摘掉
    body = String(body).replace(/^\s*(?:\[[^\]]*\]\s*)?(?:\{[^{}]*\}\s*)?(?:\{[^{}]*\}\s*)?/, '');
    var rows = splitTop(body, '\\\\').map(function (r) {
      return r
        .replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)\b/g, '')
        .replace(/\\cline\s*\{[^}]*\}/g, '')
        .replace(/\\cmidrule(\([^)]*\))?\s*\{[^}]*\}/g, '')
        .trim();
    }).filter(function (r) {
      // 纯列格式残留（如 |l|c| 或 @{}）整行丢掉
      return r && !/^[|lcrp@{}\s]*$/.test(r);
    });
    if (!rows.length) return '';
    var grid = rows.map(function (r) {
      return splitTop(r, '&').map(function (c) { return texInline(c.trim(), ctx).replace(/\s+/g, ' ').trim(); });
    });
    var cols = Math.max.apply(null, grid.map(function (g) { return g.length; }));
    function line(cs) {
      var s = '|';
      for (var i = 0; i < cols; i++) s += ' ' + (cs[i] || '') + ' |';
      return s;
    }
    var out = line(grid[0]) + '\n|' + new Array(cols + 1).join(' --- |') + '\n';
    grid.slice(1).forEach(function (r) { out += line(r) + '\n'; });
    return out;
  }

  function texEnv(env, body, ctx) {
    switch (env) {
      case 'document': case 'center': case 'flushleft': case 'flushright':
      case 'figure': case 'figure*': case 'table': case 'table*': case 'minipage':
      case 'abstract': case 'titlepage': case 'small': case 'footnotesize':
      case 'samepage': case 'multicols':
        return texBlocks(body, ctx);

      case 'itemize': case 'enumerate': case 'description':
        return texList(body, env, ctx);

      case 'verbatim': case 'verbatim*': case 'lstlisting': case 'minted': case 'alltt': {
        var code = body.replace(/^\n+/, '').replace(/\n+$/, '');
        return '```\n' + code + '\n```';
      }

      case 'quote': case 'quotation': case 'verse': {
        var inner = texBlocks(body, ctx);
        if (!inner) return '';
        return inner.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n');
      }

      case 'equation': case 'equation*': case 'align': case 'align*': case 'alignat':
      case 'alignat*': case 'gather': case 'gather*': case 'eqnarray': case 'eqnarray*':
      case 'multline': case 'multline*': case 'displaymath': case 'math': case 'split':
        return '$$\n' + body.replace(/^\n+|\n+$/g, '') + '\n$$';

      case 'tabular': case 'tabular*': case 'tabularx': case 'longtable': case 'array':
        return texTable(body, ctx);

      case 'thebibliography':
        return texList(body, 'itemize', ctx);

      default:
        return texBlocks(body, ctx);
    }
  }

  function texHeading(para, ctx) {
    var hm = /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph|part)(\*?)\s*\{/.exec(para);
    if (!hm) return null;
    var g = takeGroup(para, hm[0].length - 1);
    var rest = para.slice(g.end).trim();
    var base = ctx.hasChapter ? TEX_LEVEL.book : TEX_LEVEL.article;
    var lv = hm[1] === 'part' ? 1 : (base[hm[1]] || 1);
    return {
      md: new Array(lv + 1).join('#') + ' ' + texInline(g.body, ctx).trim() +
        (rest ? '\n\n' + texInline(rest, ctx) : ''),
      end: g.end
    };
  }

  function texBlocks(text, ctx) {
    text = String(text || '');
    var parts = [];
    var re = /\\begin\s*\{([a-zA-Z*]+)\}/g;
    var i = 0;

    while (true) {
      re.lastIndex = i;
      var m = re.exec(text);
      if (!m) { parts.push(texParas(text.slice(i), ctx)); break; }
      parts.push(texParas(text.slice(i, m.index), ctx));
      var got = texEnvBody(text, m.index + m[0].length, m[1]);
      parts.push(texEnv(m[1], got.body, ctx));
      i = got.end;
    }
    return parts.filter(function (p) { return p && p.trim(); }).join('\n\n');
  }

  function texParas(text, ctx) {
    var chunks = String(text).split(/\n[ \t]*\n/);
    var out = [];
    chunks.forEach(function (chunk) {
      var para = chunk.replace(/^[ \t]+|[ \t]+$/g, '');
      if (!para) return;
      var h = texHeading(para, ctx);
      if (h) { out.push(h.md); return; }
      // 源文件里的换行是排版换行，不是语义换行 → 折成空格
      var flat = para.replace(/[ \t]*\n[ \t]*/g, ' ');
      var md = texInline(flat, ctx).replace(/[ \t]+$/gm, '').trim();
      if (md) out.push(md);
    });
    return out.join('\n\n');
  }

  function fromLatex(text, opts) {
    opts = opts || {};
    var src = String(text || '').replace(/\r\n?/g, '\n');
    src = src.replace(/(^|[^\\])%.*$/gm, '$1');

    function meta1(name) {
      var m = new RegExp('\\\\' + name + '\\s*\\{').exec(src);
      if (!m) return '';
      var g = takeGroup(src, m.index + m[0].length - 1);
      return g.body.replace(/\\\\/g, ' ').replace(/[{}]/g, '').trim();
    }

    var title = opts.title || meta1('title');
    var author = meta1('author');

    var body = src;
    var bm = /\\begin\s*\{document\}/.exec(src);
    if (bm) {
      var em = /\\end\s*\{document\}/.exec(src.slice(bm.index));
      body = src.slice(bm.index + bm[0].length, em ? bm.index + em.index : src.length);
    } else {
      body = src.split('\n').filter(function (l) {
        return !/^\\(documentclass|usepackage|RequirePackage|newcommand|renewcommand|providecommand|def|let|title|author|date|maketitle|setlength|addtolength|pagestyle|thispagestyle|geometry|hypersetup|bibliography|bibliographystyle|input|include|graphicspath|lstset|capture)(\W|$)/.test(l);
      }).join('\n');
    }

    var ctx = {
      fn: [], fnCount: 0,
      hasChapter: /\\chapter\b/.test(body)
    };

    body = body
      .replace(/\\maketitle\b/g, '')
      .replace(/\\tableofcontents\b/g, '\n\n[TOC]\n\n')
      .replace(/\\(newpage|clearpage|pagebreak|nopagebreak|bigskip|medskip|smallskip|vfill|hfill|noindent|indent|centering|raggedright|raggedleft)\b/g, '')
      .replace(/\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|mdseries|itshape|slshape|scshape|upshape|rmfamily|sffamily|ttfamily|em|bf)\b/g, '');

    var md = texBlocks(body, ctx);

    if (ctx.fn.length) {
      md += '\n\n' + ctx.fn.map(function (f) {
        return '[^' + f.n + ']: ' + texInline(f.body.replace(/[ \t]*\n[ \t]*/g, ' '), { fn: [], fnCount: 0 }).trim();
      }).join('\n');
    }

    md = md.replace(/\n{3,}/g, '\n\n').trim();

    return {
      markdown: md ? md + '\n' : '',
      assets: [],
      title: title,
      author: author
    };
  }

  return {
    fromOdt: fromOdt, fromRst: fromRst, fromLatex: fromLatex,
    odtInline: odtInline, rstInline: rstInline, texInline: texInline
  };
});
