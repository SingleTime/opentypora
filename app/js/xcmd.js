/* ============================================================
 * xcmd.js — 自定义导出命令（pandoc 等外部转换器）
 *
 * 背景：Typora 的「Export → Custom」允许把当前 Markdown 交给外部
 * 命令处理，命令里用占位符引用文档与输出路径。内置导出器再全也
 * 覆盖不到 icml / docbook / asciidoc 这类格式，与其继续堆包，
 * 不如把口子开给用户。
 *
 * 占位符（两套名字都认，Typora 老配置能直接搬过来）：
 *   {src} {currentFilePath}   当前文档的临时 Markdown 副本
 *   {out} {outputPath}        保存面板选中的输出文件
 *   {name}                    文档主名（不含扩展名）
 *   {dir}                     文档所在目录
 *   {ext}                     这条命令声明的输出扩展名
 *
 * 取舍：命令统一走 `/bin/sh -c`，这样管道、`~`、环境变量都能用；
 * 代价是要自己把「命令不存在」翻译成人话（见 notFoundHint）。
 * 本模块只做纯字符串处理，进程执行在原生侧。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Xcmd = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PLACEHOLDERS = ['src', 'currentFilePath', 'out', 'outputPath', 'name', 'dir', 'ext'];

  /* pandoc 预设：覆盖内置导出器没有的几种常见目标。
   * `--resource-path` 让相对图片在临时目录里也能被找到。 */
  var DEFAULTS = [
    {
      name: 'ICML（InDesign）',
      cmd: 'pandoc -f markdown -t icml --resource-path="{dir}" "{src}" -o "{out}"',
      ext: 'icml'
    },
    {
      name: 'DocBook 5',
      cmd: 'pandoc -f markdown -t docbook5 --resource-path="{dir}" "{src}" -o "{out}"',
      ext: 'xml'
    },
    {
      name: 'AsciiDoc',
      cmd: 'pandoc -f markdown -t asciidoc --resource-path="{dir}" "{src}" -o "{out}"',
      ext: 'adoc'
    }
  ];

  // Typora 用的老名字，两套都展开到同一个变量上
  var ALIAS = { currentFilePath: 'src', outputPath: 'out' };
  // 这些只是「包在外层」的调用方式，真正的程序在后面
  var WRAPPERS = ['env', 'nohup', 'nice', 'time'];

  function baseNameOf(tok) {
    var slash = String(tok).lastIndexOf('/');
    return slash >= 0 ? String(tok).slice(slash + 1) : String(tok);
  }

  /* 占位符替换。vars 里缺的键原样保留（让用户看见没展开的地方）。 */
  function expand(tpl, vars) {
    vars = vars || {};
    return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (all, key) {
      var k = ALIAS[key] || key;
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : all;
    });
  }

  /* 按 shell 规则切词：引号内不切，遇到管道/连接符就停（后面不是第一条命令）。
   * 不做转义求值——这里只用于判断「要执行的程序在不在」。 */
  function tokenize(cmd) {
    var out = [], cur = '', quote = '', started = false;
    var s = String(cmd == null ? '' : cmd);
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (quote) {
        if (c === quote) { quote = ''; continue; }
        cur += c; continue;
      }
      if (c === '"' || c === "'") { quote = c; started = true; continue; }
      if (/[|;&<>]/.test(c)) break;
      if (/\s/.test(c)) {
        if (started) { out.push(cur); cur = ''; started = false; }
        continue;
      }
      cur += c; started = true;
    }
    if (started) out.push(cur);
    return out;
  }

  /* 取实际要执行的程序名：跳过 `env` / `nohup` 一类的包装与 `VAR=val` 前缀 */
  function firstBin(cmd) {
    var toks = tokenize(cmd);
    var i = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (/^[A-Za-z_][\w-]*=/.test(t)) { i++; continue; }        // 环境变量赋值
      if (WRAPPERS.indexOf(baseNameOf(t)) >= 0) { i++; continue; }
      break;
    }
    return i < toks.length ? baseNameOf(toks[i]) : '';
  }

  /* 找不到的程序给一句能直接照做的提示；认得的只有 pandoc 一个，
   * 其余统一回「请确认已安装并加入 PATH」。 */
  function notFoundHint(bin) {
    if (bin === 'pandoc') return '没有找到 pandoc，先装一下：brew install pandoc';
    return '没有找到「' + bin + '」，请确认已安装且已加入 PATH';
  }

  /* 校验一条命令。error 是硬伤（不能执行），warn 只是提醒。 */
  function check(cmd) {
    var c = String(cmd && cmd.cmd != null ? cmd.cmd : '');
    var res = { ok: true, error: '', warn: '', bin: firstBin(c) };
    if (!c.trim()) { res.ok = false; res.error = '命令为空'; return res; }
    // 命令名含占位符说明是拼出来的，无法静态判断存在性，交给运行时
    if (!res.bin) { res.ok = false; res.error = '取不到要执行的程序名'; return res; }
    if (!/\{(out|outputPath)\}/.test(c)) {
      res.ok = false;
      res.error = '命令里缺少 {out}，导出的文件不知道该写到哪';
      return res;
    }
    if (!/\{(src|currentFilePath)\}/.test(c)) {
      res.warn = '命令里没有 {src}，当前文档不会被传进去';
    }
    if (/[`($]|&&|\|\||\bsudo\b|\brm\b|\bmv\b/.test(c)) {
      res.warn = res.warn || '命令包含 shell 元字符，会原样交给 /bin/sh 执行';
    }
    return res;
  }

  /* 归一化命令列表：补齐 id / ext，丢掉空项，限制条数。 */
  var MAX = 12;
  function norm(list) {
    var src = Array.isArray(list) ? list : [];
    var out = [];
    for (var i = 0; i < src.length && out.length < MAX; i++) {
      var it = src[i] || {};
      var cmd = String(it.cmd == null ? '' : it.cmd);
      if (!cmd.trim()) continue;
      var ext = String(it.ext == null ? '' : it.ext).replace(/^\.+/, '').trim();
      out.push({
        id: String(it.id || ('c' + i + '-' + cmd.length)),
        name: String(it.name == null || !String(it.name).trim() ? (firstBin(cmd) || '自定义') : it.name).slice(0, 40),
        cmd: cmd,
        ext: ext || 'out'
      });
    }
    return out;
  }

  /* 菜单副标题：命令太长就掐断，保持两行内 */
  function summary(cmd, max) {
    var s = String(cmd == null ? '' : cmd).replace(/\s+/g, ' ').trim();
    var n = max || 46;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* 展开后交给原生执行前最后一次检查：占位符必须全部展开完 */
  function unresolved(text) {
    var hits = [];
    String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (all, key) {
      if (PLACEHOLDERS.indexOf(key) >= 0) hits.push(key);
      return all;
    });
    return hits;
  }

  return {
    PLACEHOLDERS: PLACEHOLDERS,
    ALIAS: ALIAS,
    WRAPPERS: WRAPPERS,
    DEFAULTS: DEFAULTS,
    MAX: MAX,
    expand: expand,
    tokenize: tokenize,
    firstBin: firstBin,
    notFoundHint: notFoundHint,
    check: check,
    norm: norm,
    summary: summary,
    unresolved: unresolved
  };
});
