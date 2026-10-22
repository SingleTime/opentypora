/* Node 单测：解析器正确性 + 往返无损性 */
const MD = require('../app/js/md.js');
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
function roundtrip(src) {
  const m = MD.parse(src);
  assert.strictEqual(MD.serialize(m), src, '往返不一致');
  return m;
}
function html(src) { return MD.renderDocument(src); }

console.log('\n[1] 往返无损');
const docs = [
  '',
  '\n',
  'hello',
  'hello\n',
  'hello\n\n\n',
  '# Title\n\nparagraph **bold** and *italic*.\n',
  '\n\n  前置空行\n\n\n后置多空行\n\n\n',
  '---\ntitle: 测试\ntags: [a, b]\n---\n\n正文\n',
  '```js\nconst a = 1;\n```\n',
  '```\nunclosed fence\n',
  '> 引用\n> 第二行\n\n普通段落\n',
  '- a\n- b\n  - b1\n  - b2\n- c\n',
  '1. one\n2. two\n',
  '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
  '$$\nE = mc^2\n$$\n',
  'Setext 标题\n===\n\n二级\n---\n',
  'text with  \nhard break\n',
  '- [x] done\n- [ ] todo\n',
  '# h1\n## h2\n### h3\n',
  '***\n',
  '<div>html block</div>\n\n段落\n',
  'a\n\nb\n\nc'
];
docs.forEach((d, i) => t('doc #' + i + ' 往返一致', () => roundtrip(d)));

console.log('\n[2] 块识别');
t('ATX 标题级别', () => {
  const m = MD.parse('# a\n\n###### f\n');
  assert.deepStrictEqual(m.blocks.map(b => b.type), ['h1', 'h6']);
});
t('setext 标题', () => {
  const m = MD.parse('标题\n===\n\n二级\n---\n');
  assert.deepStrictEqual(m.blocks.map(b => b.type), ['h1', 'h2']);
});
t('段落被标题打断', () => {
  const m = MD.parse('文字\n# 标题\n');
  assert.deepStrictEqual(m.blocks.map(b => b.type), ['para', 'h1']);
});
t('围栏代码带语言', () => {
  const m = MD.parse('```python\nx=1\n```\n');
  assert.strictEqual(m.blocks[0].type, 'code');
  assert.strictEqual(m.blocks[0].lang, 'python');
  assert.strictEqual(m.blocks[0].code, 'x=1');
});
t('围栏内 # 不当标题', () => {
  const m = MD.parse('```\n# not heading\n```\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'code');
});
t('反引号围栏的 info 里带反引号不算开围栏', () => {
  // README 用四个反引号包住 ```flow 来写内联代码；把它当开围栏会把后文整篇吞掉
  const m = MD.parse('```` ```flow ```` 代码块走内置 flow.js\n\n## 下一节\n');
  assert.deepStrictEqual(m.blocks.map(b => b.type), ['para', 'h2']);
});
t('四个反引号的真围栏照样开代码块', () => {
  const m = MD.parse('````md\n```js\nx\n```\n````\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'code');
  assert.strictEqual(m.blocks[0].lang, 'md');
});
t('波浪号围栏的 info 里可以有反引号', () => {
  const m = MD.parse('~~~ ```\nin code\n~~~\n');
  assert.strictEqual(m.blocks[0].type, 'code');
});
t('段落中间的内联围栏写法不吃掉后文', () => {
  const m = MD.parse('甲 ```` ```flow ```` 乙\n\n正文\n');
  assert.deepStrictEqual(m.blocks.map(b => b.type), ['para', 'para']);
});
t('引用块内可含多行', () => {
  const m = MD.parse('> a\n> b\n> c\n');
  assert.strictEqual(m.blocks[0].type, 'quote');
  assert.strictEqual(m.blocks[0].inner, 'a\nb\nc');
});
t('表格识别', () => {
  const m = MD.parse('| a | b |\n|:--|--:|\n| 1 | 2 |\n');
  assert.strictEqual(m.blocks[0].type, 'table');
});
t('列表嵌套被解析成树', () => {
  const m = MD.parse('- a\n  - a1\n  - a2\n- b\n');
  const items = m.blocks[0].items;
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].children.length, 2);
});
t('任务列表', () => {
  const m = MD.parse('- [x] done\n- [ ] todo\n');
  assert.strictEqual(m.blocks[0].items[0].task, true);
  assert.strictEqual(m.blocks[0].items[1].task, false);
});
t('front matter 独立成块', () => {
  const m = MD.parse('---\na: 1\n---\n\nbody\n');
  assert.strictEqual(m.blocks[0].type, 'frontmatter');
  assert.strictEqual(m.blocks[1].type, 'para');
});
t('有序列表 ol', () => {
  assert.ok(html('1. a\n2. b\n').includes('<ol'));
});

