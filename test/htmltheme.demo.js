/* 导出主题的演示页：
 *   1) app/__htmltheme_demo_dlg.html —— 真应用 + 假 Bridge，打开「导出 HTML」对话框
 *   2) app/__htmltheme_demo_night.html —— 真正导出出来的单页（样式内联，Night 主题）
 * 供 build/shot 截成 docs/opentypora-html-theme*.png。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Export = require(path.join(ROOT, 'app', 'js', 'export.js'));
const MD = require(path.join(ROOT, 'app', 'js', 'md.js'));
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');

const DOC = [
  '# 导出主题',
  '',
  '同一个 `app.css`，六套内置主题。导出时把 `data-theme` 写进 `<html>`，',
  '样式内联进 `<head>`，双击打开就是选中的那套皮。',
  '',
  '## 为什么值得做',
  '',
  '- 写的时候用 GitHub，发给别人可以换成 Newsprint',
  '- 自定义主题跟着走：`:root` 会被抬成 `html[data-theme]`，排在 `app.css` 之后',
  '- 顺手修掉一个老问题：导出的单页原来继承了外壳的 `overflow: hidden`，长文档滚不动',
  '',
  '## 兑换比例',
  '',
  '| 币种 | 对美元 | 备注 |',
  '|------|--------|------|',
  '| CNY | 7.12 | 在岸 |',
  '| HKD | 7.79 | 联系汇率 |',
  '',
  '> 数字只是示意，别拿去下单。',
  '',
  '## 一段代码',
  '',
  '```js',
  'function pickTheme(raw, base) {',
  '  var id = raw || base;',
  '  return id.indexOf("user:") === 0 ? base : id;',
  '}',
  '```',
  '',
  '## 收尾',
  '',
  '主题只影响配色与排版，正文结构一个字节都不改。',
  ''
].join('\n');

/* ---------------------------------------------- 1) 导出的单页 */
function exportedHtml(theme) {
  const body = MD.renderDocument(DOC);
  const html = Export.htmlDoc(body, { theme: theme, title: '导出主题 · ' + theme });
  // 与 native/webexport.swift 相同的注入方式
  return html.replace(/<\/head>(?![\s\S]*<\/head>)/, '<style>\n' + CSS + '\n</style>\n</head>');
}

const page = exportedHtml('night');
fs.writeFileSync(path.join(ROOT, 'app', '__htmltheme_demo_night.html'), page);
console.log('demo → app/__htmltheme_demo_night.html');

// 浅色那版只用于对照，截图时另取一张
fs.writeFileSync(path.join(ROOT, 'app', '__htmltheme_demo_light.html'),
  exportedHtml('newsprint'));
console.log('demo → app/__htmltheme_demo_light.html');

/* ---------------------------------------------- 2) 选项对话框 */
const MOCK = `<script>
try {
  localStorage.clear();
  // 必须赶在 ui.js 读偏好之前写：晚了就还是默认主题
  localStorage.setItem('opentypora.prefs', JSON.stringify({
    htmlTheme: 'night', htmlWidth: true, htmlStyles: true, htmlEmbed: false,
    base: 'github'
  }));
} catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  save: function () { return Promise.resolve(null); },
  saveAs: function () { return Promise.resolve(null); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () {
    return Promise.resolve({ dir: '~/Library/Application Support/OpenTypora/themes',
      themes: [{ id: 'pixyll-dark.css', name: 'Pixyll Dark' }] });
  },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  exportHTML: function () { return Promise.resolve({ path: '/tmp/x.html' }); },
  exportPDF: function () { return Promise.resolve({ path: '/tmp/x.pdf' }); }
};
</script>`;

const OPEN = `<script>
setTimeout(function () {
  try {
    if (window.OpenTyporaCmd && OpenTyporaCmd.htmlOptions) OpenTyporaCmd.htmlOptions();
  } catch (e) {
    document.title = 'ERR ' + e;
  }
}, 700);
</script>`;

let appHtml = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
appHtml = appHtml.replace('<script src="js/bridge.js"></script>',
  '<script src="js/bridge.js"></script>\n' + MOCK);
appHtml = appHtml.replace('</body>', OPEN + '\n</body>');
fs.writeFileSync(path.join(ROOT, 'app', '__htmltheme_demo_dlg.html'), appHtml);
console.log('demo → app/__htmltheme_demo_dlg.html');
