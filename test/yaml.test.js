/* Node 单测：yaml.js —— front matter 解析与导出覆盖归一化 */
const path = require('path');
const Yaml = require(path.join(__dirname, '..', 'app', 'js', 'yaml.js'));

let pass = 0, fail = 0;
function eq(name, a, b) {
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(a) + '  want ' + JSON.stringify(b)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra) : '')); }
}

/* ---------------- frontRaw / metaOf ---------------- */
console.log('front matter 识别');
ok('没有 front matter 时返回空 map', Object.keys(Yaml.metaOf('# 标题\n\n正文')).length === 0);
ok('空 src 不炸', Object.keys(Yaml.metaOf('')).length === 0);
ok('null src 不炸', Object.keys(Yaml.metaOf(null)).length === 0);
ok('--- 不在开头不算', Object.keys(Yaml.metaOf('正文\n---\ntitle: x\n---\n')).length === 0);
ok('没闭合的 --- 不算', Object.keys(Yaml.metaOf('---\ntitle: x\n')).length === 0);

console.log('基本键值');
var m1 = Yaml.metaOf('---\ntitle: 我的文档\nauthor: FW\n---\n\n正文');
eq('title 读到', m1.title, '我的文档');
eq('author 读到', m1.author, 'FW');
eq('键统一小写', Yaml.metaOf('---\nTiTlE: x\n---').title, 'x');
eq('冒号后无空格也认', Yaml.metaOf('---\ntitle:x\n---').title, 'x');
eq('值里的冒号不截断', Yaml.metaOf('---\ntitle: 副标题: 带冒号\n---').title, '副标题: 带冒号');
eq('引号包裹取值内容', Yaml.metaOf('---\ntitle: "带 空格 的值"\n---').title, '带 空格 的值');
eq('单引号同样处理', Yaml.metaOf("---\ntitle: 'x y'\n---").title, 'x y');
eq('引号里的 # 不剥', Yaml.metaOf('---\ntitle: "a # b"\n---').title, 'a # b');
eq('裸值的行内注释剥掉', Yaml.metaOf('---\ntitle: a # 批注\n---').title, 'a');
eq('整行注释丢掉', Object.keys(Yaml.metaOf('---\n# 只是注释\ntitle: x\n---')).length, 1);
eq('空值不进 map', Yaml.metaOf('---\ntitle:\nauthor: y\n---').title, undefined);
eq('连字符键名', Yaml.metaOf('---\ntoc-title: 目录\n---')['toc-title'], '目录');
eq('点号键名', Yaml.metaOf('---\nfoo.bar: 1\n---')['foo.bar'], '1');
eq('... 也能闭合', Yaml.metaOf('---\ntitle: x\n...\n').title, 'x');
eq('CRLF 换行', Yaml.metaOf('---\r\ntitle: x\r\nauthor: y\r\n---\r\n').author, 'y');
eq('BOM 开头', Yaml.metaOf('\uFEFF---\ntitle: x\n---').title, 'x');
eq('数字值原样保留', Yaml.metaOf('---\nfontsize: 12\n---').fontsize, '12');
eq('布尔值原样保留', Yaml.metaOf('---\ntoc: true\n---').toc, 'true');

/* ---------------- parseFront / metaOfBlocks ---------------- */
console.log('parseFront 与 blocks 入口');
var pf = Yaml.parseFront('title: a\n# 注释\n\nauthor: b');
eq('parseFront 直接解析正文', pf.title, 'a');
eq('parseFront 跳空行', pf.author, 'b');
var mb = Yaml.metaOfBlocks([{ type: 'frontmatter', raw: '---\ntitle: t\n---' }]);
eq('metaOfBlocks 吃 frontmatter 块', mb.title, 't');
ok('metaOfBlocks 非 frontmatter 返回空', Object.keys(Yaml.metaOfBlocks([{ type: 'para', raw: 'x' }])).length === 0);
ok('metaOfBlocks 空数组不炸', Object.keys(Yaml.metaOfBlocks([])).length === 0);
ok('metaOfBlocks null 不炸', Object.keys(Yaml.metaOfBlocks(null)).length === 0);

/* ---------------- 归一化 ---------------- */
console.log('归一化');
eq('boolOf true', Yaml.boolOf('true'), true);
eq('boolOf TRUE 大小写不敏感', Yaml.boolOf('TRUE'), true);
eq('boolOf yes', Yaml.boolOf('yes'), true);
eq('boolOf 1', Yaml.boolOf('1'), true);
eq('boolOf false', Yaml.boolOf('false'), false);
eq('boolOf 空', Yaml.boolOf(''), false);
eq('boolOf 垃圾值', Yaml.boolOf('maybe'), false);

