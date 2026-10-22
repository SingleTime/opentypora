/* 导出主题的渲染验证：把真实导出的单页 HTML 塞进 srcdoc iframe，量计算样式与滚动。
 *
 * 为什么用 iframe：导出文件是独立文档，只有真的按文档渲染（data-theme 生效、
 * app.css 摘掉外壳 overflow:hidden）才算数。srcdoc 与父页同源，能读计算样式。
 * 样式注入的位置/顺序由 htmltheme 的 Swift 断言保证，这里只关心渲染结果。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__htmltheme_harness.html');
const Export = require(path.join(ROOT, 'app', 'js', 'export.js'));
const MD = require(path.join(ROOT, 'app', 'js', 'md.js'));
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');

/* ---------- 从 app.css 里读某个主题的变量，算成浏览器会给的 rgb() ---------- */
function themeVars(id) {
  const m = new RegExp('html\\[data-theme="' + id + '"\\]\\s*\\{([\\s\\S]*?)\\}').exec(CSS);
  const vars = {};
  if (m) [...m[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)].forEach(x => { vars[x[1]] = x[2].trim(); });
  return vars;
}
function rgbOf(v) {
  if (!v) return null;
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const h = m[1];
    return 'rgb(' + parseInt(h[0] + h[0], 16) + ', ' + parseInt(h[1] + h[1], 16) + ', ' +
      parseInt(h[2] + h[2], 16) + ')';
  }
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1];
    return 'rgb(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' +
      parseInt(h.slice(4, 6), 16) + ')';
  }
  return String(v).trim();
}

/* ---------- 文档：长到必须滚动，且含标题/表格/代码块 ---------- */
const LINES = ['# 导出主题验证', '', '这一行用来验证 `app.css` 的正文排版确实生效，**粗体** 与 [链接](https://example.com) 都在。', ''];
for (let i = 1; i <= 24; i++) {
  LINES.push('## 第 ' + i + ' 段', '');
  LINES.push('正文内容占位，用来把文档撑到超过一屏。第 ' + i + ' 段的文字重复几次以便产生足够的行数。', '');
}
LINES.push('```js', 'var a = 1;', '```', '', '| 列 | 值 |', '|----|----|', '| a | 1 |', '');
const DOC = LINES.join('\n');
const BODY = MD.renderDocument(DOC);

/* ---------- 注入方式与 native/webexport.swift 保持一致（位置/顺序有 Swift 断言兜底） ---------- */
function withStyles(html, css, themeCss) {
  let style = '';
  if (css && css.trim()) style += '<style>\n' + css + '\n</style>\n';
  if (themeCss && themeCss.trim()) style += '<style id="opentypora-theme">\n' + themeCss + '\n</style>\n';
  if (!style) return html;
  return html.replace(/<\/head>(?![\s\S]*<\/head>)/, style + '</head>');
}
/* ui.js tweakUserCss 的等价物：用户主题的 :root / html 抬到 html[data-theme] */
function tweak(css) {
  return String(css || '')
    .replace(/(^|\})\s*:root\s*(?=[,{])/g, '$1 html[data-theme]')
    .replace(/(^|\})\s*html\s*(?=[,{])/g, '$1 html[data-theme]');
}

const CUSTOM_BG = '#123456';
const CASES = {
  github: {
    html: withStyles(Export.htmlDoc(BODY, { theme: 'github', title: 'GitHub' }), CSS, ''),
    theme: 'github',
    bg: rgbOf(themeVars('github').bg), text: rgbOf(themeVars('github').text)
  },
  night: {
    html: withStyles(Export.htmlDoc(BODY, { theme: 'night', title: 'Night' }), CSS, ''),
    theme: 'night',
    bg: rgbOf(themeVars('night').bg), text: rgbOf(themeVars('night').text)
  },
  custom: {
    html: withStyles(Export.htmlDoc(BODY, { theme: 'whitey', title: 'Custom' }), CSS,
      tweak(':root{--bg:' + CUSTOM_BG + ';--text:#ffffff}')),
    theme: 'whitey',
    bg: rgbOf(CUSTOM_BG), text: 'rgb(255, 255, 255)'
  },
  plain: {
    // 无样式导出：不该注入任何 CSS，主题选择在这条路上没有作用
    html: Export.htmlDoc(BODY, { theme: 'night', title: 'Plain' }),
    theme: 'night',
    bg: 'rgba(0, 0, 0, 0)', text: 'rgb(0, 0, 0)', plain: true
  }
};

