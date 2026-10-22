/* ============================================================
 * typography.js — 版式的三个旋钮：字体 / 行距 / 背景
 *
 * 纯函数层，不碰 DOM：偏好值 → CSS 变量表。上层（ui.js 的 applyPrefs、
 * export.js 的 htmlDoc）只负责把这张表写进 style。
 *
 * 约定：变量值是空串表示「清掉这条自定义、回到主题默认」。
 * 桌面应用里就是 root.style.removeProperty(...)，导出时就是压根不写。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Typo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* app.css 里 body 的默认行高。改这里必须同步改 app.css —— 有测试盯着。 */
  var DEFAULT_LEADING = 1.72;
  var MIN_LEADING = 1.3;
  var MAX_LEADING = 2.4;

  /* 字体预设：只列本机能查到的（用 NSFont(name:) 逐个验过）。
   * stack 里一律用单引号 —— 导出的 HTML 把这张表写进 style="…" 属性，
   * 单引号不用转义，双引号会把属性截断。
   * system 的 stack 是空串：表示不覆盖，让 app.css 的 --font-body 生效。 */
  var FONTS = [
    { id: 'system', label: '系统默认', stack: '' },
    { id: 'pingfang', label: '苹方', stack: "'PingFang SC', -apple-system, 'Helvetica Neue', sans-serif" },
    { id: 'songti', label: '宋体', stack: "'Songti SC', 'STSong', 'SimSun', 'Source Han Serif SC', serif" },
    { id: 'kaiti', label: '楷体', stack: "'Kaiti SC', 'STKaiti', 'KaiTi', serif" },
    { id: 'fangsong', label: '仿宋', stack: "'STFangsong', 'FangSong', 'Songti SC', serif" },
    { id: 'yuanti', label: '圆体', stack: "'Yuanti SC', 'Hiragino Sans GB', 'PingFang SC', sans-serif" },
    { id: 'mono', label: '等宽', stack: "ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, monospace" },
    { id: 'custom', label: '自定义…', stack: '' }
  ];

  var CUSTOM_PREFIX = 'custom:';
  var MAX_STACK = 160;

  function fontById(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return null;
  }

  /* 自定义字体族：清掉能逃出属性/规则边界的字符，双引号统一成单引号，
   * 折叠空白、限长。清完是空的就等于没填。 */
  function cleanStack(raw) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/[;{}<>]/g, '').replace(/"/g, "'");
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > MAX_STACK) s = s.slice(0, MAX_STACK).trim();
    return s;
  }

  /* 偏好值 → { id, stack, custom }
   * 认三种写法：'' / 'songti'（预设 id）/ 'custom:<字体族>'。
   * 'custom:' 后面是空的也认作「自定义」—— UI 上刚选中还没填字时就是这个状态，
   * 此时 stack 为空，等于不覆盖、渲染回落系统默认。认不出来的整串一律回落系统默认。 */
  function pickFont(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { id: 'system', stack: '', custom: false };
    if (s.indexOf(CUSTOM_PREFIX) === 0) {
      var stack = cleanStack(s.slice(CUSTOM_PREFIX.length));
      return { id: 'custom', stack: stack, custom: !!stack };
    }
    var f = fontById(s);
    if (f && f.id === 'custom') return { id: 'custom', stack: '', custom: false };
    if (f && f.stack) return { id: f.id, stack: f.stack, custom: false };
    return { id: 'system', stack: '', custom: false };
  }

  /* 行距：非法值回落默认，超界夹住，两位小数 */
  function normLeading(v) {
    var n = Number(v);
    if (v === '' || v == null || !isFinite(n)) return DEFAULT_LEADING;
    if (n < MIN_LEADING) n = MIN_LEADING;
    if (n > MAX_LEADING) n = MAX_LEADING;
    return Math.round(n * 100) / 100;
  }

  /* 标题行高 = 原值 × 这个比例。默认 1，所以不设行距时排版与之前逐像素相同 */
  function lhScale(leading) {
    return Math.round(normLeading(leading) / DEFAULT_LEADING * 10000) / 10000;
  }

  /* 背景：'' / 'theme' / 'none' 都当「跟随主题」；#abc / abc / #aabbcc 归一化 */
  function normBg(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s || s === 'theme' || s === 'none' || s === 'default') return '';
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s)) {
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (!/^[0-9a-f]{6}$/.test(s)) return '';
    return '#' + s;
  }

  /* 偏好 → [[变量名, 值], …]，值空串表示清除 */
  function vars(o) {
    o = o || {};
    var f = pickFont(o.font);
    var L = normLeading(o.leading);
    return [
      ['--font-body', f.stack],
      ['--leading', String(L)],
      ['--lh-scale', String(lhScale(L))],
      ['--bg', normBg(o.bg)]
    ];
  }

  /* 偏好 → 导出的行内 style 片段。默认值不写，导出的 HTML 才不会平白多一坨；
   * 只有真的调过才带上，这样「所见即导出」的同时默认文档保持干净。 */
  function styleOf(o) {
    o = o || {};
    var f = pickFont(o.font);
    var L = normLeading(o.leading);
    var bg = normBg(o.bg);
    var out = [];
    if (f.stack) out.push('--font-body:' + f.stack);
    if (L !== DEFAULT_LEADING) {
      out.push('--leading:' + L);
      out.push('--lh-scale:' + lhScale(L));
    }
    if (bg) out.push('--bg:' + bg);
    return out.join(';');
  }

  return {
    FONTS: FONTS,
    DEFAULT_LEADING: DEFAULT_LEADING,
    MIN_LEADING: MIN_LEADING,
    MAX_LEADING: MAX_LEADING,
    CUSTOM_PREFIX: CUSTOM_PREFIX,
    fontById: fontById,
    cleanStack: cleanStack,
    pickFont: pickFont,
    normLeading: normLeading,
    lhScale: lhScale,
    normBg: normBg,
    vars: vars,
    styleOf: styleOf
  };
});