console.log('\n[3] 行内元素');
t('粗体/斜体/删除线/高亮', () => {
  const h = html('**B** *I* ~~D~~ ==M==');
  assert.ok(h.includes('<strong') && h.includes('<em') && h.includes('<del') && h.includes('<mark'));
});
t('行内代码不被强调', () => {
  const h = html('`a**b**c`');
  assert.ok(h.includes('<code') && !h.includes('<strong'));
});
t('转义反斜杠', () => {
  assert.ok(html('\\*not em\\*').includes('*not em*'));
  assert.ok(!html('\\*not em\\*').includes('<em'));
});
t('链接与图片', () => {
  const h = html('[文字](https://a.com) ![alt](img.png)');
  assert.ok(h.includes('<a ') && h.includes('href="https://a.com"'));
  assert.ok(h.includes('<img ') && h.includes('src="img.png"'));
});
t('自动链接', () => {
  assert.ok(html('<https://x.com>').includes('<a '));
});
t('反引号代码含反引号', () => {
  assert.ok(html('`` a ` b ``').includes('<code'));
});
t('HTML 特殊字符转义', () => {
  const h = html('a < b & c > d');
  assert.ok(h.includes('&lt;') && h.includes('&amp;'));
});
t('行内文本带 data-s 偏移', () => {
  const h = html('hello world');
  assert.ok(/data-s="0"/.test(h));
});

console.log('\n[4] 代码高亮');
t('关键字高亮', () => {
  const h = MD.highlight('const a = 1;', 'js');
  assert.ok(h.includes('tok-kw') && h.includes('tok-nu'));
});
t('字符串与注释', () => {
  const h = MD.highlight('x = "s" // c', 'js');
  assert.ok(h.includes('tok-st') && h.includes('tok-cm'));
});
t('未知语言安全降级', () => {
  const h = MD.highlight('<script>', 'zzz');
  assert.ok(h.includes('&lt;script&gt;'));
});

console.log('\n[5] 数学');
t('上标', () => { assert.ok(MD.texToHTML('x^2', false).includes('m-sup')); });
t('分数', () => { assert.ok(MD.texToHTML('\\frac{a}{b}', false).includes('m-frac')); });
t('希腊字母', () => { assert.ok(MD.texToHTML('\\alpha', false).includes('α')); });
t('根号', () => { assert.ok(MD.texToHTML('\\sqrt{x}', false).includes('m-sqrt')); });

console.log('\n[6] 大纲与字数');
t('大纲层级', () => {
  const m = MD.parse('# A\n\n## B\n');
  const o = MD.outline(m.blocks);
  assert.deepStrictEqual(o.map(x => x.level), [1, 2]);
});
t('中英混排字数', () => {
  const c = MD.countWords('这是四个字 hello world');
  assert.strictEqual(c.words, 7);
});

