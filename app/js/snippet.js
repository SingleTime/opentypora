/* ============================================================
 * snippet.js — Text Snippet（文本片段）
 *
 * 文本片段：预先定义缩写 → 大段内容，敲缩写按 Tab 展开。
 * 这里实现同样的东西，另外多给一个光标落点标记 `$0`。
 *
 * 存储格式（偏好里直接编辑这个文本，一行一条）：
 *
 *   # 注释
 *   sig => 此致\n敬礼\n\n$0
 *   brb => be right back
 *
 * 规则：
 *   - `=>` 左边是触发词（不含空格，1–32 字符），右边是展开内容
 *   - `\n` `\t` `\\` 在内容里生效（一行写完多行内容，不用真的换行）
 *   - `$0`（可省略）是展开后光标落点；没有就落在末尾
 *   - `#` 开头是注释；空行跳过
 *   - 触发词重复时后定义覆盖先定义（便于改）
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Snippets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var CURSOR = '$0';

  function unescapeBody(s) {
    return String(s).replace(/\\(n|t|\\)/g, function (m, c) {
      return c === 'n' ? '\n' : c === 't' ? '\t' : '\\';
    });
  }

  function escapeBody(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  }

  /* 解析「一行一条」的配置文本 */
  function parseSnippets(text) {
    var out = [], seen = {};
    String(text == null ? '' : text).split('\n').forEach(function (line) {
      var raw = line.replace(/\s+$/, '');
      if (!raw || /^\s*#/.test(raw)) return;
      var i = raw.indexOf('=>');
      if (i < 0) return;
      var t = raw.slice(0, i).trim();
      var body = raw.slice(i + 2);
      if (body.charAt(0) === ' ') body = body.slice(1);
      if (!t || /\s/.test(t) || t.length > 32) return;
      var rec = { t: t, b: unescapeBody(body) };
      if (seen[t] != null) out[seen[t]] = rec;
      else { seen[t] = out.length; out.push(rec); }
    });
    return out;
  }

  function serialSnippets(list) {
    return (list || []).map(function (s) {
      return s.t + ' => ' + escapeBody(s.b);
    }).join('\n');
  }

  function findSnippet(list, trigger) {
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].t === trigger) return list[i];
    }
    return null;
  }

  /* 光标前那个「词」：允许字母数字下划线连字符与中文（输入法场景常见） */
  function wordBefore(text, pos) {
    var s = String(text == null ? '' : text).slice(0, pos);
    var m = /([A-Za-z0-9_\-]+|[\u4e00-\u9fff]{1,32})$/.exec(s);
    if (!m) return null;
    return { start: pos - m[1].length, word: m[1] };
  }

  /* 展开：返回 { text, caret, snippet } 或 null（不匹配就 null，调用方原样放行） */
  function expand(text, pos, list) {
    var w = wordBefore(text, pos);
    if (!w) return null;
    var sn = findSnippet(list, w.word);
    if (!sn) return null;
    var body = sn.b;
    var at = body.indexOf(CURSOR);
    if (at >= 0) body = body.slice(0, at) + body.slice(at + CURSOR.length);
    var head = String(text).slice(0, w.start) + body;
    var caret = at >= 0 ? w.start + at : head.length;
    return { text: head + String(text).slice(pos), caret: caret, snippet: sn };
  }

  return {
    parseSnippets: parseSnippets,
    serialSnippets: serialSnippets,
    findSnippet: findSnippet,
    wordBefore: wordBefore,
    expand: expand,
    unescapeBody: unescapeBody,
    escapeBody: escapeBody
  };
});
