// strictparse.test.js —— 第七轮：严格模式的「解析侧」
// 依据 Typora 官方 Strict Mode 文档（support.typora.io/Strict-Mode）两条规则：
//   1. 标题必须在 # 字符后放空白；###Header 严格模式下不是标题，容错档下是。
//   2. 列表项里新开的块/段落必须缩进到与上一段内容对齐的位置，否则不算同一项。
// 纯 Node，不需要 WKWebView。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MD = require(path.join(ROOT, 'app/js/md.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'got: ' + JSON.stringify(actual) + '  want: ' + JSON.stringify(expect));
}
function blockTypes(src, strict) {
  MD.setStrict(!!strict);
  return MD.parse(src).blocks.map(function (b) { return b.type; }).join(',');
}
function firstInline(src, strict) {
  MD.setStrict(!!strict);
  var bs = MD.parse(src).blocks;
  for (var i = 0; i < bs.length; i++) if (bs[i].inline != null) return bs[i].inline;
  return null;
}
function roundtrip(src, strict) {
  MD.setStrict(!!strict);
  return MD.serialize(MD.parse(src)) === src;
}

/* ============================================================ 规则一：# 后必须有空格 */
console.log('严格模式解析侧：ATX 标题');
eq('宽松：###Header 是标题', blockTypes('###Header', false), 'h3');
eq('宽松：标题文本去掉 #', firstInline('###Header', false), 'Header');
eq('严格：###Header 是段落', blockTypes('###Header', true), 'para');
eq('宽松：#Header 是标题', blockTypes('#Header', false), 'h1');
eq('严格：#Header 是段落', blockTypes('#Header', true), 'para');
eq('两档：# 标题 都是标题', blockTypes('# 标题', false) + '|' + blockTypes('# 标题', true), 'h1|h1');
eq('两档：# 单独一行是空标题', blockTypes('#', false) + '|' + blockTypes('#', true), 'h1|h1');
eq('宽松：七个 # 不是标题', blockTypes('#######x', false), 'para');
eq('严格：七个 # 也不是标题', blockTypes('#######x', true), 'para');
eq('宽松：#5 bolt 也按容错当标题', blockTypes('#5 bolt', false), 'h1');
eq('严格：#5 bolt 是段落', blockTypes('#5 bolt', true), 'para');
eq('宽松：闭合序列被剥掉', firstInline('## Title ##', false), 'Title');
eq('宽松：无空格的闭合序列不剥', firstInline('###Header###', false), 'Header###');
ok('宽松：块划分跟着变', blockTypes('###Header\n\n正文', false) === 'h3,para');
ok('严格：块划分跟着变', blockTypes('###Header\n\n正文', true) === 'para,para');