console.log('\n[7] 查找 / 替换');
t('普通查找：命中所有出现位置（不区分大小写）', () => {
  const hits = MD.findAll('Foo foo FOO', 'foo');
  assert.strictEqual(hits.length, 3);
  assert.deepStrictEqual(hits.map(h => h.start), [0, 4, 8]);
});
t('区分大小写', () => {
  assert.strictEqual(MD.findAll('Foo foo', 'foo', { caseSensitive: true }).length, 1);
});
t('中文与跨行匹配', () => {
  const hits = MD.findAll('第一行\n第二行', '行');
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[1].start, 6);
});
t('特殊字符按字面匹配（不当正则）', () => {
  assert.strictEqual(MD.findAll('a.b axb', 'a.b').length, 1);
  assert.strictEqual(MD.findAll('价格 $5 (含税)', '(含税)').length, 1);
});
t('空查询返回空数组', () => { assert.deepStrictEqual(MD.findAll('abc', ''), []); });
t('非法正则返回 null', () => { assert.strictEqual(MD.findAll('abc', '(', { regex: true }), null); });
t('正则分组匹配', () => {
  const hits = MD.findAll('a1 b22 c333', '\\d+', { regex: true });
  assert.deepStrictEqual(hits.map(h => h.text), ['1', '22', '333']);
});
t('零宽正则不会死循环', () => {
  const hits = MD.findAll('abc', 'x*', { regex: true });
  assert.ok(hits.length === 0);
});
t('替换全部：字面模式下 $ 不算反向引用', () => {
  const r = MD.replaceAll('aXbXc', 'X', '$1');
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.text, 'a$1b$1c');
});
t('替换全部：正则模式支持 $1', () => {
  const r = MD.replaceAll('a1 b2', '(\\w)(\\d)', '$2$1', { regex: true });
  assert.strictEqual(r.text, '1a 2b');
  assert.strictEqual(r.count, 2);
});
t('替换全部：保留大小写不敏感匹配的原文替换', () => {
  const r = MD.replaceAll('Foo foo', 'foo', 'bar');
  assert.strictEqual(r.text, 'bar bar');
});
t('替换全部：大小写敏感时不误伤', () => {
  const r = MD.replaceAll('Foo foo', 'foo', 'bar', { caseSensitive: true });
  assert.strictEqual(r.text, 'Foo bar');
  assert.strictEqual(r.count, 1);
});
t('替换匹配数量与查找一致', () => {
  const src = '行内 $E=mc^2$\n\n$$x$$\n';
  assert.strictEqual(MD.findAll(src, '$').length, 6);
  assert.strictEqual(MD.replaceAll(src, '$', '\\$').count, 6);
});

console.log('\n[8] [TOC] / 脚注 / 内部链接');

t('[TOC] 单独成块', () => {
  const m = roundtrip('[TOC]\n\n# 一\n\n正文\n');
  assert.strictEqual(m.blocks[0].type, 'toc');
  assert.strictEqual(m.blocks.length, 3);
});

t('[TOC] 大小写不敏感且允许前导空格', () => {
  assert.strictEqual(MD.parse('[toc]\n').blocks[0].type, 'toc');
  assert.strictEqual(MD.parse('  [TOC]  \n').blocks[0].type, 'toc');
});

t('[TOC] 不是标题的普通文本不误判', () => {
  const m = MD.parse('[TOC] 目录说明\n');
  assert.strictEqual(m.blocks[0].type, 'para');
});

t('[TOC] 渲染出待填充的占位容器', () => {
  const h = html('[TOC]\n');
  assert.ok(h.indexOf('data-toc="1"') > 0);
  assert.ok(h.indexOf('class="blk toc"') > 0);
});

t('脚注定义成块并带 id', () => {
  const m = roundtrip('正文[^1]\n\n[^1]: 脚注内容\n');
  assert.strictEqual(m.blocks[1].type, 'footdef');
  assert.strictEqual(m.blocks[1].fnId, '1');
  assert.strictEqual(m.blocks[1].fnBody, '脚注内容');
});

