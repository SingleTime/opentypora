/* 版式三件套（字体 / 行距 / 背景）：纯函数 + CSS 对齐
 *
 * 这一层只做「偏好值 → CSS 变量表」的翻译，不碰 DOM。DOM 那侧
 * （变量真落进 :root、计算样式真的变、换主题不被冲掉）在 typodom.test.js。
 * 这里额外盯两件事：app.css 的默认行高必须与 DEFAULT_LEADING 一致，
 * 以及字体族里不能出现双引号（导出时写进 style="…" 会把属性截断）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Typo = require(path.join(ROOT, 'app', 'js', 'typography.js'));
const Export = require(path.join(ROOT, 'app', 'js', 'export.js'));

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

/* ---------------------------------------------------------------- 字体表 */

group('FONTS · 预设表');
const ids = Typo.FONTS.map(f => f.id);
eq('八个预设', Typo.FONTS.length, 8);
eq('id 不重复', new Set(ids).size, ids.length);
ok('第一项是系统默认', Typo.FONTS[0].id === 'system');
eq('系统默认不覆盖字体（stack 为空）', Typo.FONTS[0].stack, '');
ok('每一项都有中文标签', Typo.FONTS.every(f => f.label && f.label.length > 0));
ok('预设 id 都是小写字母', Typo.FONTS.every(f => /^[a-z]+$/.test(f.id)));
ok('除系统默认与自定义，其余都带 stack',
  Typo.FONTS.filter(f => f.stack !== '').map(f => f.id).join(','),
  'pingfang,songti,kaiti,fangsong,yuanti,mono');
ok('字体族里没有双引号（会截断导出的 style 属性）',
  Typo.FONTS.every(f => f.stack.indexOf('"') < 0));
ok('字体族都以通用族收尾', Typo.FONTS.filter(f => f.stack).every(f => /(sans-serif|serif|monospace)$/.test(f.stack)));
ok('fontById 认得宋体', Typo.fontById('songti').label === '宋体');
ok('fontById 不认的给 null', Typo.fontById('nope') === null);

/* ---------------------------------------------------------------- pickFont */

group('pickFont · 偏好值归一化');
eq('空串 → 系统默认', Typo.pickFont('').id, 'system');
eq('null → 系统默认', Typo.pickFont(null).id, 'system');
eq('undefined → 系统默认', Typo.pickFont().id, 'system');
eq('预设 id 直接用', Typo.pickFont('songti').id, 'songti');
ok('预设 id 带上字体族', Typo.pickFont('songti').stack.indexOf('Songti SC') > 0);
eq('预设不算自定义', Typo.pickFont('songti').custom, false);
eq('前后空白忽略', Typo.pickFont('  kaiti  ').id, 'kaiti');
eq('不认的 id 回落系统默认', Typo.pickFont('songtii').id, 'system');
eq('custom: 带字体族', Typo.pickFont("custom:'Iowan Old Style', Georgia, serif").id, 'custom');
eq('custom 标记为自定义', Typo.pickFont("custom:Georgia").custom, true);
eq('custom: 后面空着也算自定义（UI 刚选中的状态）', Typo.pickFont('custom:').id, 'custom');
eq('custom: 后面空着就不覆盖', Typo.pickFont('custom:').stack, '');
eq('裸 custom（下拉值）也算自定义', Typo.pickFont('custom').id, 'custom');

group('pickFont · 自定义字体族的清洗');
eq('分号被清掉（逃不出声明）', Typo.pickFont('custom:Georgia;color:red').stack, 'Georgiacolor:red');
eq('花括号被清掉', Typo.pickFont('custom:Georgia}body{').stack, 'Georgiabody');
eq('尖括号被清掉（防注入）', Typo.pickFont('custom:Geo<script>rgia').stack, 'Geoscriptrgia');
eq('双引号统一成单引号', Typo.pickFont('custom:"Songti SC", serif').stack, "'Songti SC', serif");
eq('换行折成空格', Typo.pickFont('custom:Georgia,\nserif').stack, 'Georgia, serif');
eq('连续空白折叠', Typo.pickFont('custom:  Georgia   ,   serif  ').stack, 'Georgia , serif');
ok('超长截断到 160 字符以内', Typo.cleanStack('x'.repeat(400)).length <= 160);
eq('全是非法字符时等于没填', Typo.pickFont('custom:;;;').stack, '');