eq('paperOf a4', Yaml.paperOf('a4'), 'a4');
eq('paperOf A4 大写', Yaml.paperOf('A4'), 'a4');
eq('paperOf letter', Yaml.paperOf('letter'), 'letter');
eq('paperOf a5', Yaml.paperOf('a5'), 'a5');
eq('paperOf legal 不支持', Yaml.paperOf('legal'), '');
eq('paperOf 垃圾', Yaml.paperOf('A9'), '');
eq('paperOf 空', Yaml.paperOf(''), '');

eq('fontsizeOf 11', Yaml.fontsizeOf('11'), '11pt');
eq('fontsizeOf 12pt', Yaml.fontsizeOf('12pt'), '12pt');
eq('fontsizeOf 10PT', Yaml.fontsizeOf('10PT'), '10pt');
eq('fontsizeOf 9 越界', Yaml.fontsizeOf('9'), '');
eq('fontsizeOf 13 越界', Yaml.fontsizeOf('13'), '');
eq('fontsizeOf 垃圾', Yaml.fontsizeOf('abc'), '');

eq('docclassOf article', Yaml.docclassOf('article'), 'article');
eq('docclassOf ctexart', Yaml.docclassOf('ctexart'), 'ctexart');
eq('docclassOf 挡注入', Yaml.docclassOf('article}\\evil'), '');
eq('docclassOf 挡空格', Yaml.docclassOf('art icle'), '');
eq('docclassOf 空', Yaml.docclassOf(''), '');

eq('safeParam 正常几何参数', Yaml.safeParam('margin=2.5cm,top=1in'), 'margin=2.5cm,top=1in');
eq('safeParam 挡反斜杠', Yaml.safeParam('margin=1cm}\\input{x}'), '');
eq('safeParam 挡花括号', Yaml.safeParam('a{b}'), '');
eq('safeParam 挡分号', Yaml.safeParam('a;rm -rf'), '');
eq('safeParam 挡美元', Yaml.safeParam('a$b'), '');
eq('safeParam 空', Yaml.safeParam(''), '');

eq('linestretchOf 1.5', Yaml.linestretchOf('1.5'), '1.5');
eq('linestretchOf 1', Yaml.linestretchOf('1'), '1');
eq('linestretchOf 0 越界', Yaml.linestretchOf('0'), '');
eq('linestretchOf 5 越界', Yaml.linestretchOf('5'), '');
eq('linestretchOf 垃圾', Yaml.linestretchOf('abc'), '');

/* ---------------- overrides 总装 ---------------- */
console.log('overrides 总装');
var o1 = Yaml.overrides([
  '---',
  'title: 主标题',
  'subtitle: 副标题',
  'author: FW',
  'date: 2026-10-18',
  'keywords: 金融, AI; 工程',
  'toc: true',
  'toc-title: 本文目录',
  'papersize: A4',
  'geometry: margin=2cm',
  'fontsize: 12pt',
  'linestretch: 1.5',
  'documentclass: ctexrep',
  '---',
  '',
  '# 正文'
].join('\n'));
eq('title', o1.title, '主标题');
eq('subtitle', o1.subtitle, '副标题');
eq('author', o1.author, 'FW');
eq('date', o1.date, '2026-10-18');
eq('keywords', o1.keywords, '金融, AI; 工程');
eq('toc 布尔化', o1.toc, true);
eq('tocTitle 取到连字符键', o1.tocTitle, '本文目录');
eq('paper 归一化', o1.paper, 'a4');
eq('geometry 保留', o1.geometry, 'margin=2cm');
eq('fontsize 归一化', o1.fontsize, '12pt');
eq('linestretch 归一化', o1.linestretch, '1.5');
eq('docclass 放行', o1.docclass, 'ctexrep');
eq('meta 原始表也在', o1.meta.title, '主标题');

var o2 = Yaml.overrides('---\ntoc: false\npapersize: legal\nfontsize: 9\n---');
eq('toc: false 不生成目录', o2.toc, false);
eq('不支持的纸张回落空', o2.paper, '');
eq('越界字号回落空', o2.fontsize, '');
eq('缺失字段是空串', o2.subtitle, '');
eq('缺失 docclass 是空串', o2.docclass, '');

// 注入尝试：整条 front matter 都坏掉也不能让 geometry 带着反斜杠出去
var o3 = Yaml.overrides('---\ngeometry: "margin=1cm}\\input{/etc/passwd}"\n---');
eq('引号里的注入同样被挡', o3.geometry, '');

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
