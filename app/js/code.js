/* ============================================================
 * code.js — 代码块 Code Tools / 自动缩进
 *
 * 定位：把「操作一段代码文本」的全部逻辑收成纯函数，
 * 让 Node 单测能直接打；只有右键菜单与 DOM 集成那一层碰 document。
 *
 * —— 为什么这么切 ——
 * Code Tools 是代码块右键里的一小撮：复制 / 复制为 HTML /
 * 自动缩进整理 / 注释 / 移动行。语言切换已经有右上角下拉了，不重复做。
 *
 * autoIndent 不是 parser。真 parser 要按语言各写一套且体积失控，这里用
 * 「括号深度 + 起手收尾」的通用算法：brace 系按净增量算 depth，缩进驱动
 * 系（Python / YAML）只做规范化不清结构。字符串与注释里的字符先抹平成
 * 空格再数括号 —— `"a{b"` 不该抬 depth，这是同类实现最常踩的坑。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Code = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var UNIT = '  ';            // 缩进单位：两个空格
  var PY_UNIT = '    ';       // Python 用四个空格

  /* 语言 → 行注释符。块注释语言（html/css）不参与单行注释切换。 */
  var LINE_CM = {
    bash: '#', shell: '#', sh: '#', zsh: '#', ruby: '#', python: '#',
    r: '#', yaml: '#', toml: '#', perl: '#', makefile: '#',
    c: '//', cpp: '//', csharp: '//', objectivec: '//', java: '//',
    javascript: '//', jsx: '//', typescript: '//', tsx: '//', go: '//',
    rust: '//', swift: '//', kotlin: '//', php: '//', scala: '//',
    sql: '--', lua: '--', haskell: '--', latex: '%', matlab: '%',
    mermaid: '%%', flow: '//'
  };

  /* 缩进驱动的语言：autoIndent 只规范化，不重算结构 */
  var INDENT_DRIVEN = { python: 1, yaml: 1, toml: 0 };

  function langAliases(lang) {
    var n = String(lang || '').toLowerCase();
    if (n === 'js') n = 'javascript';
    if (n === 'ts') n = 'typescript';
    if (n === 'py') n = 'python';
    if (n === 'sh' || n === 'zsh' || n === 'shell') n = 'bash';
    if (n === 'yml') n = 'yaml';
    if (n === 'c++') n = 'cpp';
    if (n === 'c#') n = 'csharp';
    return n;
  }

  function commentMark(lang) {
    var n = langAliases(lang);
    return Object.prototype.hasOwnProperty.call(LINE_CM, n) ? LINE_CM[n] : null;
  }

  function isIndentDriven(lang) {
    return !!INDENT_DRIVEN[langAliases(lang)];
  }

  /* --------------------------------------------------- 围栏拆分
   * raw 形如 "```javascript\ncode...\n```"。拆成三份，改完再 join 回去，
   * 保证围栏自身（含 ~~~ 与多余的反引号）一个字符都不动。 */
  function split(raw) {
    var lines = String(raw == null ? '' : raw).split('\n');
    var open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[0] || '');
    if (!open) return null;
    var fenceChars = open[2];
    var lang = open[3].trim().split(/\s+/)[0] || '';
    var closeRe = new RegExp('^\\s*' + (fenceChars[0] === '`' ? '`' : '~') + '{' + fenceChars.length + ',}\\s*$');
    var last = lines.length - 1;
    var hasClose = last > 0 && closeRe.test(lines[last]);
    var body = hasClose ? lines.slice(1, last) : lines.slice(1);
    return {
      fence: open[1] + open[2] + (lang ? lang : ''),
      lang: lang,
      closing: hasClose ? lines[last] : '',
      lines: body
    };
  }

  function join(sp) {
    if (!sp) return '';
    var out = [sp.fence].concat(sp.lines);
    out.push(sp.closing);
    return out.join('\n');
  }

  /* 改语言：只重写首行围栏，正文与闭合原样 */
  function setLang(raw, lang) {
    var sp = split(raw);
    if (!sp) return raw;
    sp.fence = sp.fence.replace(/^(\s*(?:`{3,}|~{3,})).*$/, function (all, f) {
      return f + (lang && lang !== 'text' ? lang : '');
    });
    sp.lang = lang || '';
    return join(sp);
  }

  /* --------------------------------------------------- 行操作 */

  /* 选区覆盖的行号区间 [from, to]（闭区间）。
   * pos = [start, end] 是 code 正文内的字符偏移。
   * 反向框选（start > end）自动归一。 */
  function selLines(code, start, end) {
    var lines = String(code == null ? '' : code).split('\n');
    if (start == null) start = 0;
    if (end == null) end = start;
    if (start > end) { var tp = start; start = end; end = tp; }
    var from = 0, off = 0, to = lines.length - 1;
    for (var i = 0; i < lines.length; i++) {
      var len = lines[i].length;
      if (off + len >= start) { from = i; break; }
      off += len + 1;
    }
    off = 0;
    for (var j = 0; j < lines.length; j++) {
      var l2 = lines[j].length;
      if (off + l2 >= end) { to = j; break; }
      off += l2 + 1;
    }
    return { lines: lines, from: from, to: to };
  }

  /* Indent / outdent 选中行。空白整行动不动（行衣着差别弄脏 diff）。
   * unit 默认两个空格。 */
  function shift(code, start, end, dir, unit) {
    var u = unit == null ? UNIT : unit;
    var seg = selLines(code, start, end);
    var lines = seg.lines;
    var out = lines.map(function (ln, k) {
      if (k < seg.from || k > seg.to) return ln;
      if (!ln.trim()) return ln;
      if (dir < 0) {
        var m = /^[ \t]+/.exec(ln);
        if (!m) return ln;
        var ws = m[0];
        // Tab 里混了空格就说不清层级了，直接整段剥掉
        if (ws.indexOf('\t') >= 0) return ws.indexOf(' ') >= 0 ? ln.replace(/^[ \t]+/, '') : ln.slice(1);
        return ln.slice(Math.min(u.length, ws.length));
      }
      return u + ln;
    });
    return out.join('\n');
  }

  function indent(code, start, end, unit) { return shift(code, start, end, 1, unit); }
  function outdent(code, start, end, unit) { return shift(code, start, end, -1, unit); }

  /* --------------------------------------------------- 行注释切换
   * 规则：区间内**全都是**注释行 → 全部反注释；否则 → 全部加注释。
   * 缩进保持不变，注释符插在第一个非空白字符前。 */
  function toggleComment(code, start, end, lang) {
    var cm = commentMark(lang);
    if (!cm) return code;
    var seg = selLines(code, start, end);
    var lines = seg.lines;
    var picked = [], allCmt = true;
    for (var k = seg.from; k <= seg.to; k++) {
      picked.push(k);
      if (lines[k].trim() && lines[k].trim().indexOf(cm) !== 0) allCmt = false;
    }
    var out = lines.slice();
    picked.forEach(function (k) {
      var ln = lines[k];
      if (allCmt) {
        out[k] = ln.replace(new RegExp('^(\\s*)' + cm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?'), '$1');
      } else {
        if (!ln.trim()) return;
        var m = /^\s*/.exec(ln)[0];
        out[k] = m + cm + ' ' + ln.slice(m.length);
      }
    });
    return out.join('\n');
  }

  /* --------------------------------------------------- 上下移行 */
  function moveLine(code, lineIdx, dir) {
    var lines = String(code == null ? '' : code).split('\n');
    var j = lineIdx + (dir < 0 ? -1 : 1);
    if (lineIdx < 0 || lineIdx >= lines.length || j < 0 || j >= lines.length) return code;
    var tmp = lines[lineIdx];
    lines[lineIdx] = lines[j];
    lines[j] = tmp;
    return lines.join('\n');
  }

  /* --------------------------------------------------- 自动缩进整理 */

  /* 把字符串与注释内容抹成等长空格，再数括号——
   * `"a{b"`、`// )` 这类都不该影响 depth。 */
  function stripNoise(line, lang) {
    var s = '', i = 0, quote = '', cm = null;
    var blockPair = (/^(c|cpp|csharp|java|javascript|jsx|typescript|tsx|go|rust|swift|kotlin|php|scala|objectivec|css|scss)$/.test(langAliases(lang)));
    while (i < line.length) {
      var c = line[i];
      if (quote) {
        if (c === '\\') { s += '  '; i += 2; continue; }
        if (c === quote) { quote = ''; s += c; i++; continue; }
        s += ' '; i++; continue;
      }
      if (cm === 'line') { s += ' '; i++; continue; }
      if (blockPair && line.slice(i, i + 2) === '/*') { cm = 'block'; s += '  '; i += 2; continue; }
      if (cm === 'block') {
        if (line.slice(i, i + 2) === '*/') { cm = null; s += '  '; i += 2; continue; }
        s += ' '; i++; continue;
      }
      var lc = commentMark(lang);
      if (lc && line.slice(i, i + lc.length) === lc) { cm = 'line'; s += Array(lc.length + 1).join(' '); i += lc.length; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; s += c; i++; continue; }
      s += c; i++;
    }
    return s;
  }

  function netBrackets(noise) {
    var d = 0;
    for (var i = 0; i < noise.length; i++) {
      var c = noise[i];
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') d--;
    }
    return d;
  }

  /* Python / YAML 之类：不动结构，只把缩进规范成 unit 的倍数。
   * Tab 先展开；原缩进格数除以单位格数得层级（向下取整），
   * 保证「相对深浅」不变 —— 这是缩进驱动语言唯一能安全做的事。 */
  function normalizeIndent(code, unit) {
    var u = unit || PY_UNIT;
    var n = u.length;
    var lines = String(code == null ? '' : code).split('\n');
    var levels = [];
    lines.forEach(function (ln) {
      if (!ln.trim()) { levels.push(null); return; }
      var ws = /^[ \t]+/.exec(ln);
      if (!ws) { levels.push(0); return; }
      var w = ws[0].replace(/\t/g, u);
      // 向上取整 + 至少一级：宁可多给半级，也不能把「比上一行深」弄平——
      // 缩进驱动的语言里，抹掉层级等于改语义
      levels.push(Math.max(1, Math.ceil(w.length / n)));
    });
    return lines.map(function (ln, k) {
      if (levels[k] == null) return ln;
      return Array(levels[k] + 1).join(u) + ln.replace(/^[ \t]+/, '');
    }).join('\n');
  }

  /* brace 语言：按括号深度重排缩进。
   *
   * 每行的处理顺序是「先算行首该排第几级，再算行尾要把 depth 改成多少」：
   *   - 行以闭合括号起头 → 本行排在上一级（`pad = depth-1`）
   *   - 行向导 depth = 行首级 + 本行净括号（把首字符抹掉再数，否则第一行
   *     的 `}` 会被算两遍）
   *
   * 这套规则同时覆盖了三种烦人写法：
   *   `} else {`   → 首是一个闭合（占齐上一级），剩余净 +1 → depth 不变
   *   `} while(x);`→ 剩余净 0 → depth 减一
   *   `);`（多行调用收尾）→ 同上
   */
  function reindentBrace(code, lang, unit) {
    var u = unit || UNIT;
    var lines = String(code == null ? '' : code).split('\n');
    var depth = 0, out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { out.push(''); continue; }
      var closedFirst = /^[}\])]/.test(t);
      var rowLevel = closedFirst ? Math.max(0, depth - 1) : depth;
      var pad = Array(rowLevel + 1).join(u);
      out.push(pad + t);
      // 抹掉首字符再数，闭合起头的 -1 已经体现在 rowLevel 上了
      var eff = closedFirst ? ' ' + t.slice(1) : t;
      depth = Math.max(0, rowLevel + netBrackets(stripNoise(eff, lang)));
    }
    return out.join('\n');
  }

  function autoIndent(code, lang, unit) {
    if (code == null) return '';
    if (!String(code).trim()) return code;
    if (isIndentDriven(lang)) {
      // Python 一个单位是四空格，YAML / TOML 是两个——用错单位会把
      // YAML 的层级整级压扁
      return normalizeIndent(code, unit || (langAliases(lang) === 'python' ? PY_UNIT : UNIT));
    }
    if (!/[{}()[\]]/.test(code)) return normalizeIndent(code, unit || UNIT);
    return reindentBrace(code, lang, unit || UNIT);
  }

  /* --------------------------------------------------- 导出为 HTML
   * 「复制为 HTML」要产出能直接贴进别的文档的片段，
   * 所以连 `<pre><code class="language-x">` 一起给。 */
  function toHtml(code, lang, highlighter) {
    var body = typeof highlighter === 'function' ? highlighter(code, lang) : escHtml(code);
    return '<pre><code class="language-' + escHtml(lang || 'text') + '">' + body + '</code></pre>';
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* --------------------------------------------------- 「复制为 Markdown」 */
  function toMarkdown(code, lang) {
    var fence = '```';
    // 正文里出现 ``` 就加长围栏，避免提前闭合
    var m = /(?:^|\n)(`{3,})/g, longest = 0, r;
    while ((r = m.exec(code))) longest = Math.max(longest, r[1].length);
    if (longest >= 3) fence = Array(longest + 2).join('`');
    return fence + (lang ? lang : '') + '\n' + code + '\n' + fence;
  }

  /* --------------------------------------------------- menu items
   * 纯数据：每项 `{ id, label, hint, off }`。菜单渲染与执行都在 UI 层，
   * 这里只摆好顺序 —— 单测能直接断言「某种语言下哪些项可用」。 */
  function menuItems(lang) {
    var cm = commentMark(lang);
    return [
      { id: 'copy', label: '复制代码', hint: '' },
      { id: 'html', label: '复制为 HTML', hint: '' },
      { id: 'md', label: '复制为 Markdown', hint: '' },
      { id: '—' },
      { id: 'reindent', label: '自动缩进整理', hint: '' },
      {
        id: 'comment', label: '切换行注释', hint: '⌘/',
        off: !cm, offWhy: cm ? '' : '这种语言没有行注释符'
      },
      { id: '—' },
      { id: 'up', label: '上移当前行', hint: '⌥↑' },
      { id: 'down', label: '下移当前行', hint: '⌥↓' },
      { id: '—' },
      { id: 'del', label: '删除代码块', hint: '', danger: true }
    ];
  }

  /* ============================================================ UI 层
   * 这一段才碰 document。Node 里 require 走不到（见文件末尾守卫），
   * 所以上面的纯函数始终可以在没有 DOM 的环境里被单测打。 */

  function d() { return typeof document !== 'undefined' ? document : null; }
  function root() { return typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null); }
  function $(id) { var dd = d(); return dd ? dd.getElementById(id) : null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(msg) {
    var R = root();
    try {
      if (R && R.UI && R.UI.toast) R.UI.toast(msg);
      else if (R && R.OpenTyporaUI && R.OpenTyporaUI.toast) R.OpenTyporaUI.toast(msg);
    } catch (e) {}
  }

  function copyText(txt) {
    var R = root();
    if (!R) return Promise.resolve(false);
    if (R.navigator && R.navigator.clipboard && R.navigator.clipboard.writeText) {
      return R.navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return false; });
    }
    var dd = d();
    if (!dd) return Promise.resolve(false);
    var ta = dd.createElement('textarea');
    ta.value = txt; dd.body.appendChild(ta); ta.select();
    var r = false;
    try { r = dd.execCommand('copy'); } catch (e) {}
    dd.body.removeChild(ta);
    return Promise.resolve(r);
  }

  /* 找出代码块正文在 raw 里的字符区间 [start, end) */
  function bodyRange(raw) {
    var sp = split(raw);
    if (!sp) return null;
    var start = sp.fence.length + 1;
    var end = raw.length - (sp.closing ? sp.closing.length + 1 : 0);
    if (end < start) end = start;
    return { start: start, end: end, sp: sp };
  }

  /* 渲染态：把鼠标落点换算成「第几行」。
   * caretRangeFromPoint 拿到的是 DOM 里的文本节点与偏移，这里先累加
   * 该节点之前的字符数，再数其中 `\n` 的个数。 */
  function pointToLine(blk, x, y) {
    var dd = d();
    var codeEl = blk ? blk.querySelector('.code-body pre code') : null;
    if (!codeEl || !dd || !dd.caretRangeFromPoint) return 0;
    var rng = dd.caretRangeFromPoint(x, y);
    if (!rng || !codeEl.contains(rng.startContainer)) return 0;
    var node = rng.startContainer, off = rng.startOffset;
    if (node.nodeType === 1) return 0;
    var acc = 0, hit = false;
    try {
      var w = dd.createTreeWalker(codeEl, 4 /* NodeFilter.SHOW_TEXT */, null, false);
      while (w.nextNode()) {
        if (w.currentNode === node) { acc += off; hit = true; break; }
        acc += w.currentNode.nodeValue.length;
      }
    } catch (e) { return 0; }
    if (!hit) return 0;
    var body = codeEl.textContent || '';
    acc = Math.min(acc, body.length);
    var line = 0;
    for (var k = 0; k < acc; k++) if (body[k] === '\n') line++;
    return line;
  }

  /* 行号 → 该行首在「正文」里的字符偏移 */
  function lineOffset(code, line) {
    var lines = String(code == null ? '' : code).split('\n');
    var n = Math.max(0, Math.min(line, lines.length - 1));
    var off = 0;
    for (var i = 0; i < n; i++) off += lines[i].length + 1;
    return off;
  }
  function lineEnd(code, line) {
    var lines = String(code == null ? '' : code).split('\n');
    var n = Math.max(0, Math.min(line, lines.length - 1));
    return lineOffset(code, n) + lines[n].length;
  }

  var MENU_EL = null;

  function closeMenu() {
    if (!MENU_EL) return;
    MENU_EL.classList.remove('show');
    MENU_EL.setAttribute('aria-hidden', 'true');
  }

  function showMenu(items, x, y, onPick) {
    closeMenu();
    MENU_EL = $('ctxmenu');
    if (!MENU_EL) return;
    var dd = d();
    MENU_EL.innerHTML = items.map(function (it, k) {
      if (it.id === '—') return '<div class="ctx-sep"></div>';
      var cls = 'ctx-item' + (it.danger ? ' danger' : '') + (it.off ? ' is-off' : '');
      return '<button class="' + cls + '" data-k="' + k + '"' + (it.off ? ' disabled' : '') +
        '><span>' + esc(it.label) + '</span>' +
        (it.hint ? '<span class="ctx-key">' + esc(it.hint) + '</span>' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(MENU_EL.querySelectorAll('.ctx-item'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var it = items[+el.getAttribute('data-k')];
        closeMenu();
        if (it && !it.off) onPick(it.id);
      });
      el.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    });
    MENU_EL.classList.add('show');
    MENU_EL.setAttribute('aria-hidden', 'false');
    var R = root();
    MENU_EL.style.left = Math.min(x, (R && R.innerWidth || 1200) - 230) + 'px';
    var h = MENU_EL.offsetHeight || 240;
    MENU_EL.style.top = Math.min(y, (R && R.innerHeight || 800) - h - 10) + 'px';
  }

  /* 执行一条 Code Tools 命令。ctx = { i, raw, body, lang, line } */
  function runCmd(ctx, id) {
    var R = root();
    var Ed = R && R.Editor;
    if (!Ed) return;
    var rg = bodyRange(ctx.raw);
    if (!rg) return;
    var code = ctx.body;
    var next = null;
    var start = -1, end = -1;

    if (id === 'copy') {
      copyText(code).then(function (okFlag) { toast(okFlag ? '已复制代码' : '复制失败'); });
      return;
    }
    if (id === 'html') {
      var hl = (R.MD && R.MD.highlight) || null;
      copyText(toHtml(code, ctx.lang, hl)).then(function (okFlag) { toast(okFlag ? '已复制为 HTML' : '复制失败'); });
      return;
    }
    if (id === 'md') {
      copyText(toMarkdown(code, ctx.lang)).then(function (okFlag) { toast(okFlag ? '已复制为 Markdown' : '复制失败'); });
      return;
    }
    if (id === 'reindent') {
      next = autoIndent(code, ctx.lang);
      if (next === code) { toast('缩进已经是规范的'); return; }
      start = rg.start; end = rg.end;
    } else if (id === 'comment') {
      var ls = lineOffset(code, ctx.line), le = lineEnd(code, ctx.line);
      next = toggleComment(code, ls, le, ctx.lang);
      start = rg.start; end = rg.end;
    } else if (id === 'up' || id === 'down') {
      next = moveLine(code, ctx.line, id === 'up' ? -1 : 1);
      if (next === code) { toast(id === 'up' ? '已经在第一行' : '已经在最后一行'); return; }
      start = rg.start; end = rg.end;
    } else if (id === 'del') {
      Ed.deleteBlock(ctx.i);
      return;
    }
    if (next == null || start < 0) return;
    Ed.replaceRawRangeKeepEdit(ctx.i, start, end, next);
  }

  /* 从 event.target 找到归属的代码块 */
  function owner(e) {
    var t = e.target;
    if (!t || !t.closest) return null;
    // 语言下拉和复制按钮有自己的行为，别抢
    if (t.closest('.code-lang-sel') || t.closest('.code-copy')) return null;
    var blk = t.closest('.blk.code');
    if (!blk) return null;
    if (!blk.querySelector('.code-body pre code')) return null;
    return blk;
  }

  function ctxOf(blk, x, y) {
    var R = root(), Ed = R && R.Editor;
    if (!Ed || !blk) return null;
    var i = +blk.getAttribute('data-i');
    var raw = Ed.getRaw(i) || '';
    var rg = bodyRange(raw);
    if (!rg) return null;
    return {
      i: i,
      raw: raw,
      body: raw.slice(rg.start, rg.end),
      lang: rg.sp.lang,
      line: pointToLine(blk, x, y)
    };
  }

  /* 编辑态 / 渲染态通用的快捷键：⌘/ 注释、⌥↑⌥↓ 移动行 */
  function keyLine() {
    var R = root(), Ed = R && R.Editor;
    if (!Ed) return null;
    var st = Ed.getState ? Ed.getState() : null;
    if (!st || st.editing < 0) return null;
    var raw = Ed.getRaw(st.editing) || '';
    var b = st.model && st.model.blocks[st.editing];
    if (!b || b.type !== 'code') return null;
    var rg = bodyRange(raw);
    if (!rg) return null;
    var dd = d();
    var ta = dd ? dd.querySelector('#editor textarea.src') : null;
    var pos = ta && ta.selectionStart != null ? ta.selectionStart : 0;
    var bodyOff = Math.max(0, pos - rg.start);
    var body = raw.slice(rg.start, rg.end);
    var line = 0;
    for (var k = 0; k < Math.min(bodyOff, body.length); k++) if (body[k] === '\n') line++;
    return { i: st.editing, raw: raw, lang: rg.sp.lang, line: line, start: rg.start, end: rg.end, body: body };
  }

  /* 抢下这两个键时必须连 stopPropagation 一起叫，光 preventDefault 不够：
   * ui.js 在 document 冒泡阶段还挂着 ⌘/ = 切换源码模式，会和「切换行注释」
   * 同时触发（表现为注释完立刻被踢出编辑态、整篇跳进源码视图）。
   * 这里是 document 捕获阶段，stopPropagation 能同时挡住 textarea 自身
   * 的 keydown 与冒泡链路。 */
  function handleKey(e) {
    var R = root();
    var meta = e.metaKey || e.ctrlKey;
    var c = keyLine();
    if (!c) return false;
    // ⌘/：切换行注释
    if (meta && e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      var nx = toggleComment(c.body, lineOffset(c.body, c.line), lineEnd(c.body, c.line), c.lang);
      R.Editor.replaceRawRangeKeepEdit(c.i, c.start, c.end, nx);
      return true;
    }
    // ⌥↑ / ⌥↓：移动当前行
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      var mv = moveLine(c.body, c.line, e.key === 'ArrowUp' ? -1 : 1);
      if (mv === c.body) { toast(e.key === 'ArrowUp' ? '已经在第一行' : '已经在最后一行'); return true; }
      R.Editor.replaceRawRangeKeepEdit(c.i, c.start, c.end, mv);
      return true;
    }
    return false;
  }

  function attach(el) {
    var dd = d();
    if (!dd || !el) return;
    el.addEventListener('contextmenu', function (e) {
      var blk = owner(e);
      if (!blk) return;
      e.preventDefault();
      e.stopPropagation();
      var ctx = ctxOf(blk, e.clientX, e.clientY);
      if (!ctx) return;
      showMenu(menuItems(ctx.lang), e.clientX, e.clientY, function (id) { runCmd(ctx, id); });
    });

    dd.addEventListener('mousedown', function (e) {
      if (MENU_EL && MENU_EL.classList.contains('show') && !MENU_EL.contains(e.target)) closeMenu();
    }, true);
    dd.addEventListener('keydown', function (e) {
      if (MENU_EL && MENU_EL.classList.contains('show') && e.key === 'Escape') { closeMenu(); e.stopPropagation(); }
      if (MENU_EL && MENU_EL.classList.contains('show')) return;
      handleKey(e);
    }, true);
    var R = root();
    if (R) R.addEventListener('scroll', closeMenu, true);
  }

  // 页面里自动挂载；Node（单测 require）下没有 document，直接跳过
  if (typeof document !== 'undefined') {
    var boot = function () {
      var el = document.getElementById('editor');
      if (el) attach(el);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return {
    UNIT: UNIT,
    PY_UNIT: PY_UNIT,
    LINE_CM: LINE_CM,
    INDENT_DRIVEN: INDENT_DRIVEN,
    menuItems: menuItems,
    attach: attach,
    closeMenu: closeMenu,
    showMenu: showMenu,
    runCmd: runCmd,
    ctxOf: ctxOf,
    bodyRange: bodyRange,
    pointToLine: pointToLine,
    lineOffset: lineOffset,
    lineEnd: lineEnd,
    handleKey: handleKey,
    langAliases: langAliases,
    commentMark: commentMark,
    isIndentDriven: isIndentDriven,
    split: split,
    join: join,
    setLang: setLang,
    selLines: selLines,
    shift: shift,
    indent: indent,
    outdent: outdent,
    toggleComment: toggleComment,
    moveLine: moveLine,
    stripNoise: stripNoise,
    netBrackets: netBrackets,
    normalizeIndent: normalizeIndent,
    reindentBrace: reindentBrace,
    autoIndent: autoIndent,
    toHtml: toHtml,
    toMarkdown: toMarkdown,
    escHtml: escHtml
  };
});
