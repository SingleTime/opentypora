/* ============================================================
 * inline.js — 行内 token 化（导出用，不依赖 DOM）
 * md.js 的 renderInline 输出的是 HTML 片段；docx / LaTeX 需要
 * 的是「结构化 run」，套 HTML 再反解会丢掉公式原文。所以这里
 * 按与 md.js 完全相同的规则重新产一遍 token 流，供 docx 映射成
 * w:r、供 LaTeX 映射成 \textbf{} 之类。
 *
 * token 形状：
 *   {t:'text',  v}
 *   {t:'code',  v}
 *   {t:'math',  v}                 行内公式原文（不含 $）
 *   {t:'br'}
 *   {t:'img',   src, alt, title, w, h}   w/h 是 =300x200 里的像素尺寸（缺省 0）
 *   {t:'fn',    id}                脚注引用
 *   {t:'wiki',  target, label, kids}  wiki 链接（导出时按普通文字处理）
 *   {t:'strong'|'em'|'del'|'mark', kids:[token]}
 *   {t:'link',  href, kids:[token]}
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Inline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ESCAPABLE = /[\\`*_{}\[\]()#+\-.!~>|=<$%]/;

  /* 引用式链接定义表：导出前由 build() 用 MD.scanLinkDefs 灌进来 */
  var DEFS = {};
  function setDefs(map) { DEFS = map || {}; }
  function scanDefs(src) {
    var defs = {}, re = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'))?[ \t]*$/;
    String(src == null ? '' : src).split('\n').forEach(function (line) {
      var m = re.exec(line);
      if (!m) return;
      defs[m[1].trim().toLowerCase()] = { href: m[2], title: m[3] || m[4] || '' };
    });
    return defs;
  }

  /* 与 md.js 共用同一张表（浏览器里 md.js 先加载；Node 里直接 require） */
  var MDREF = (typeof MD !== 'undefined' && MD) ? MD : null;
  if (!MDREF && typeof require === 'function') {
    try { MDREF = require('./md.js'); } catch (e) { MDREF = null; }
  }
  var EMOJI = MDREF ? MDREF.EMOJI : null;
  function emojiOf(code) {
    if (!EMOJI) return '';
    return EMOJI[String(code).toLowerCase()] || '';
  }

  /* 严格模式跟着 md.js 走：导出器（docx/odt/textfmt）用同一套 tokenize，
   * 不能让「预览里是字面 ==x==、Word 里变成高亮」这种不一致发生。 */
  function strictMode() {
    try {
      if (MDREF && MDREF.isStrict) return !!MDREF.isStrict();
    } catch (e) {}
    return false;
  }

  /* 裸 URL：与 md.js 的 readBareUrl 同规则（尾部标点、右括号成对） */
  function readBareUrl(str, i) {
    var prev = i > 0 ? str[i - 1] : '';
    if (prev && /[A-Za-z0-9@._\-\/&]/.test(prev)) return null;
    var m = /^(https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+)/i.exec(str.slice(i));
    var text = '', href = '';
    if (m) { text = m[1]; href = m[1]; }
    else {
      var w = /^www\.[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+/i.exec(str.slice(i));
      if (!w || !/^www\.[^.\s/]+\.[a-z]{2,}/i.test(w[0])) return null;
      text = w[0]; href = 'http://' + text;
    }
    var t = text;
    for (; t.length;) {
      var last = t[t.length - 1];
      if (/[.,;:!?'"”’]/.test(last)) { t = t.slice(0, -1); continue; }
      if (last === ')') {
        var open = (t.match(/\(/g) || []).length, close = (t.match(/\)/g) || []).length;
        if (close > open) { t = t.slice(0, -1); continue; }
      }
      break;
    }
    if (!t || /^https?:\/\/$/.test(t)) return null;
    if (/^https?:\/\/$/.test(href)) href = t;
    return { raw: t, href: href };
  }

  /* 图片：与 md.js 的 readImage 同一套规则（含 =WxH 尺寸、<带空格路径>、title） */
  function readImage(str, i) {
    if (str[i] !== '!' || str[i + 1] !== '[') return null;
    var k = str.indexOf(']', i + 2);
    if (k < 0 || str[k + 1] !== '(') return null;
    var alt = str.slice(i + 2, k);
    var j = k + 2, depth = 1, buf = '';
    for (; j < str.length; j++) {
      var ch = str[j];
      if (ch === '\\' && j + 1 < str.length) { buf += ch + str[j + 1]; j++; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (!depth) break; }
      buf += ch;
    }
    if (depth !== 0) return null;

    var inner = buf.trim(), path = '', title = '', w = 0, h = 0;
    if (inner[0] === '<') {
      var gt = inner.indexOf('>');
      if (gt < 0) return null;
      path = inner.slice(1, gt);
      inner = inner.slice(gt + 1).trim();
    } else {
      var sp = inner.search(/\s/);
      if (sp < 0) { path = inner; inner = ''; }
      else { path = inner.slice(0, sp); inner = inner.slice(sp).trim(); }
    }
    if (!path) return null;

    var tm = /^(["'])([\s\S]*?)\1/.exec(inner);
    if (tm) { title = tm[2]; inner = inner.slice(tm[0].length).trim(); }

    var sm = /^=\s*(\d*)\s*[xX]\s*(\d*)\s*$/.exec(inner);
    if (sm) {
      w = parseInt(sm[1] || '0', 10) || 0;
      h = parseInt(sm[2] || '0', 10) || 0;
    } else {
      var sw = /^=\s*(\d+)\s*$/.exec(inner);
      if (sw) w = parseInt(sw[1], 10) || 0;
    }

    return { raw: str.slice(i, j + 1), alt: alt, src: path, title: title, w: w, h: h };
  }

  /* wiki 链接：与 md.js 的 readWiki 同一套规则（[[目标]] / [[目标|文字]] / [[#锚点]]） */
  function readWiki(str, i) {
    if (str[i] !== '[' || str[i + 1] !== '[') return null;
    var j = i + 2, buf = '';
    for (; j < str.length; j++) {
      var ch = str[j];
      if (ch === '\\' && j + 1 < str.length) { buf += ch + str[j + 1]; j++; continue; }
      if (ch === '\n') return null;
      if (ch === ']' && str[j + 1] === ']') break;
      buf += ch;
    }
    if (j >= str.length || !buf.trim()) return null;

    var cut = -1;
    for (var k = 0; k < buf.length; k++) {
      if (buf[k] === '|' && buf[k - 1] !== '\\') { cut = k; break; }
    }
    var tRaw = cut < 0 ? buf : buf.slice(0, cut);
    var lRaw = cut < 0 ? buf : buf.slice(cut + 1);
    var target = tRaw.replace(/\\\|/g, '|').trim();
    var label = lRaw.replace(/\\\|/g, '|').trim();
    if (!target) return null;
    if (!label) label = target;
    if (target.charAt(0) === '#' && cut < 0) label = target.slice(1);
    return { raw: str.slice(i, j + 2), target: target, label: label };
  }

  function tokenize(src) {
    src = String(src == null ? '' : src);
    var out = [], buf = '';
    var i = 0;

    function flush() { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } }
    function push(tok) { flush(); out.push(tok); }

    while (i < src.length) {
      var c = src[i];

      // 反斜杠转义
      if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
        buf += src[i + 1]; i += 2; continue;
      }
      // 行内代码
      if (c === '`') {
        var m = /^(`+)([\s\S]*?)\1/.exec(src.slice(i));
        if (m) {
          push({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') });
          i += m[0].length; continue;
        }
      }
      // 图片（支持 =WxH 尺寸写法）
      if (c === '!' && src[i + 1] === '[') {
        var im = readImage(src, i);
        if (im) {
          push({ t: 'img', src: im.src, alt: im.alt, title: im.title, w: im.w, h: im.h });
          i += im.raw.length; continue;
        }
        var rim = /^!\[([^\]]*)\]\[([^\]]*)\]/.exec(src.slice(i));
        if (rim) {
          var rid = (rim[2] || rim[1]).trim().toLowerCase();
          if (DEFS[rid]) {
            push({ t: 'img', src: DEFS[rid].href, alt: rim[1], title: DEFS[rid].title || '', w: 0, h: 0 });
            i += rim[0].length; continue;
          }
        }
      }
      // wiki 链接 [[目标|显示文字]]（排在脚注与普通链接之前；严格模式退成字面量）
      if (!strictMode() && c === '[' && src[i + 1] === '[') {
        var wk = readWiki(src, i);
        if (wk) {
          push({ t: 'wiki', target: wk.target, label: wk.label, kids: tokenize(wk.label) });
          i += wk.raw.length; continue;
        }
      }
      // 脚注引用（必须排在普通链接前）
      if (c === '[' && src[i + 1] === '^') {
        var fnm = /^\[\^([^\]\s]+)\]/.exec(src.slice(i));
        if (fnm) { push({ t: 'fn', id: fnm[1] }); i += fnm[0].length; continue; }
      }
      // 链接
      if (c === '[') {
        var lm = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src.slice(i));
        if (lm) {
          push({ t: 'link', href: lm[2], title: lm[3] || '', kids: tokenize(lm[1]) });
          i += lm[0].length; continue;
        }
        // 引用式链接
        var rl = /^\[([^\]]*)\](?:\[([^\]]*)\])?/.exec(src.slice(i));
        if (rl) {
          var lid = (rl[2] == null || rl[2] === '' ? rl[1] : rl[2]).trim().toLowerCase();
          var ld = lid ? DEFS[lid] : null;
          if (ld) {
            push({ t: 'link', href: ld.href, title: ld.title || '', kids: tokenize(rl[1]) });
            i += rl[0].length; continue;
          }
        }
      }
      // 自动链接
      if (c === '<') {
        var am = /^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/.exec(src.slice(i));
        if (am) {
          push({ t: 'link', href: am[1], title: '', kids: [{ t: 'text', v: am[1] }] });
          i += am[0].length; continue;
        }
        // 行内 HTML：上/下标、下划线换算成结构化 token；其余标签只丢壳
        var hm = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*?)?)(\/?)>/.exec(src.slice(i));
        if (hm) {
          var name = hm[2].toLowerCase();
          if (hm[1]) { i += hm[0].length; continue; }
          if (name === 'br' || name === 'wbr') { push({ t: 'br' }); i += hm[0].length; continue; }
          if (name === 'sup' || name === 'sub' || name === 'u' || name === 'ins' || name === 'mark') {
            var closeRe = new RegExp('</' + name + '\\s*>', 'i');
            var cm = closeRe.exec(src.slice(i + hm[0].length));
            if (cm) {
              var kids = tokenize(src.slice(i + hm[0].length, i + hm[0].length + cm.index));
              push({ t: name === 'ins' ? 'u' : name, kids: kids });
              i += hm[0].length + cm.index + cm[0].length; continue;
            }
          }
          i += hm[0].length; continue;   // 其它标签：只丢壳，内容继续解析
        }
      }
      // 行内公式
      if (c === '$' && src[i + 1] !== '$') {
        var mm = /^\$([^$\n]+?)\$/.exec(src.slice(i));
        if (mm) { push({ t: 'math', v: mm[1] }); i += mm[0].length; continue; }
      }
      // 强调族
      var em2 = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(src.slice(i));
      if (em2) { push({ t: 'strong', kids: tokenize(em2[2]) }); i += em2[0].length; continue; }

      var st2 = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src.slice(i));
      if (st2) { push({ t: 'del', kids: tokenize(st2[1]) }); i += st2[0].length; continue; }

      var mk2 = strictMode() ? null : /^==(?=\S)([\s\S]*?\S)==/.exec(src.slice(i));
      if (mk2) { push({ t: 'mark', kids: tokenize(mk2[1]) }); i += mk2[0].length; continue; }

      var em1 = /^(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1/.exec(src.slice(i));
      if (em1) { push({ t: 'em', kids: tokenize(em1[2]) }); i += em1[0].length; continue; }

      // 上标 / 下标
      if (!strictMode() && c === '^') {
        var supm = /^\^(?=\S)([^\s^]+?)\^(?!\^)/.exec(src.slice(i));
        if (supm) { push({ t: 'sup', kids: tokenize(supm[1]) }); i += supm[0].length; continue; }
      }
      if (!strictMode() && c === '~' && src[i + 1] !== '~') {
        var subm = /^~(?=\S)([^\s~]+?)~(?![~])/.exec(src.slice(i));
        if (subm) { push({ t: 'sub', kids: tokenize(subm[1]) }); i += subm[0].length; continue; }
      }
      // Emoji shortcode
      if (!strictMode() && c === ':') {
        var emo = /^:([a-zA-Z0-9_+\-]+):/.exec(src.slice(i));
        if (emo) {
          var ch = emojiOf(emo[1]);
          if (ch) { buf += ch; i += emo[0].length; continue; }
        }
      }
      // 裸 URL
      if (c === 'h' || c === 'H' || c === 'w' || c === 'W') {
        var bu = readBareUrl(src, i);
        if (bu) {
          push({ t: 'link', href: bu.href, title: '', kids: [{ t: 'text', v: bu.raw }] });
          i += bu.raw.length; continue;
        }
      }

      // 硬换行（行尾两空格 + 换行）
      if (c === '\n') {
        if (/ {2,}$/.test(src.slice(0, i))) {
          buf = buf.replace(/ +$/, '');
          push({ t: 'br' });
          i += 1; continue;
        }
        buf += '\n'; i += 1; continue;
      }

      buf += c; i += 1;
    }
    flush();
    return out;
  }

  /* 纯文本（用于 alt 文本、docProps、LaTeX 单行标题） */
  function plain(tokens) {
    return (tokens || []).map(function (t) {
      switch (t.t) {
        case 'text': case 'code': case 'math': return t.v;
        case 'br': return '\n';
        case 'img': return t.alt || '';
        case 'fn': return '';
        case 'wiki': return t.label || t.target;
        case 'link': case 'strong': case 'em': case 'del': case 'mark':
        case 'sup': case 'sub': case 'u': return plain(t.kids);
        default: return '';
      }
    }).join('');
  }

  return { tokenize: tokenize, plain: plain, setDefs: setDefs, scanDefs: scanDefs };
});