const PAYLOAD = JSON.stringify(CASES).replace(/<\//g, '<\\/');

const TEST = String.raw`
var R = [];
function ok(name, cond, extra) {
  R.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
}
function load(id, html) {
  return new Promise(function (res) {
    var f = document.getElementById(id);
    f.onload = function () { setTimeout(function () { res(f); }, 260); };
    f.srcdoc = html;
  });
}
function lum(rgb) {
  var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return -1;
  return (+m[1] * 299 + +m[2] * 587 + +m[3] * 114) / 1000;
}
function probe(f) {
  var d = f.contentDocument, w = f.contentWindow;
  var cs = getComputedStyle(d.body);
  var out = {
    theme: d.documentElement.getAttribute('data-theme'),
    bodyClass: d.body.className,
    bg: cs.backgroundColor,
    color: cs.color,
    htmlOv: getComputedStyle(d.documentElement).overflow,
    bodyOv: cs.overflow,
    docOverflow: getComputedStyle(d.documentElement).overflowY,
    scrollH: d.documentElement.scrollHeight,
    innerH: w.innerHeight,
    h1: 0, p: 0, editorW: 0, code: ''
  };
  var h1 = d.querySelector('.blk.h1'), p = d.querySelector('.blk.para');
  if (h1) out.h1 = parseFloat(getComputedStyle(h1).fontSize);
  if (p) out.p = parseFloat(getComputedStyle(p).fontSize);
  var ed = d.querySelector('.editor');
  if (ed) out.editorW = ed.getBoundingClientRect().width;
  var cd = d.querySelector('.blk.code, pre code, code');
  if (cd) out.code = getComputedStyle(cd).fontFamily;
  w.scrollTo(0, 600);
  out.scrollY = Math.round(w.scrollY || d.documentElement.scrollTop || 0);
  return out;
}

async function run() {
  var cases = CASES;
  var f = await load('v-github', cases.github.html);
  var a = probe(f);
  ok('导出文档带 data-theme', a.theme === 'github', a.theme);
  ok('body 带 opentypora-export', /(^|\s)opentypora-export(\s|$)/.test(a.bodyClass), a.bodyClass);
  ok('GitHub 背景是浅色', a.bg === cases.github.bg, a.bg + ' vs ' + cases.github.bg);
  ok('GitHub 文字是深色', a.color === cases.github.text, a.color + ' vs ' + cases.github.text);
  ok('GitHub 文字够暗', lum(a.color) < 128, String(lum(a.color)));
  ok('外壳不再锁死滚动', a.htmlOv !== 'hidden' && a.bodyOv !== 'hidden', a.htmlOv + '/' + a.bodyOv);
  ok('文档的 overflowY 也不是 hidden', a.docOverflow !== 'hidden', a.docOverflow);
  ok('长文档确实超过一屏', a.scrollH > a.innerH + 200, a.scrollH + ' vs ' + a.innerH);
  ok('能滚到下面（不是只能看第一屏）', a.scrollY > 0, String(a.scrollY));
  ok('标题比正文大（排版生效）', a.h1 > a.p, a.h1 + ' vs ' + a.p);
  ok('正文限宽 830px', a.editorW > 600 && a.editorW <= 832, String(a.editorW));
  ok('代码用等宽字体', /mono|menlo|consolas|courier/i.test(a.code), a.code);

  f = await load('v-night', cases.night.html);
  var b = probe(f);
  ok('夜间主题写进 data-theme', b.theme === 'night', b.theme);
  ok('夜间背景是深色', b.bg === cases.night.bg, b.bg + ' vs ' + cases.night.bg);
  ok('夜间背景比 GitHub 深', lum(b.bg) < lum(a.bg), lum(b.bg) + ' vs ' + lum(a.bg));
  ok('夜间文字是浅色', b.color === cases.night.text, b.color + ' vs ' + cases.night.text);
  ok('夜间文字够亮', lum(b.color) > 128, String(lum(b.color)));
  ok('夜间也能滚', b.scrollY > 0 && b.scrollH > b.innerH, b.scrollY + '/' + b.scrollH);
  ok('换主题不动排版（标题仍比正文大）', b.h1 > b.p, b.h1 + ' vs ' + b.p);

  f = await load('v-custom', cases.custom.html);
  var c = probe(f);
  ok('自定义主题的 base 写进 data-theme', c.theme === 'whitey', c.theme);
  ok('自定义主题压住内置变量', c.bg === cases.custom.bg, c.bg + ' vs ' + cases.custom.bg);
  ok('自定义主题的文字色也生效', c.color === cases.custom.text, c.color + ' vs ' + cases.custom.text);
  ok('自定义主题不等于基底色', c.bg !== cases.github.bg, c.bg);

  f = await load('v-plain', cases.plain.html);
  var d = probe(f);
  ok('无样式导出仍保留 data-theme', d.theme === 'night', d.theme);
  ok('无样式导出不带任何 CSS（背景是默认透明）', d.bg === cases.plain.bg, d.bg);
  ok('无样式导出文字是默认黑', d.color === cases.plain.text, d.color);
  ok('无样式导出没有排版（标题没被放大）', d.h1 === 0 || d.h1 <= d.p + 0.01, d.h1 + ' vs ' + d.p);

  window.__report = 'HTMLTHEME ' + R.filter(function (x) { return x.indexOf('PASS') === 0; }).length +
    '/' + R.length + '\n' + R.join('\n');
  var box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;background:#0b0f14;color:#7ee787;' +
    'font:11px/1.45 Menlo,monospace;padding:8px 10px;border-radius:8px;max-width:900px;max-height:90vh;overflow:auto';
  box.textContent = window.__report;
  document.body.appendChild(box);
}
var CASES = ${PAYLOAD};
run();
`;

const HTML = '<!DOCTYPE html>\n<html><head><meta charset="utf-8">\n' +
  '<style>body{margin:0;background:#f6f8fa;font:12px/1.4 -apple-system,sans-serif}' +
  'iframe{width:900px;height:420px;border:1px solid #ccc;display:block;margin:8px;background:#fff}</style>\n' +
  '</head>\n<body>\n' +
  '<iframe id="v-github"></iframe><iframe id="v-night"></iframe>' +
  '<iframe id="v-custom"></iframe><iframe id="v-plain"></iframe>\n' +
  '<script>\n' + TEST + '\n</script>\n</body>\n</html>\n';

fs.writeFileSync(OUT, HTML);
console.log('harness → ' + OUT);