/* ============================================================ 规则二：列表续行对齐 */
console.log('严格模式解析侧：列表续行 / 子列表');
// 官方文档示例：1. aaa + 2 空格 bbb → 严格档不算同一列表
eq('宽松：1. aaa + 2 空格续行 = 一个列表', blockTypes('1. aaa\n  bbb', false), 'list');
eq('严格：1. aaa + 2 空格续行 = 列表 + 段落', blockTypes('1. aaa\n  bbb', true), 'list,para');
eq('宽松：1. aaa + 3 空格续行 = 一个列表', blockTypes('1. aaa\n   bbb', false), 'list');
eq('严格：1. aaa + 3 空格续行 = 一个列表', blockTypes('1. aaa\n   bbb', true), 'list');
eq('宽松：10. aaa + 2 空格子列表 = 一个列表', blockTypes('10. aaa\n  1. ccc', false), 'list');
eq('严格：10. aaa + 2 空格子列表 = 两个列表', blockTypes('10. aaa\n  1. ccc', true), 'list,list');
eq('宽松：10. aaa + 4 空格子列表 = 一个列表', blockTypes('10. aaa\n    1. ccc', false), 'list');
eq('严格：10. aaa + 4 空格子列表 = 一个列表', blockTypes('10. aaa\n    1. ccc', true), 'list');
eq('宽松：1. aaa + 2 空格子列表 = 一个列表', blockTypes('1. aaa\n  1. ccc', false), 'list');
eq('严格：1. aaa + 2 空格子列表 = 两个列表', blockTypes('1. aaa\n  1. ccc', true), 'list,list');
eq('宽松：1. aaa + 3 空格子列表 = 一个列表', blockTypes('1. aaa\n   1. ccc', false), 'list');
eq('严格：1. aaa + 3 空格子列表 = 一个列表', blockTypes('1. aaa\n   1. ccc', true), 'list');
eq('宽松：同级项一个列表', blockTypes('1. aaa\n1. bbb', false), 'list');
eq('严格：同级项一个列表', blockTypes('1. aaa\n1. bbb', true), 'list');
eq('宽松：空行 + 同级项两个块', blockTypes('1. aaa\n\n1. bbb', false), 'list,list');
eq('严格：空行 + 同级项一个列表', blockTypes('1. aaa\n\n1. bbb', true), 'list');
eq('宽松：空行 + 2 空格子列表一个块', blockTypes('1. aaa\n\n  1. ccc', false), 'list');
eq('严格：空行 + 2 空格子列表两个块', blockTypes('1. aaa\n\n  1. ccc', true), 'list,list');
eq('宽松：- 2 空格嵌套一个列表', blockTypes('- a\n  - b\n    - c', false), 'list');
eq('严格：- 2 空格嵌套一个列表', blockTypes('- a\n  - b\n    - c', true), 'list');
eq('严格：- 1 空格不够内容列', blockTypes('- a\n - b', true), 'list,list');
eq('宽松：- 1 空格也算嵌套', blockTypes('- a\n - b', false), 'list');
eq('严格：嵌套内同级项', blockTypes('1. a\n   1. b\n   2. c', true), 'list');
eq('严格：逐级dedent回顶层', blockTypes('1. a\n   1. b\n1. c', true), 'list');
// b 与 c 缩进相同，是同一列表里的兄弟项；a、d 各自挂不上，各成一个块
eq('严格：连续挂不上各成块', blockTypes('1. a\n  1. b\n  1. c\n1. d', true), 'list,list,list');

/* 列表项文本归属：严格档下 2 空格续行不属于上一项 */
console.log('严格模式解析侧：列表项文本归属');
function itemTexts(src, strict) {
  MD.setStrict(!!strict);
  var bs = MD.parse(src).blocks;
  var out = [];
  (function walk(items) {
    items.forEach(function (it) { out.push(it.text); walk(it.children); });
  })(bs[0].items || []);
  return out;
}
eq('宽松：续行并入上一项', itemTexts('1. aaa\n  bbb', false).join('/'), 'aaa\nbbb');
eq('严格：续行另起段，项文本只有 aaa', itemTexts('1. aaa\n  bbb', true).join('/'), 'aaa');
eq('严格：3 空格续行并入上一项', itemTexts('1. aaa\n   bbb', true).join('/'), 'aaa\nbbb');

/* ============================================================ 与其他规则互相作用 */
console.log('严格模式解析侧：相互作用');
eq('严格：ATX 打断列表续行', blockTypes('1. aaa\n# 标题', true), 'list,h1');
eq('宽松：无空格 ATX 也打断列表', blockTypes('1. aaa\n###Header', false), 'list,h3');
eq('严格：引用里的列表不受影响', blockTypes('> 1. a\n>   1. b', true), 'quote');
eq('严格：围栏代码块里的 # 不动', blockTypes('```\n#notitle\n```', true), 'code');
ok('往返：宽松档保持字节级无损', roundtrip('###Header\n\n1. aaa\n  bbb\n\n10. aaa\n  1. ccc', false));
ok('往返：严格档保持字节级无损', roundtrip('###Header\n\n1. aaa\n  bbb\n\n10. aaa\n  1. ccc', true));
ok('往返：嵌套列表两档无损', roundtrip('- a\n  - b\n    - c\n\n1. x\n  2. y', false) &&
  roundtrip('- a\n  - b\n    - c\n\n1. x\n  2. y', true));
MD.setStrict(false);

/* 严格档还要继续关掉扩展语法（第六轮渲染侧 + 本轮解析侧一起看） */
console.log('严格模式解析侧：扩展语法');
MD.setStrict(true);
var ext = MD.parse('> [!NOTE]\n> hi').blocks[0];
eq('严格：callout 不再解析为 callout', String(ext.callout), 'null');
MD.setStrict(false);
var ext2 = MD.parse('> [!NOTE]\n> hi').blocks[0];
eq('宽松：callout 照常解析', String(ext2.callout), 'note');
MD.setStrict(false);

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
