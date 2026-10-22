/* ============================================================
 * yaml.js — YAML front matter 读取与「导出覆盖」归一化
 *
 * 背景：Typora / pandoc 的约定——文档开头 `---` 围栏里的键值对
 * 会覆盖导出设置（title/author/date/toc/papersize/geometry…）。
 *
 * 取舍：不引 YAML 库。导出用得到的只有「扁平 key: value」，
 * 列表 / 嵌套 / 多行折叠这些写法导出侧用不上；遇到不识别的行
 * 直接跳过，绝不给导出链扔异常。安全上，凡是会原样进 LaTeX
 * preamble 的值（geometry / linestretch / documentclass）都过
 * 白名单与字符黑名单，挡掉 `\` `{` `}` `;` 一类注入。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Yaml = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 从 src 开头剥出 front matter 正文（不含围栏）；没有则返回 null */
  function frontRaw(src) {
    var m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(String(src || ''));
    return m ? m[1] : null;
  }

  /* 解析 front matter 正文 → 小写键的扁平 map。
   * - `#` 注释行整行丢；未加引号的值剥掉行内 ` # 注释`
   * - 单/双引号包裹的值取引号内原文（不再剥注释）
   * - `key:` 后面为空的不进 map（调用方统一按「没写」处理）
   */
  function parseFront(raw) {
    var meta = {};
    String(raw == null ? '' : raw).split(/\r?\n/).forEach(function (line) {
      var l = line.trim();
      if (!l || l.charAt(0) === '#') return;
      var m = /^([A-Za-z][\w.-]*)[ \t]*:[ \t]*(.*)$/.exec(l);
      if (!m) return;
      var v = m[2].trim();
      if (!v) return;
      if (v.charAt(0) === '"' || v.charAt(0) === "'") {
        var q = v.charAt(0);
        var end = v.lastIndexOf(q);
        if (end > 0) v = v.slice(1, end);      // 引号包裹：原样取，不剥注释
      } else {
        v = v.replace(/[ \t]+#.*$/, '').trim(); // 裸值：剥行内注释
      }
      if (v !== '') meta[m[1].toLowerCase()] = v;
    });
    return meta;
  }

  /* 三个入口：src / parse 后的 blocks / 已拿到的 raw */
  function metaOf(src) {
    var raw = frontRaw(src);
    return raw == null ? {} : parseFront(raw);
  }

  function metaOfBlocks(blocks) {
    if (blocks && blocks.length && blocks[0] && blocks[0].type === 'frontmatter') {
      return parseFront(String(blocks[0].raw).replace(/^\uFEFF?---[ \t]*\r?\n/, '')
        .replace(/\r?\n(?:---|\.\.\.)[ \t]*$/, ''));
    }
    return {};
  }

  /* ---------------- 归一化：把可能被手写坏的值夹回合法形态 ---------------- */

  function boolOf(v) {
    return /^(true|yes|on|1)$/i.test(String(v == null ? '' : v).trim());
  }

  // papersize → a4/letter/a3/a5；不认识的返回 ''（调用方回落默认）
  function paperOf(v) {
    var p = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s_-]/g, '');
    return /^(a3|a4|a5|letter)$/.test(p) ? p : '';
  }

  // fontsize → 10pt/11pt/12pt；其余（9pt、abc、空）返回 ''
  function fontsizeOf(v) {
    var m = /^(\d{1,2})(?:pt)?$/i.exec(String(v == null ? '' : v).trim());
    if (!m) return '';
    var n = parseInt(m[1], 10);
    return (n === 10 || n === 11 || n === 12) ? n + 'pt' : '';
  }

  // documentclass 只放行纯字母（ctexart/article/report/book…），挡注入
  function docclassOf(v) {
    var m = /^[A-Za-z]{2,24}$/.exec(String(v == null ? '' : v).trim());
    return m ? m[0] : '';
  }

  /* geometry / keywords 一类「原样进 LaTeX」的串：
   * 允许字母数字、空格、逗号、冒号、等号、点、连字符、斜杠（in/cm/pt/%），
   * 出现 \ { } ; ` $ 一律作废。 */
  function safeParam(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || /[\\{};`$]/.test(s)) return '';
    return s;
  }

  // linestretch → 0.1–3 之间的数字串
  function linestretchOf(v) {
    var n = Number(String(v == null ? '' : v).trim());
    return (isFinite(n) && n >= 0.1 && n <= 3) ? String(n) : '';
  }

  /* ---------------- 导出覆盖总入口 ----------------
   * 返回导出器直接可用的归一化对象；字段缺失时都是空串 / false，
   * 调用方写 `y.title || fallback` 即可，不用重复判空。
   */
  function overrides(src) {
    var meta = metaOf(src);
    return {
      meta: meta,
      title: meta.title || '',
      subtitle: meta.subtitle || '',
      author: meta.author || '',
      date: meta.date || '',
      keywords: meta.keywords || '',
      toc: boolOf(meta.toc),
      tocTitle: meta['toc-title'] || '',
      paper: paperOf(meta.papersize),
      geometry: safeParam(meta.geometry),
      fontsize: fontsizeOf(meta.fontsize),
      linestretch: linestretchOf(meta.linestretch),
      docclass: docclassOf(meta.documentclass)
    };
  }

  return {
    frontRaw: frontRaw,
    parseFront: parseFront,
    metaOf: metaOf,
    metaOfBlocks: metaOfBlocks,
    overrides: overrides,
    boolOf: boolOf,
    paperOf: paperOf,
    fontsizeOf: fontsizeOf,
    docclassOf: docclassOf,
    safeParam: safeParam,
    linestretchOf: linestretchOf
  };
});
