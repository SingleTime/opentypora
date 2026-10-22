/* 行内实时预览：纯逻辑（live.js）
 *
 * 这一层只回答三件事：这块能不能走 live、光标该让哪几段标记露出来、
 * DOM 里改的一笔落在原文的哪个位置。真 WKWebView 里的取值、重画、
 * 组字与撤销在 livedom.test.js。
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Live = require(path.join(ROOT, 'app', 'js', 'live.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      期望 ' + JSON.stringify(String(want)) + '\n      实际 ' + JSON.stringify(String(got))); }
}
function group(n) { console.log('\n' + n); }

/* ---------------------------------------------------------------- 能不能 live */
group('canLive · 只接单行、没有原子的块');

ok('普通中文段落', Live.canLive('一段普通文字。'));
ok('空块也能（新开一个空行就得能打字）', Live.canLive(''));
ok('带行内强调', Live.canLive('一段**粗体**与*斜体*。'));
ok('带删除线与高亮', Live.canLive('~~旧~~ 和 ==亮=='));
ok('标题行（前缀算块标记）', Live.canLive('## 二级标题'));
ok('列表项', Live.canLive('- [ ] 待办一条'));

ok('多行 → 不接', !Live.canLive('第一行\n第二行'));
ok('行内代码 → 不接', !Live.canLive('这里有 `code`'));
ok('链接 → 不接', !Live.canLive('看 [这里](https://a.b)'));
ok('图片 → 不接', !Live.canLive('![图](a.png)'));
ok('公式 → 不接', !Live.canLive('写成 $x^2$ 的样子'));
ok('行内 HTML → 不接', !Live.canLive('这是 <b>标签</b>'));
ok('表格竖线 → 不接', !Live.canLive('a | b'));
ok('反斜杠转义 → 不接', !Live.canLive('转义 \\* 星号'));
ok('超长块 → 不接', !Live.canLive(new Array(Live.MAX + 2).join('字')));
ok('刚好上限 → 接', Live.canLive(new Array(Live.MAX).join('字')));

/* ---------------------------------------------------------------- 扫描标记 */
group('scan · 标记与内容的精确区间');

const t1 = Live.scan('一段**粗体**文字。');
eq('只切出一段', t1.length, 1);
eq('kind', t1[0].kind, 'strong');
eq('start', t1[0].start, 2);
eq('end', t1[0].end, 8);
eq('开标记长度', t1[0].m1, 2);
eq('闭标记长度', t1[0].m2, 2);
eq('内容区间', t1[0].innerStart + '-' + t1[0].innerEnd, '4-6');

const t2 = Live.scan('**a *b* c**');
eq('嵌套：外层 + 内层两段', t2.length, 2);
eq('外层是 strong', t2[0].kind, 'strong');
eq('内层是 em', t2[1].kind, 'em');
eq('内层位置', t2[1].start + '-' + t2[1].end, '4-7');

const t3 = Live.scan('~~删~~ ==亮== *斜* ^上^ ~下~');
eq('五种标记都认得', t3.map(function (x) { return x.kind; }).join(','), 'del,mark,em,sup,sub');

eq('不成对 → 空', Live.scan('孤零零的 ** 两个星').length, 0);
eq('强调里不许为空', Live.scan('****').length, 0);
eq('空串 → 空', Live.scan('').length, 0);
eq('下划线强调', Live.scan('__下划线__')[0].kind, 'strong');
eq('单下划线斜体', Live.scan('_斜_')[0].kind, 'em');

/* ---------------------------------------------------------------- 该露哪几段 */
group('reveal · 光标进了哪段就露哪段');

eq('光标在外面 → 不露', Live.reveal('一段**粗体**文字。', 1).length, 0);
eq('光标正好在开标记前 → 不露', Live.reveal('一段**粗体**文字。', 2).length, 0);
eq('光标在开标记之后 → 露', Live.reveal('一段**粗体**文字。', 3).length, 1);
eq('光标在内容里 → 露', Live.reveal('一段**粗体**文字。', 5).length, 1);
eq('光标在闭标记之后 → 不露', Live.reveal('一段**粗体**文字。', 8).length, 0);
eq('嵌套里 → 两层都露', Live.reveal('**a *b* c**', 6).length, 2);
eq('嵌套但光标在外层内容里 → 只露外层', Live.reveal('**a *b* c**', 3).length, 1);
eq('没有 caret → 不露', Live.reveal('**a**', null).length, 0);

/* ---------------------------------------------------------------- 块前缀 */
group('prefix · 块前缀长度');

