// strict.test.js —— 第六轮补齐项：严格模式 / Emoji 补全 / Text Snippet / 表格拖动排序 / HTML 导出选项
// 纯 Node，不需要 WKWebView。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MD = require(path.join(ROOT, 'app/js/md.js'));
const Inline = require(path.join(ROOT, 'app/js/inline.js'));
const Table = require(path.join(ROOT, 'app/js/table.js'));
const Export = require(path.join(ROOT, 'app/js/export.js'));
const Snippets = require(path.join(ROOT, 'app/js/snippet.js'));
const EmojiPick = require(path.join(ROOT, 'app/js/emoji.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'got: ' + JSON.stringify(actual) + '  want: ' + JSON.stringify(expect));
}
function has(name, text, re) {
  ok(name, re.test(String(text)), (String(text).match(re) || ['(无匹配)'])[0]);
}
function html(src) {
  const m = MD.parse(src);
  return MD.renderBlocks(m.blocks, true);
}

/* ============================================================ 严格模式 */
console.log('严格模式：开关');
eq('默认关闭', MD.isStrict(), false);
MD.setStrict(true);
eq('setStrict(true) 生效', MD.isStrict(), true);
MD.setStrict(false);
eq('setStrict(false) 复位', MD.isStrict(), false);

console.log('严格模式：渲染差异');
const EX = [
  '# 标题', '',
  '高亮 ==x==、上标 a^2^、下标 H~2~O、表情 :smile:、链接 [[笔记]]。', '',
  '> [!NOTE]', '> 这是一条提示', '',
  '正文 **粗体**。', ''
].join('\n');
MD.setStrict(false);
const loose = html(EX);
has('宽松：高亮', loose, /<mark[^>]*>[\s\S]*?x[\s\S]*?<\/mark>/);
has('宽松：上标', loose, /<sup[^>]*>[\s\S]*?2[\s\S]*?<\/sup>/);
has('宽松：下标', loose, /<sub[^>]*>[\s\S]*?2[\s\S]*?<\/sub>/);
has('宽松：emoji', loose, /class="emoji"/);
has('宽松：wiki 链接', loose, /class="wiki-link"/);
has('宽松：callout', loose, /blk quote callout/);
has('宽松：粗体', loose, /<strong[^>]*>[\s\S]*?粗体[\s\S]*?<\/strong>/);
MD.setStrict(true);
const strict = html(EX);
ok('严格：高亮退成字面', /==x==/.test(strict) && !/<mark/.test(strict));
ok('严格：上下标退成字面', /a\^2\^/.test(strict) && /H~2~O/.test(strict) && !/<sup|<sub/.test(strict));
ok('严格：emoji 退成字面', /:smile:/.test(strict) && !/class="emoji"/.test(strict));
ok('严格：wiki 退成字面', /\[\[笔记\]\]/.test(strict) && !/class="wiki-link"/.test(strict));
ok('严格：callout 退成引用', !/blk quote callout/.test(strict) && /<blockquote/.test(strict));
has('严格：粗体照常', strict, /<strong[^>]*>[\s\S]*?粗体[\s\S]*?<\/strong>/);
MD.setStrict(false);

console.log('严格模式：tokenize 一致');
const L = Inline.tokenize('==x== a^2^ H~2~O :smile: [[笔记]]');
eq('宽松 token 类型', L.map(t => t.t).join(','), 'mark,text,sup,text,sub,text,wiki');
eq('宽松 emoji 已化开成字形', L[5].v, 'O 😄 ');
MD.setStrict(true);
const S = Inline.tokenize('==x== a^2^ H~2~O :smile: [[笔记]]');
eq('严格 token 全是文本', S.every(t => t.t === 'text'), true);
eq('严格文本原样', S.map(t => t.v).join(''), '==x== a^2^ H~2~O :smile: [[笔记]]');
MD.setStrict(false);

console.log('严格模式：导出器跟着走');
// docx/odt/textfmt 都吃 Inline.tokenize，严格模式下不能把 ==x== 变成高亮
MD.setStrict(true);
const wt = require(path.join(ROOT, 'app/js/textfmt.js'));
const wiki = wt.mediawiki('==x== a^2^ :smile:', {});
ok('MediaWiki 导出不吃高亮', !/'''x'''/.test(wiki.text) && /==x==/.test(wiki.text), wiki.text);
const rst = wt.rst('==x== a^2^ :smile:', {});
ok('RST 导出不吃高亮', !/\*\*x\*\*/.test(rst.text) && /==x==/.test(rst.text), rst.text);
MD.setStrict(false);

/* ============================================================ Emoji 补全 */
console.log('Emoji 补全：数据');
{
  const names = MD.emojiNames();
  ok('名字表非空', names.length > 100, String(names.length));
  ok('名字表已排序', names.slice().sort().join() === names.join());
  eq('smile 有字形', MD.emojiOf('smile').length > 0, true);
  eq('查不到返回空', MD.emojiOf('不存在的名字'), '');
  eq('大小写不敏感', MD.emojiOf('SMILE'), MD.emojiOf('smile'));
}

console.log('Emoji 补全：match 打分');
{
  const names = MD.emojiNames();
  const hit = EmojiPick.match('sm', names, 5);
  ok('前缀命中排最前', hit.length > 0 && hit[0].name.indexOf('sm') === 0, hit.map(h => h.name).join(','));
  ok('limit 生效', EmojiPick.match('a', names, 3).length === 3);
  eq('空查询返回空', EmojiPick.match('', names).length, 0);
  const all = EmojiPick.match('smile', names);
  ok('完全匹配排第一', all[0].name === 'smile', all.map(a => a.name).join(','));
  ok('词段命中优于中间命中', EmojiPick.match('heart', names)[0].name.indexOf('heart') === 0);
}

console.log('Emoji 补全：触发判定');
eq('普通触发', JSON.stringify(EmojiPick.triggerAt('说 :smi', 6)), JSON.stringify({ start: 2, query: 'smi' }));
eq('段首触发', JSON.stringify(EmojiPick.triggerAt(':smile', 6)), JSON.stringify({ start: 0, query: 'smile' }));
eq('换行后触发', JSON.stringify(EmojiPick.triggerAt('a\n:smi', 6)), JSON.stringify({ start: 2, query: 'smi' }));
eq('时间不触发', EmojiPick.triggerAt('12:30', 5), null);
eq('URL 不触发', EmojiPick.triggerAt('http://a', 8), null);
eq('字母后不触发', EmojiPick.triggerAt('ab:smi', 6), null);
eq('双冒号不触发', EmojiPick.triggerAt('a::smi', 6), null);
eq('没有冒号不触发', EmojiPick.triggerAt('说 smile', 9), null);
eq('空格后触发', EmojiPick.triggerAt('a :smi', 6) && EmojiPick.triggerAt('a :smi', 6).query, 'smi');

console.log('Emoji 补全：代码里不弹');
eq('行内代码中', EmojiPick.inCode('a `:sm', 6), true);
eq('行内代码外', EmojiPick.inCode('a `x` :sm', 9), false);
eq('围栏块内', EmojiPick.inCode('```js\n:sm', 8), true);
eq('围栏块外', EmojiPick.inCode('```\nx\n```\n:sm', 11), false);

/* ============================================================ Text Snippet */
console.log('Text Snippet：解析');
{
  const list = Snippets.parseSnippets([
    '# 注释',
    '',
    'sig => 此致\\n敬礼\\n\\n$0',
    'brb => be right back',
    'bad 词 => x',
    'nosuch',
    'tab => a\\tb'
  ].join('\n'));
  eq('只收合法三条', list.length, 3);
  eq('触发词', list.map(s => s.t).join(','), 'sig,brb,tab');
  eq('换行展开', list[0].b, '此致\n敬礼\n\n$0');
  eq('制表符展开', list[2].b, 'a\tb');
  const dup = Snippets.parseSnippets('a => 1\na => 2');
  eq('重复触发词后者覆盖', dup.length + ':' + dup[0].b, '1:2');
  eq('空输入', Snippets.parseSnippets('').length, 0);
}

console.log('Text Snippet：序列化往返');
{
  const src = 'sig => 此致\\n敬礼\\n$0\nbrb => be right back';
  const list = Snippets.parseSnippets(src);
  eq('往返一致', Snippets.serialSnippets(list), src);
  const weird = 'x => 反斜杠\\\\与制表\\t与换行\\n';
  eq('特殊字符往返', Snippets.serialSnippets(Snippets.parseSnippets(weird)), weird);
}

console.log('Text Snippet：展开');
eq('命中展开', JSON.stringify(Snippets.expand('你好 brb', 6, Snippets.parseSnippets('brb => be right back'))),
  JSON.stringify({ text: '你好 be right back', caret: 16, snippet: { t: 'brb', b: 'be right back' } }));
{
  const r = Snippets.expand('sig', 3, Snippets.parseSnippets('sig => 此致\\n敬礼\\n\\n$0'));
  eq('$0 落点', r.caret, r.text.indexOf('$0') >= 0 ? -1 : r.text.length);
  eq('$0 被吃掉', /\$0/.test(r.text), false);
  eq('内容插入', r.text, '此致\n敬礼\n\n');
}
eq('不命中返回 null', Snippets.expand('hello', 5, Snippets.parseSnippets('brb => x')), null);
eq('空表返回 null', Snippets.expand('brb', 3, []), null);
eq('词边界：前缀不算', Snippets.expand('xbrb', 4, Snippets.parseSnippets('brb => x')), null);
eq('中文触发词', Snippets.expand('签名', 2, Snippets.parseSnippets('签名 => 此致')) &&
  Snippets.expand('签名', 2, Snippets.parseSnippets('签名 => 此致')).text, '此致');
eq('光标在词中不展开', Snippets.expand('brb', 2, Snippets.parseSnippets('brb => x')), null);
eq('词定位', JSON.stringify(Snippets.wordBefore('ab cd', 5)), JSON.stringify({ start: 3, word: 'cd' }));

/* ============================================================ 表格拖动排序 */
console.log('表格拖动：moveRow / moveCol 纯函数');
{
  const m = {
    head: ['A', 'B', 'C'], aligns: ['', '>', ''], widths: [5, 6, 7],
    rows: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]
  };
  eq('行 0 → 2', (Table.moveRow(m, 0, 2), JSON.stringify(m.rows)), '[["4","5","6"],["7","8","9"],["1","2","3"]]');
  eq('行 2 → 0（搬回去）', (Table.moveRow(m, 2, 0), JSON.stringify(m.rows)), '[["1","2","3"],["4","5","6"],["7","8","9"]]');
  eq('原地不动返回 false', Table.moveRow(m, 1, 1), false);
  eq('越界夹到末行', (Table.moveRow(m, 0, 9), JSON.stringify(m.rows[m.rows.length - 1])), '["1","2","3"]');
  Table.moveRow(m, 2, 0);
  eq('负下标夹到首行', (Table.moveRow(m, 2, -1), JSON.stringify(m.rows[0])), '["7","8","9"]');
  Table.moveRow(m, 0, 2);
  eq('空表返回 false', Table.moveRow({ rows: [] }, 0, 1), false);
  eq('行数不变', m.rows.length, 3);

  const n = {
    head: ['A', 'B', 'C'], aligns: ['', '>', ''], widths: [5, 6, 7],
    rows: [['1', '2', '3'], ['4', '5', '6']]
  };
  Table.moveCol(n, 0, 2);
  eq('列头跟着搬', JSON.stringify(n.head), '["B","C","A"]');
  eq('对齐跟着搬', JSON.stringify(n.aligns), '[">","",""]');
  eq('宽度跟着搬', JSON.stringify(n.widths), '[6,7,5]');
  eq('每行都搬', JSON.stringify(n.rows), '[["2","3","1"],["5","6","4"]]');
  eq('列数不变', n.head.length + ':' + n.rows[0].length, '3:3');
  eq('列原地不动', Table.moveCol(n, 1, 1), false);
}