/* ---------------------------------------------------------------- 行距 */

group('normLeading · 行距');
eq('默认 1.72', Typo.normLeading(''), 1.72);
eq('undefined 取默认', Typo.normLeading(), 1.72);
eq('null 取默认', Typo.normLeading(null), 1.72);
eq('垃圾字符串取默认', Typo.normLeading('abc'), 1.72);
eq('字符串数字能认', Typo.normLeading('1.9'), 1.9);
eq('下界夹住', Typo.normLeading(0.5), 1.3);
eq('上界夹住', Typo.normLeading(9), 2.4);
eq('边界值本身保留', Typo.normLeading(2.4), 2.4);
eq('两位小数', Typo.normLeading(1.8543219), 1.85);
eq('负值夹到下界', Typo.normLeading(-2), 1.3);
eq('Infinity 取默认', Typo.normLeading(Infinity), 1.72);
eq('NaN 取默认', Typo.normLeading(NaN), 1.72);

group('lhScale · 标题行高的缩放比例');
eq('默认就是 1（排版逐像素不变）', Typo.lhScale(1.72), 1);
eq('2.4 倍率', Typo.lhScale(2.4), 1.3953);
eq('1.72 附近不乱跳', Typo.lhScale(1.72), 1);
eq('空值等于默认', Typo.lhScale(''), 1);
ok('比例随行距单调增', Typo.lhScale(1.9) > Typo.lhScale(1.72) && Typo.lhScale(2.1) > Typo.lhScale(1.9));

/* ---------------------------------------------------------------- 背景 */

group('normBg · 背景色');
eq('空串 = 跟随主题', Typo.normBg(''), '');
eq('null = 跟随主题', Typo.normBg(null), '');
eq('theme 关键字', Typo.normBg('theme'), '');
eq('none 关键字', Typo.normBg('none'), '');
eq('六位小写', Typo.normBg('#fff8c5'), '#fff8c5');
eq('三位展开', Typo.normBg('#abc'), '#aabbcc');
eq('不带井号也认', Typo.normBg('AABBCC'), '#aabbcc');
eq('三位不带井号', Typo.normBg('f0f'), '#ff00ff');
eq('前后空白', Typo.normBg('  #101418  '), '#101418');
eq('非法值 = 跟随主题', Typo.normBg('red'), '');
eq('长度不对 = 跟随主题', Typo.normBg('#ff00'), '');
eq('混进非法字符 = 跟随主题', Typo.normBg('#gggggg'), '');

/* ---------------------------------------------------------------- 变量表 */

group('vars · 落到 :root 的变量');
const v = Typo.vars({ font: 'songti', leading: 2, bg: '#f5f3ee' });
const vmap = {};
v.forEach(p => { vmap[p[0]] = p[1]; });
eq('四条变量', v.length, 4);
eq('--font-body 取预设字体族', vmap['--font-body'].indexOf('Songti SC') > 0, true);
eq('--leading 是行高', vmap['--leading'], '2');
eq('--lh-scale 同步算好', vmap['--lh-scale'], '1.1628');
eq('--bg 归一化', vmap['--bg'], '#f5f3ee');
eq('顺序固定（font / leading / lh-scale / bg）',
  v.map(p => p[0]).join(','), '--font-body,--leading,--lh-scale,--bg');

const v0 = Typo.vars({});
eq('默认时字体是空串（= 清除覆盖）', v0[0][1], '');
eq('默认行距写 1.72', v0[1][1], '1.72');
eq('默认缩放是 1', v0[2][1], '1');
eq('默认背景是空串（= 跟随主题）', v0[3][1], '');
eq('空对象也不炸', Typo.vars().length, 4);

/* ---------------------------------------------------------------- 导出 */