t('脚注定义支持缩进续行', () => {
  const m = MD.parse('[^a]: 第一行\n    第二行\n');
  assert.strictEqual(m.blocks[0].fnBody, '第一行\n第二行');
  assert.strictEqual(m.blocks.length, 1);
});

t('脚注引用渲染成 sup.fn-ref', () => {
  const h = html('正文[^1]继续\n');
  assert.ok(h.indexOf('class="fn-ref"') > 0);
  assert.ok(h.indexOf('data-fn="1"') > 0);
});

t('脚注引用不会被当成链接', () => {
  const h = html('见[^note]\n');
  assert.ok(h.indexOf('<a ') < 0, '不应生成 a 标签');
});

t('脚注定义渲染出序号徽标与正文', () => {
  const h = html('[^1]: 说明文字\n');
  assert.ok(h.indexOf('blk fn-def') > 0);
  assert.ok(h.indexOf('data-fn-num="1"') > 0);
  assert.ok(h.indexOf('说明文字') > 0);
});

t('脚注与 [TOC] 的往返都无损', () => {
  const src = '[TOC]\n\n# 标题\n\n正文[^1]和[^2]。\n\n[^1]: 甲\n[^2]: 乙\n';
  const m = roundtrip(src);
  const types = m.blocks.map(b => b.type);
  assert.deepStrictEqual(types, ['toc', 'h1', 'para', 'footdef', 'footdef']);
});

t('内部链接 [x](#slug) 保持 href', () => {
  const h = html('跳到[第二章](#第二章)\n');
  assert.ok(h.indexOf('href="#第二章"') > 0);
});

t('[TOC] 后面紧跟标题不会被并进同一块', () => {
  const m = MD.parse('[TOC]\n# 紧接标题\n');
  assert.strictEqual(m.blocks.length, 2);
  assert.strictEqual(m.blocks[1].type, 'h1');
});

