// textfmt.test.js —— RTF / reStructuredText / MediaWiki / OPML 导出
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TF = require(path.join(ROOT, 'app/js/textfmt.js'));
const E = require(path.join(ROOT, 'app/js/export.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const DOC = [
  '# 标题一', '',
  '正文 **粗体**、*斜体*、`code`、~~删~~ 与 [链接](https://example.com)。', '',
  '## 标题二', '',
  '- 项目一', '- 项目二', '',
  '1. 第一步', '2. 第二步', '',
  '| 列A | 列B |', '| --- | --- |', '| 1 | 2 |', '',
  '```js', 'let x = 1 < 2;', '```', '',
  '![图](assets/a.png)', '',
  '脚注[^n1]', '',
  '[^n1]: 注释内容', '',
  '---', ''
].join('\n');

console.log('RTF');
{
  const r = TF.rtf(DOC, {});
  const t = r.text;
  ok('以 {\\rtf1 开头', /^\{\\rtf1/.test(t));
  ok('以 } 收尾', /\}\n$/.test(t));
  ok('字体表声明正文与等宽', /\\f0\\fnil[^}]*PingFang SC/.test(t) && /\\f1\\fmodern/.test(t));
  ok('颜色表', /\\colortbl ;/.test(t));
  ok('中文走 \\u 转义', /\\u26631\?/.test(t), t.slice(0, 80));
  ok('超出 BMP 一半的字符写成负数', /\\u-?\d+\?/.test(t) && /\\u-/.test(TF.rtf('\u9ad8', {}).text));
  ok('大括号与反斜杠转义', TF.rtfEsc('a{b}c\\d') === 'a\\{b\\}c\\\\d', TF.rtfEsc('a{b}c\\d'));
  ok('粗体包成 {\\b …}', /\{\\b \\u31895\?/.test(t), (t.match(/\{\\b [^}]*\}/) || [])[0]);
  ok('斜体包成 {\\i …}', /\{\\i \\u26012\?/.test(t), (t.match(/\{\\i [^}]*\}/) || [])[0]);
  ok('删除线 \\strike', /\{\\strike \\u21024\?/.test(t));
  ok('行内代码切等宽字体', /\{\\f1 code\}/.test(t));
  ok('链接用 HYPERLINK 域', /HYPERLINK "https:\/\/example\.com"/.test(t));
  ok('标题字号随级别递减', /\\fs40 \\u26631\\?/.test(t) && /\\fs32 \\u26631\\?/.test(t));
  ok('一级标题加粗后恢复', /\\b\\fs40 [\s\S]*?\\b0\\fs22\\par/.test(t));
  ok('段落用 \\par 结束', /\\pard [\s\S]*?\\par\n/.test(t));
  ok('列表项目符号', /\\u8226\?\\tab \\u-26503\\?/.test(t), (t.match(/\\li360[^\n]*/) || [])[0]);
  ok('有序列表编号', /1\.\\tab /.test(t) && /2\.\\tab /.test(t));
  ok('表格有行定义', /\\trowd/.test(t) && /\\cellx\d+/.test(t));
  ok('表格单元格与行结束', /\\intbl/.test(t) && /\\cell\\row/.test(t));
  ok('表头底色', /\\clcbpat14/.test(t));
  ok('代码块等宽且转义 <', /\\f1\\fs18[\s\S]*?let x = 1 < 2;/.test(t));
  ok('分隔线用下边框', /\\brdrb\\brdrs/.test(t));
  ok('图片留文字占位', /\[\\u22270\?\\u29255\?/.test(t), (t.match(/\\pard \[[^\]]*\]/) || [])[0]);
  ok('脚注引用上标', /\\super \[n1\]/.test(t));
}

console.log('reStructuredText');
{
  const r = TF.rst(DOC, {});
  const t = r.text;
  ok('一级标题下划线 =', /标题一\n===/.test(t));
  ok('二级标题下划线 -', /标题二\n---/.test(t));
  ok('粗体', /\*\*粗体\*\*/.test(t));
  ok('斜体', /\*斜体\*/.test(t));
  ok('行内代码双反引号', /``code``/.test(t));
  ok('链接写成 `文字 <url>`_', /`链接 <https:\/\/example\.com>`_/.test(t));
  ok('无序列表用 -', /^- 项目一/m.test(t));
  ok('有序列表用 1.', /^1\. 第一步/m.test(t));
  ok('代码块指令带语言', /\.\. code-block:: js/.test(t));
  ok('代码缩进三空格', /\n   let x = 1 < 2;/.test(t));
  ok('grid 表格边框', /\+[-+]+\+/.test(t) && /\| 列A/.test(t));
  ok('grid 表头分隔用 =', /\+[=+]+\+/.test(t));
  ok('图片用 image 指令', /\.\. image:: assets\/a\.png/.test(t));
  ok('图片带 alt', /:alt: 图/.test(t));
  ok('分隔线 ----', /^----$/m.test(t));
  ok('脚注引用 [#n1]_', /\[#n1\]_/.test(t));
  ok('脚注定义 .. [#n1]', /\.\. \[#n1\] 注释内容/.test(t));
  ok('不接受裸 HTML 标签', !/<h1/.test(t));
}

console.log('RST 其它块');
{
  const t = TF.rst('$$\na^2\n$$\n\n[TOC]\n\n> 引用一段\n', {}).text;
  ok('公式用 math 指令', /\.\. math::/.test(t) && /   a\^2/.test(t));
  ok('目录用 contents 指令', /\.\. contents::/.test(t));
  ok('引用缩进三空格', /^   引用一段/m.test(t));
  const t2 = TF.rst('| a | b |\n| --- | --- |\n| 长的单元格内容 | 2 |\n', {}).text;
  ok('列宽随内容变宽', /\+-{9,}\+-----/.test(t2), t2.split('\n')[0]);
}

console.log('MediaWiki');
{
  const t = TF.mediawiki(DOC, {}).text;
  ok('一级标题 = 标题 =', /^= 标题一 =$/m.test(t));
  ok('二级标题 == 标题 ==', /^== 标题二 ==$/m.test(t));
  ok('粗体三个单引号', /'''粗体'''/.test(t));
  ok('斜体两个单引号', /''斜体''/.test(t));
  ok('行内代码 <code>', /<code>code<\/code>/.test(t));
  ok('删除线 <s>', /<s>删<\/s>/.test(t));
  ok('外链方括号', /\[https:\/\/example\.com 链接\]/.test(t));
  ok('无序列表 *', /^\* 项目一$/m.test(t));
  ok('有序列表 #', /^# 第一步$/m.test(t));
  ok('表格开头 {|', /\{\| class="wikitable"/.test(t));
  ok('表格表头 !', /^! 列A$/m.test(t));
  ok('表格单元格 |', /^\| 1$/m.test(t));
  ok('表格结束 |}', /\|\}/.test(t));
  ok('代码 syntaxhighlight', /<syntaxhighlight lang="js">/.test(t));
  ok('脚注 <ref>', /<ref name="n1">注释内容<\/ref>/.test(t));
  ok('图片 [[File:', /\[\[File:a\.png\|thumb\|图\]\]/.test(t));
  ok('分隔线 ----', /^----$/m.test(t));
}

console.log('OPML');
{
  const t = TF.opml(DOC, { title: '大纲' }).text;
  ok('XML 声明', /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(t));
  ok('opml 2.0 根节点', /<opml version="2\.0">/.test(t));
  ok('head 里有标题', /<title>大纲<\/title>/.test(t));
  ok('一级标题成为 outline', /<outline text="标题一"/.test(t));
  ok('二级标题嵌在一级里', /<outline text="标题一"[\s\S]*?<outline text="标题二"/.test(t));
  ok('无子节点时自闭合', /<outline text="标题二" _note="[^"]*"\/>/.test(t));
  ok('正文进 _note', /_note="正文 粗体、斜体、code、删 与 链接。"/.test(t));
  ok('_note 里没有 Markdown 标记', !/\*\*/.test(t) && !/\| 列A/.test(t));
  ok('列表摊平成项目符号行', /• 项目一/.test(t));
  ok('XML 特殊字符转义', /_note="a &amp; b"/.test(TF.opml('a & b', {}).text));
  const h = TF.opml('# A\n\n## B\n\n### C\n\n## D\n', {}).text;
  ok('同级标题回到同一层', /<outline text="A"[\s\S]*?<outline text="B"[\s\S]*?<\/outline>\s*<outline text="D"/.test(h), h);
  const none = TF.opml('只有一段话', {}).text;
  ok('没有标题时整篇一条', /<outline text="未命名文档" _note="只有一段话"\/>/.test(none), none);
}

console.log('Textile');
{
  const r = TF.textile(DOC, {});
  const t = r.text;
  ok('标题带 id 的块签名', /^h1\(#sec1\)\. 标题一$/m.test(t), (t.match(/^h1.*/) || [])[0]);
  ok('二级标题', /^h2\(#sec2\)\. 标题二$/m.test(t));
  ok('粗体 *x*', /\*粗体\*/.test(t));
  ok('斜体 _x_', /_斜体_/.test(t));
  ok('行内代码 @x@', /@code@/.test(t));
  ok('删除线 -x-', /-删-/.test(t));
  ok('链接 "文字":url', /"链接":https:\/\/example\.com/.test(t));
  ok('无序列表 * 开头', /^\* 项目一$/m.test(t));
  ok('有序列表 # 开头', /^# 第一步$/m.test(t));
  ok('表格表头 |_.', /^\|_\. 列A \|_\. 列B \|$/m.test(t), (t.match(/^\|_.*/m) || [])[0]);
  ok('表格单元格行', /^\| 1 \| 2 \|$/m.test(t));
  const ali = TF.textile('| a | b |\n| --- | ---: |\n| 1 | 2 |\n', {}).text;
  ok('右对齐写成 |>.', /^\| 1 \|>\. 2 \|$/m.test(ali), (ali.match(/^\| 1.*/m) || [])[0]);
  ok('表头右对齐 |_>.', /^\|_\. a \|_>\. b \|$/m.test(ali), (ali.match(/^\|_.*/m) || [])[0]);
  ok('单行代码 bc.', /^bc\. let x = 1 < 2;$/m.test(t));
  ok('图片 !src(alt)!', /!assets\/a\.png\(图\)!/.test(t));
  ok('脚注引用 [1]', /脚注\[1\]/.test(t));
  ok('脚注定义 fn1.', /^fn1\. 注释内容$/m.test(t));
  ok('引用 bq.', /^bq\. 引用文字$/m.test(TF.textile('> 引用文字', {}).text));
  const toc = TF.textile('# A\n\n## B\n\n[TOC]\n', {}).text;
  ok('目录变成带锚点的列表', /h2\. 目录\n\n\* "A":#sec1\n\*\* "B":#sec2/.test(toc), toc);
  ok('分隔线 <hr />', /<hr \/>/.test(t));
  ok('表格里的竖线被转义', /\|_\.[^|]*a&#124;b/.test(TF.textile('| a\\|b |\n| --- |\n| 1 |', {}).text),
    TF.textile('| a\\|b |\n| --- |\n| 1 |', {}).text);
  ok('多行代码用扩展块 bc..', /^bc\.\. line1$/m.test(TF.textile('```\nline1\nline2\n```', {}).text));
  ok('原始 HTML 包 notextile', /<notextile>[\s\S]*<div/.test(TF.textile('<div class="x">hi</div>', {}).text));
  eq('Textile 标题回落文件名', TF.textile('正文', { title: 'T' }).title, 'T');
}

console.log('分发');
{
  eq('格式表十项', Object.keys(E.formats).join(','), 'docx,odt,epub,tex,rtf,rst,mediawiki,textile,opml,revealjs');
  eq('odt 扩展名', E.formats.odt.ext, 'odt');
  eq('mediawiki 扩展名', E.formats.mediawiki.ext, 'wiki');
  eq('textile 扩展名', E.formats.textile.ext, 'textile');
  eq('revealjs 扩展名', E.formats.revealjs.ext, 'html');
}

Promise.all([
  E.build('rtf', DOC, {}).then((r) => {
    ok('build rtf 返回文本', /^\{\\rtf1/.test(r.text));
    return r;
  }),
  E.build('rst', DOC, {}).then((r) => ok('build rst 返回文本', /标题一\n===/.test(r.text))),
  E.build('mediawiki', DOC, {}).then((r) => ok('build mediawiki 返回文本', /= 标题一 =/.test(r.text))),
  E.build('opml', DOC, {}).then((r) => ok('build opml 返回文本', /<opml version="2.0">/.test(r.text))),
  E.build('textile', DOC, {}).then((r) => ok('build textile 返回文本', /^h1\(#sec1\)\. 标题一$/m.test(r.text))),
  E.build('odt', DOC, {}).then((r) => {
    ok('build odt 返回字节', r.bytes instanceof Uint8Array && r.bytes[0] === 0x50);
  }),
  E.build('tex', DOC, {}).then((r) => ok('原有 tex 分支不受影响', /\\documentclass/.test(r.text)))
]).then(() => E.build('nope', '', {})).then(
  () => { ok('未知格式应当 reject', false); done(); },
  (e) => { ok('未知格式 reject 并说明', /不支持的导出格式/.test(e.message), e.message); done(); }
);

function done() {
  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