console.log('表格拖动：插入位换算');
eq('往后拖：插入位 3 → 结果 2', Table.dropIndex(0, 3), 2);
eq('往前拖：插入位 0 → 结果 0', Table.dropIndex(2, 0), 0);
eq('原地：插入位 1 → 结果 1', Table.dropIndex(1, 1), 1);
eq('插到自己后面一格', Table.dropIndex(1, 2), 1);

/* ============================================================ HTML 导出选项 */
console.log('HTML 导出：选项归一化');
eq('默认带样式不限宽 false', JSON.stringify(Export.htmlOptions({})),
  JSON.stringify({
    styles: true, embed: false, width: true, theme: 'github', themeFile: '', title: '',
    author: '', keywords: '', description: '', date: '',
    head: '', tail: '', font: '', leading: '', bg: ''
  }));
eq('显式关样式', Export.htmlOptions({ styles: false }).styles, false);
eq('显式关限宽', Export.htmlOptions({ width: false }).width, false);
eq('开内嵌', Export.htmlOptions({ embed: true }).embed, true);
eq('标题转义', Export.htmlOptions({ title: 'a<b>&"c' }).title, 'a<b>&"c');

console.log('HTML 导出：包壳');
{
  const doc = Export.htmlDoc('<p>正文</p>', { title: 'T', width: true });
  ok('有 DOCTYPE', /^<!DOCTYPE html>/.test(doc));
  ok('标题进 <title>', /<title>T<\/title>/.test(doc));
  ok('正文进 .editor', /<div class="editor"[^>]*><p>正文<\/p><\/div>/.test(doc));
  ok('限宽带行内样式', /max-width:830px/.test(doc));
  ok('不限宽不带行内样式', !/max-width/.test(Export.htmlDoc('<p>x</p>', { width: false })));
  ok('viewport', /name="viewport"/.test(doc));
  ok('标题被转义', /<title>&lt;b&gt;<\/title>/.test(Export.htmlDoc('', { title: '<b>' })));
}