// ── [9] Mermaid 代码块（渲染交给 diagram.js，解析器只负责认出来） ──
t('```mermaid 解析成 code 块并带 lang', () => {
  const m = MD.parse('```mermaid\nflowchart LR\n  A --> B\n```\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'code');
  assert.strictEqual(m.blocks[0].lang, 'mermaid');
});

t('```mermaid 渲染出 language-mermaid 类名', () => {
  const h = html('```mermaid\nflowchart LR\n  A --> B\n```\n');
  assert.ok(h.indexOf('class="language-mermaid"') > 0);
});

t('源码里的箭头不被 HTML 转义破坏（&gt; 可逆）', () => {
  const src = '```mermaid\nflowchart LR\n  A --> B\n```\n';
  const h = html(src);
  // 箭头现在被单独包进 tok-meta，所以不能再要求 "A --&gt; B" 连续
  assert.ok(h.indexOf('--&gt;') > 0 && h.indexOf('-->') < 0);
  assert.ok(h.indexOf('<span class="tok-meta">--&gt;</span>') > 0);
  // roundtrip 内部就断言了 serialize(parse(src)) === src，
  // 不成立会直接抛，否则一编辑就把图写坏
  roundtrip(src);
});

t('空 mermaid 块不炸', () => {
  const m = MD.parse('```mermaid\n```\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].lang, 'mermaid');
});

t('mermaid 块里的 # 不会被当成标题', () => {
  const m = MD.parse('```mermaid\n%% # 注释\nflowchart LR\n  A --> B\n```\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'code');
  assert.strictEqual(m.blocks[0].lang, 'mermaid');
});

/* ---------- [10] 块级公式：两种写法都要认 ---------- */

t('单行 $$...$$ 识别为 math 块', () => {
  const m = MD.parse('$$E=mc^2$$\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'math');
  assert.strictEqual(m.blocks[0].tex, 'E=mc^2');
});

t('围栏式 $$ ... $$ 仍识别为 math 块', () => {
  const m = MD.parse('$$\n\\begin{matrix}a&b\\\\c&d\\end{matrix}\n$$\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'math');
  assert.ok(m.blocks[0].tex.indexOf('\\begin{matrix}') === 0);
});

t('单行公式往返无损', () => {
  roundtrip('$$\\sum_{i=1}^{n} i^2$$\n');
  roundtrip('$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$\n');
});

t('公式夹在文字中间不算块（仍作行内）', () => {
  const m = MD.parse('前面 $$x^2$$ 后面\n');
  assert.strictEqual(m.blocks.length, 1);
  assert.strictEqual(m.blocks[0].type, 'para');
});

t('空 $$ 不产生 math 块', () => {
  const m = MD.parse('$$   $$\n');
  assert.ok(m.blocks.every(b => b.type !== 'math'), '空公式不应成为 math 块');
});

t('renderDocument 输出 mathblock 且带 katex 结构', () => {
  const h = html('$$x^2$$\n');
  assert.ok(h.indexOf('mathblock') > 0, '缺少 mathblock 类');
  assert.ok(h.indexOf('$') === -1 || h.indexOf('$$x^2$$') === -1, '源码标记未消费');
});

/* ---------- [11] 图片：尺寸写法与特殊路径 ---------- */

function imgTag(src) {
  const h = html(src);
  const m = /<img[^>]*>/.exec(h);
  return m ? m[0] : '';
}

t('=300x200 渲染成固定宽高', () => {
  const tag = imgTag('![a](x.png =300x200)\n');
  assert.ok(/width:300px/.test(tag), '缺 width:300px：' + tag);
  assert.ok(/height:200px/.test(tag), '缺 height:200px：' + tag);
});

t('=300 只定宽，高自适应', () => {
  const tag = imgTag('![a](x.png =300)\n');
  assert.ok(/width:300px/.test(tag));
  assert.ok(/height:auto/.test(tag), '应 height:auto：' + tag);
});

t('=x200 只定高，宽自适应', () => {
  const tag = imgTag('![a](x.png =x200)\n');
  assert.ok(/height:200px/.test(tag));
  assert.ok(/width:auto/.test(tag), '应 width:auto：' + tag);
});

t('带空格的路径用尖括号包起来也能识别', () => {
  const tag = imgTag('![a](<my file.png> =120)\n');
  assert.ok(/src="my file\.png"/.test(tag), 'src 被截断了：' + tag);
  assert.ok(/width:120px/.test(tag));
});

t('路径里带括号不会截断', () => {
  const tag = imgTag('![a](a(1).png =50)\n');
  assert.ok(/src="a\(1\)\.png"/.test(tag), 'src 被截断了：' + tag);
});

t('title 与尺寸可以共存', () => {
  const tag = imgTag('![a](x.png "说明" =200)\n');
  assert.ok(/title="说明"/.test(tag));
  assert.ok(/width:200px/.test(tag));
});

t('没有尺寸时不加 style（保持原样）', () => {
  const tag = imgTag('![a](x.png)\n');
  assert.ok(tag.indexOf('style=') === -1, '不该凭空加 style：' + tag);
});

t('尺寸写法往返无损', () => {
  roundtrip('![a](x.png =300x200)\n');
  roundtrip('![a](<my file.png> "t" =120)\n');
  roundtrip('![a](a(1).png =50)\n');
});


/* ---------- [12] HTML 块：容器配对 / 消毒 / 文字提取 ---------- */

function htmlBlock(raw) {
  var m = MD.parse(raw);
  return m.blocks.filter(function (b) { return b.type === 'html'; });
}

t('容器块跨空行整块收（不再被空行切断）', () => {
  var src = '<div class="note">\n第一段\n\n第二段\n</div>\n\n后面\n';
  var m = MD.parse(src);
  assert.strictEqual(m.blocks.length, 2, '应只有 2 块，实际 ' + m.blocks.length);
  assert.strictEqual(m.blocks[0].type, 'html');
  assert.strictEqual(m.blocks[0].raw, '<div class="note">\n第一段\n\n第二段\n</div>');
  assert.strictEqual(m.blocks[1].type, 'para');
});

t('同名标签嵌套按配平计数', () => {
  var src = '<div>\n<div>内层</div>\n</div>\n尾段\n';
  var m = MD.parse(src);
  assert.strictEqual(m.blocks[0].type, 'html');
  assert.strictEqual(m.blocks[0].raw, '<div>\n<div>内层</div>\n</div>');
  assert.strictEqual(m.blocks[1].type, 'para');
});

t('单行 <div>x</div> 只吃一行', () => {
  var m = MD.parse('<div>x</div>\n后面的段落\n');
  assert.strictEqual(m.blocks.length, 2);
  assert.strictEqual(m.blocks[0].raw, '<div>x</div>');
});

t('自闭合 <div … /> 只吃一行', () => {
  var m = MD.parse('<div data-x="1" />\n段落\n');
  assert.strictEqual(m.blocks[0].raw, '<div data-x="1" />');
});

t('未闭合的 <div> 退回空行规则', () => {
  var m = MD.parse('<div>没有闭合\n\n段落\n');
  assert.strictEqual(m.blocks[0].type, 'html');
  assert.strictEqual(m.blocks[0].raw, '<div>没有闭合');
  assert.strictEqual(m.blocks[1].type, 'para');
});

t('注释块一直收到 -->', () => {
  assert.deepStrictEqual(htmlBlock('<!-- 一行 -->\n')[0].raw, '<!-- 一行 -->');
  var multi = '<!--\n第一行\n\n中间空行\n-->\n段落\n';
  var m = MD.parse(multi);
  assert.strictEqual(m.blocks[0].raw, '<!--\n第一行\n\n中间空行\n-->');
  assert.strictEqual(m.blocks[1].type, 'para');
});

t('<style> / <script> / <pre> 内容里的空行不截断', () => {
  var css = '<style>\na { color: red }\n\nb { color: blue }\n</style>\n段落\n';
  var m = MD.parse(css);
  assert.strictEqual(m.blocks[0].type, 'html');
  assert.strictEqual(m.blocks[0].raw.indexOf('</style>') > 0, true);
  assert.strictEqual(m.blocks[1].type, 'para');
});

t('叶子标签（<img>）仍按空行成块', () => {
  var m = MD.parse('<img src="a.png">\n');
  assert.strictEqual(m.blocks[0].type, 'html');
  assert.strictEqual(m.blocks[0].raw, '<img src="a.png">');
});

t('HTML 块往返无损（含跨空行与嵌套）', () => {
  roundtrip('<div class="note">\n第一段\n\n第二段\n</div>\n\n后面\n');
  roundtrip('<!--\n多行\n\n注释\n-->\n');
  roundtrip('<div>\n<div>内层</div>\n</div>\n尾段\n');
  roundtrip('<style>\na{}\n\nb{}\n</style>\n');
  roundtrip('<img src="a.png" width="10">\n\n段落\n');
  roundtrip('<div>没有闭合\n\n段落\n');
});

t('渲染出真 HTML，而不是转义后的源码', () => {
  var h = html('<div class="note">内容</div>\n');
  assert.ok(h.indexOf('<div class="note">内容</div>') > 0, '没有原样输出：' + h);
  assert.ok(h.indexOf('&lt;div') === -1, '标签不该被转义');
  assert.ok(h.indexOf('html-body') > 0, '缺少 html-body 容器');
});

t('cleanHTML：<script> 整段剔除', () => {
  assert.strictEqual(MD.cleanHTML('<script>alert(1)</script>'), '');
  assert.strictEqual(MD.cleanHTML('<div>a</div>\n<script src="x.js"></script>'), '<div>a</div>\n');
});

t('cleanHTML：事件属性剔除，普通属性保留', () => {
  var out = MD.cleanHTML('<div onclick="x()" class="k" onmouseover=\'y()\'>a</div>');
  assert.strictEqual(out, '<div class="k">a</div>');
});

t('cleanHTML：javascript: 链接被清掉', () => {
  assert.strictEqual(MD.cleanHTML('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
});

t('htmlText：<br> 变换行、标签与实体处理正确', () => {
  assert.strictEqual(MD.htmlText('<div>a<br>b</div>'), 'a\nb');
  assert.strictEqual(MD.htmlText('<p>x &amp; y &lt;z&gt;</p>'), 'x & y <z>');
  assert.strictEqual(MD.htmlText('<div>a</div><div>b</div>'), 'a\nb');
});


/* ---------- [13] wiki 链接 ---------- */

t('[[笔记]] 渲染成 a.wiki-link，href 补 .md', () => {
  const h = MD.renderInline('见 [[笔记]]');
  assert.ok(h.indexOf('class="wiki-link"') > 0, '没有 wiki-link 类');
  assert.ok(h.indexOf('data-wiki="笔记"') > 0, '缺 data-wiki');
  assert.ok(h.indexOf('href="笔记.md"') > 0, 'href 没补 .md：' + h);
  assert.ok(/笔记<\/span><\/a>/.test(h), '显示文字不对：' + h);
});

t('[[目标|别名]] 显示别名、目标不变', () => {
  const h = MD.renderInline('[[甲|别名]]');
  assert.ok(h.indexOf('data-wiki="甲"') > 0, '目标被改：' + h);
  assert.ok(/别名<\/span><\/a>/.test(h), '没显示别名：' + h);
  assert.ok(h.indexOf('href="甲.md"') > 0);
});

t('[[#小节]] 当内部锚点，显示时去掉 #', () => {
  const h = MD.renderInline('[[#小节]]');
  assert.ok(h.indexOf('href="#小节"') > 0, 'href 不是锚点：' + h);
  assert.ok(h.indexOf('data-wiki-anchor="1"') > 0);
  assert.ok(/小节<\/span><\/a>/.test(h), '显示文字没去掉 #：' + h);
  assert.ok(/跳过去<\/span><\/a>/.test(MD.renderInline('[[#小节|跳过去]]')), '别名不对');
});

t('[[a\\|b]] 里的管道算目标的一部分', () => {
  const w = MD.readWiki('[[a\\|b]]', 0);
  assert.strictEqual(w.target, 'a|b');
  assert.strictEqual(w.label, 'a|b');
});

t('别名里可以继续用行内语法', () => {
  const h = MD.renderInline('[[x|**粗**]]');
  assert.ok(h.indexOf('<strong') > 0, '别名没有被行内解析：' + h);
});

t('空的 [[]] / [[ ]] 不识别', () => {
  assert.strictEqual(MD.readWiki('[[]]', 0), null);
  assert.strictEqual(MD.readWiki('[[  ]]', 0), null);
  assert.strictEqual(MD.renderInline('[[]]').indexOf('wiki-link'), -1);
});

t('wiki 链接不影响 [TOC] 与脚注', () => {
  const m = MD.parse('[TOC]\n\n正文[^1]\n\n[^1]: 说明\n');
  assert.strictEqual(m.blocks[0].type, 'toc');
  assert.strictEqual(m.blocks[2].type, 'footdef');
  assert.ok(MD.renderInline('[[toc]]').indexOf('wiki-link') > 0, '[[toc]] 是笔记引用，不是目录');
});

t('wiki 链接往返无损', () => {
  roundtrip('见 [[笔记]]、[[a|甲]] 与 [[#小节]]。\n');
  roundtrip('- [[笔记]]\n- [[另一篇|别名]]\n');
  roundtrip('| 列 |\n| --- |\n| [[笔记]] |\n');
});

t('表格单元格里的 wiki 链接也能渲染', () => {
  const h = MD.renderDocument('| 列 |\n| --- |\n| [[笔记]] |\n');
  assert.ok(h.indexOf('class="wiki-link"') > 0);
});

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
