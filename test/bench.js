/* 导出链路性能基准：Node 与 WKWebView 共用同一份代码。
 * 目的不是刷分数，而是量出「哪一段真正占时间」。
 */
(function (root) {
  'use strict';

  function dep(name) {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('../app/js/' + name + '.js'); } catch (e) { return null; }
    }
    return root[{ md: 'MD', inline: 'Inline', zip: 'Zip', docx: 'Docx', export: 'Export' }[name]] || null;
  }

  /* 一个「单元」≈ 600 字节：标题 + 段落（含行内标记/链接/公式）+ 列表 + 表格 + 代码块 */
  function unit(i) {
    return [
      '## 第 ' + (i + 1) + ' 节 标题带 *强调* 与 `code`',
      '',
      '这是一段正文，包含 **粗体**、*斜体*、~~删除线~~、`inline code`、' +
        '[一个链接](https://example.com/path?q=' + i + ')、行内公式 $E=mc^2$ 以及脚注引用[^n' + i + ']。' +
        '后面再补一些文字凑长度，让每段接近真实写作的密度，不要短得像占位符。',
      '',
      '- 无序项 A，带 `code`',
      '- 无序项 B，带 **强调**',
      '  - 嵌套子项 C',
      '',
      '1. 有序项甲',
      '2. 有序项乙',
      '',
      '| 列一 | 列二 | 列三 |',
      '|:-----|:----:|-----:|',
      '| a' + i + ' | **b** | `c` |',
      '| d | *e* | f |',
      '',
      '```js',
      'function step' + i + '(x) {',
      '  return x * ' + i + ';',
      '}',
      '```',
      '',
      '> 引用一句：导出链路的耗时应该与文档长度成线性。',
      '',
      '[^n' + i + ']: 第 ' + (i + 1) + ' 个脚注，含 **加粗**。',
      ''
    ].join('\n');
  }

  function doc(units) {
    var out = ['[TOC]', '', '# 基准文档', ''];
    for (var i = 0; i < units; i++) out.push(unit(i));
    return out.join('\n');
  }

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Number(process.hrtime.bigint()) / 1e6;
  }

  function b64(bytes) {
    var chunk = 0x8000, out = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return (typeof btoa !== 'undefined' ? btoa : function (s) { return Buffer.from(s, 'binary').toString('base64'); })(out);
  }

  function run(sizes, done) {
    var MD = dep('md'), Docx = dep('docx'), Export = dep('export'), Zip = dep('zip');
    var rows = [], idx = 0;

    // zip 与 base64：用固定 3 MB 的典型 XML 文本，单独看纯 I/O 成本
    var blob = doc(5000);
    var t = now();
    var zbytes = Zip.build([{ name: 'a.xml', data: blob }, { name: 'b.xml', data: blob }]);
    var zipMs = now() - t;
    t = now();
    b64(zbytes);
    var b64Ms = now() - t;

    function next() {
      if (idx >= sizes.length) {
        return done({ rows: rows, zipMs: zipMs, b64Ms: b64Ms, zipBytes: zbytes.length });
      }
      var units = sizes[idx++];
      var src = doc(units);
      var r = { units: units, chars: src.length, bytes: src.length };

      var t0 = now();
      MD.parse(src);
      r.parse = now() - t0;

      t0 = now();
      Docx.build(src, { title: 'bench' }).then(function (d) {
        r.docx = now() - t0;
        r.docxBytes = d.bytes.length;
        r.fn = d.footnotes;

        t0 = now();
        return Export.epub(src, { title: 'bench' }).then(function (e) {
          r.epub = now() - t0;
          r.epubBytes = e.bytes.length;

          t0 = now();
          Export.latex(src, { title: 'bench' });
          r.tex = now() - t0;

          // 主线程占用：docx 是纯同步计算，这一段就是 UI 会卡住的时长
          r.block = r.parse + r.docx;
          rows.push(r);
          next();
        });
      }).catch(function (e) {
        r.err = String(e && e.message || e);
        rows.push(r);
        next();
      });
    }
    next();
  }

  var api = { run: run, doc: doc, unit: unit, now: now };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bench = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