console.log('HTML 导出：图片引用与回填');
{
  const h = '<img src="assets/a.png"><img src="assets/a.png"><img src="b.jpg">' +
    '<img src="data:image/png;base64,xx"><img src="https://x/y.png"><img src="//cdn/z.png">' +
    '<img src="blob:abc"><img src="file:///tmp/q.png"><img alt="无 src">';
  eq('只收本地相对引用且去重', JSON.stringify(Export.imageRefs(h)), '["assets/a.png","b.jpg"]');
  eq('空文档', Export.imageRefs('').length, 0);
  eq('单引号也认', JSON.stringify(Export.imageRefs("<img src='c.png'>")), '["c.png"]');
  const mapped = Export.applyImageMap('<img src="a.png"><img src="b.png">', { 'a.png': 'data:x' });
  eq('命中的换掉', mapped, '<img src="data:x"><img src="b.png">');
  eq('空 map 原样', Export.applyImageMap('<img src="a.png">', null), '<img src="a.png">');
}

console.log('HTML 导出：data URI');
eq('png MIME', Export.dataUri('a/b.png', 'QQ=='), 'data:image/png;base64,QQ==');
eq('jpg MIME', Export.dataUri('a.jpg', 'QQ=='), 'data:image/jpeg;base64,QQ==');
eq('svg MIME', Export.dataUri('i.svg', 'QQ=='), 'data:image/svg+xml;base64,QQ==');
eq('未知扩展名兜底', Export.dataUri('a.xyz', 'QQ=='), 'data:application/octet-stream;base64,QQ==');
eq('带查询串也认扩展名', Export.dataUri('a.png?v=2', 'QQ=='), 'data:image/png;base64,QQ==');

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