eq('二级标题', Live.prefix('## 标题'), 3);
eq('无序列表', Live.prefix('- 一条'), 2);
eq('任务列表', Live.prefix('- [ ] 一条'), 6);
eq('已完成', Live.prefix('- [x] 一条'), 6);
eq('有序列表', Live.prefix('12. 一条'), 4);
eq('引用', Live.prefix('> 引用'), 2);
eq('引用里套列表', Live.prefix('> - 一条'), 4);
eq('普通段落没有前缀', Live.prefix('一段文字'), 0);
eq('星号列表不会被当成强调', Live.prefix('* 一条'), 2);

/* 前缀是哪种：只有标题的 # 会藏，列表/引用带缩进语义照原样显示 */
group('prefixKind · 哪种前缀可以藏');

eq('一级标题', Live.prefixKind('# 标题'), 'heading');
eq('六级标题', Live.prefixKind('###### 标题'), 'heading');
eq('缩进的标题', Live.prefixKind('  ## 标题'), 'heading');
eq('无序列表', Live.prefixKind('- 一条'), 'list');
eq('有序列表', Live.prefixKind('12. 一条'), 'list');
eq('任务列表', Live.prefixKind('- [ ] 一条'), 'list');
eq('引用不是标题', Live.prefixKind('> 引用'), '');
eq('引用里的列表', Live.prefixKind('> - 一条'), 'list');
eq('普通段落', Live.prefixKind('一段文字'), '');
eq('空串', Live.prefixKind(''), '');
eq('七级不过界', Live.prefixKind('####### 标题'), '');
eq('标题里的强调不受影响', Live.prefixKind('## **粗**'), 'heading');
eq('前缀长度对得上', Live.prefix('## **粗**') + '/' + Live.prefix('###### 标题'), '3/7');

/* ---------------------------------------------------------------- 文本差分 */
group('diff · 一笔改动落在哪儿');

eq('相同 → null', Live.diff('abc', 'abc'), null);
const d1 = Live.diff('一段文字。', '一段新文字。');
eq('插入位置', d1.a, 2);
eq('没删东西', d1.removed, 0);
eq('插入内容', d1.ins, '新');

const d2 = Live.diff('一段新文字。', '一段文字。');
eq('删除位置', d2.a, 2);
eq('删了一个字', d2.removed, 1);
eq('没插入', d2.ins, '');

const d3 = Live.diff('abcXdef', 'abcYdef');
eq('替换算成一删一插', d3.removed + '/' + d3.ins, '1/Y');

const d4 = Live.diff('', '甲乙');
eq('空串插入', d4.a + '/' + d4.removed + '/' + d4.ins, '0/0/甲乙');
const d5 = Live.diff('甲乙', '');
eq('全删', d5.a + '/' + d5.removed, '0/2');
eq('公共前后缀不吞进改动', JSON.stringify(Live.diff('aaXbb', 'aaYbb')), JSON.stringify({ a: 2, removed: 1, ins: 'Y' }));

/* ---------------------------------------------------------------- 落到原文 */
group('applyEdit · 一次编辑落到原文');

eq('插入', Live.applyEdit('一段文字。', 2, 2, '新').raw, '一段新文字。');
eq('插入后光标', Live.applyEdit('一段文字。', 2, 2, '新').caret, 3);
eq('替换', Live.applyEdit('一段文字。', 2, 4, '新').raw, '一段新。');
eq('删除', Live.applyEdit('一段文字。', 2, 4, '').raw, '一段。');
eq('越界会被夹住', Live.applyEdit('abc', -5, 99, 'X').raw, 'X');
eq('s>e 会自动换过来', Live.applyEdit('abcdef', 4, 2, '').raw, 'abef');

// 把强调的内容删空 → 那对标记也该跟着走，不然留下字面的 ****
eq('删空强调内容，标记一起清掉', Live.applyEdit('一段****文字。', 2, 6, '').raw, '一段文字。');
eq('清理后光标', Live.applyEdit('一段****文字。', 2, 6, '').caret, 2);
eq('留着空格的空强调也清', Live.cleanupAt('x**  **y', 4).raw, 'xy');
eq('清理时光标跟着回退', Live.cleanupAt('x**  **y', 4).caret, 1);
eq('正文里的强调不受影响', Live.applyEdit('**粗体**', 2, 4, '粗').raw, '**粗**');
eq('纯插入不动原文里的连续星号', Live.applyEdit('a******b', 1, 1, '').raw, 'a******b');

/* ---------------------------------------------------------------- 不可变 */
group('纯函数 · 不改入参');

const before = '一段**粗体**文字。';
Live.scan(before);
Live.reveal(before, 5);
Live.prefix(before);
Live.applyEdit(before, 2, 2, 'X');
Live.cleanupAt(before, 4);
Live.diff(before, 'x');
eq('原文没被改', before, '一段**粗体**文字。');

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