group('styleOf · 导出 HTML 的行内变量');
eq('全默认时什么都不写', Typo.styleOf({}), '');
eq('只调行距', Typo.styleOf({ leading: 1.9 }), '--leading:1.9;--lh-scale:1.1047');
eq('只换字体', Typo.styleOf({ font: 'kaiti' }), "--font-body:'Kaiti SC', 'STKaiti', 'KaiTi', serif");
eq('只改背景', Typo.styleOf({ bg: '#101418' }), '--bg:#101418');
eq('三样一起，顺序是字体/行距/背景',
  Typo.styleOf({ font: 'mono', leading: 2, bg: '#fff8c5' }).split(';')[0].indexOf('--font-body') === 0, true);
ok('没有收尾分号', !/;$/.test(Typo.styleOf({ bg: '#101418' })));
ok('不含双引号', Typo.styleOf({ font: "custom:Georgia, 'Times New Roman', serif" }).indexOf('"') < 0);
ok('自定义字体里的分号进不来',
  Typo.styleOf({ font: 'custom:Georgia;background:red' }).indexOf(';background') < 0);

/* ---------------------------------------------------------------- 导出接线 */

group('htmlDoc · 版式写进 <html> 的行内样式');
const plain = Export.htmlDoc('<p>x</p>', { title: 'T' });
ok('默认文档不多一坨 style', plain.indexOf('<html data-theme="github" class="opentypora-export">') > 0, plain.split('\n')[1]);
const styled = Export.htmlDoc('<p>x</p>', { title: 'T', font: 'songti', leading: 2, bg: '#101418' });
ok('调过之后带上 style 属性', /<html data-theme="github" class="opentypora-export" style="[^"]+">/.test(styled), styled.split('\n')[1]);
ok('字体进了 style', styled.indexOf('--font-body:') > 0);
ok('行距进了 style', styled.indexOf('--leading:2') > 0);
ok('背景进了 style', styled.indexOf('--bg:#101418') > 0);
ok('style 属性没有双引号被截断', styled.indexOf('style="--font-body:') > 0);
const t2 = Object.assign({}, Export.htmlOptions({ font: 'kaiti', leading: 1.9, bg: '#abc' }));
eq('htmlOptions 透传 font', t2.font, 'kaiti');
eq('htmlOptions 透传 leading', t2.leading, 1.9);
eq('htmlOptions 透传 bg', t2.bg, '#abc');
eq('htmlOptions 缺省是空串', Export.htmlOptions({}).font, '');
eq('htmlOptions 缺省 leading 是空串', Export.htmlOptions({}).leading, '');
eq('htmlOptions 缺省 bg 是空串', Export.htmlOptions({}).bg, '');

/* ---------------------------------------------------------------- CSS */

group('app.css · 行距与字体真的接到变量上');
const css = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');
ok('body 行高走 --leading', /body \{[^}]*line-height:\s*var\(--leading,\s*1\.72\)/.test(css));
ok('body 行高的兜底就是 DEFAULT_LEADING',
  /var\(--leading,\s*1\.72\)/.test(css) && Typo.DEFAULT_LEADING === 1.72);
ok('h1 行高按比例缩放', /\.blk\.h1 \{[^}]*line-height:\s*calc\(1\.3 \* var\(--lh-scale,\s*1\)\)/.test(css));
ok('h2 行高按比例缩放', /\.blk\.h2 \{[^}]*line-height:\s*calc\(1\.35 \* var\(--lh-scale,\s*1\)\)/.test(css));
ok('h3 行高按比例缩放', /\.blk\.h3 \{[^}]*line-height:\s*calc\(1\.4 \* var\(--lh-scale,\s*1\)\)/.test(css));
ok('代码块行高写死（行号按固定行高对齐）',
  /\.blk\.code pre \{[^}]*line-height:\s*1\.62/.test(css));
ok('代码块没跟着 --leading 缩放', !/\.blk\.code pre \{[^}]*--leading/.test(css));
ok('编辑态 textarea 继承行高（进出编辑不跳动）',
  /textarea\.src \{[^}]*line-height:\s*inherit/.test(css));
ok('字体走 --font-body', /html, body \{[^}]*font-family:\s*var\(--font-body\)/.test(css) ||
  /font-family:\s*var\(--font-body\)/.test(css));
ok('背景走 var(--bg)', /background:\s*var\(--bg\)/.test(css));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
