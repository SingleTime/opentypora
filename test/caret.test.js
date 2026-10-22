/* 光标行几何：纯函数 + 接线
 *
 * 打字机模式的「居中」和专注模式的「近邻 / 高亮条」都靠这几个函数算。
 * 这里只测 Node 能算的部分；真实位置（软换行折到第几行）留给
 * caredom.test.js —— 折行只有真排版知道，镜像 div 量出来的 y 必须
 * 和 textarea 里光标实际所在的行对上。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Caret = require(path.join(ROOT, 'app', 'js', 'caret.js'));

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

/* ---------------------------------------------------------------- 行号 */

group('lineIndex · 光标在第几个逻辑行');
eq('开头', Caret.lineIndex('a\nb\nc', 0), 0);
eq('第一行末（\n 之前）', Caret.lineIndex('a\nb\nc', 1), 0);
eq('换行符之后即第二行', Caret.lineIndex('a\nb\nc', 2), 1);
eq('文末', Caret.lineIndex('a\nb\nc', 5), 2);
eq('空文档', Caret.lineIndex('', 0), 0);
eq('只有换行', Caret.lineIndex('\n', 1), 1);
eq('连续空行', Caret.lineIndex('a\n\n\nb', 4), 3);
eq('CRLF 只认 \\n（\\r 属于上一行）', Caret.lineIndex('a\r\nb', 3), 1);
eq('越界 pos 夹到末尾', Caret.lineIndex('a\nb', 999), 1);
eq('负数 pos 当 0', Caret.lineIndex('a\nb', -5), 0);
eq('pos 为空取末尾', Caret.lineIndex('a\nb\nc', null), 2);

group('lineBounds · 每行的字符区间');
(function () {
  const t = 'aa\nbbb\nc';
  const a = Caret.lineBounds(t, 0), b = Caret.lineBounds(t, 1), c = Caret.lineBounds(t, 2);
  eq('第 0 行 [0,2)', a.start + ',' + a.end, '0,2');
  eq('第 1 行 [3,6)', b.start + ',' + b.end, '3,6');
  eq('末行到文末', c.start + ',' + c.end, '7,8');
  eq('切片就是该行内容', t.slice(b.start, b.end), 'bbb');
  eq('越界行退化为末行（不返回负区间）', (function () { const z = Caret.lineBounds(t, 9); return z.start + ',' + z.end; })(), '7,8');
  eq('空文本', (function () { const z = Caret.lineBounds('', 0); return z.start + ',' + z.end; })(), '0,0');
})();

/* ---------------------------------------------------------------- 居中 */

group('centerDelta · 要滚多少才把这一行放到中间');
eq('行顶在视口顶上 → 往下滚半屏减半行', Caret.centerDelta(0, 24, 800), 12 - 400);
eq('行中心正好在视口中 → 不滚', Caret.centerDelta(388, 24, 800), 0);
eq('行在下方 → 正数（往下滚）', Caret.centerDelta(600, 24, 800), 212);
eq('行在上方 → 负数（往上滚）', Caret.centerDelta(100, 24, 800), -288);
eq('行高影响一半', Caret.centerDelta(0, 40, 800), 20 - 400);
eq('脏输入当 0 处理', Caret.centerDelta(null, undefined, null), 0);
eq('字符串数字也吃', Caret.centerDelta('388', '24', '800'), 0);

group('clampScroll · 别滚出边界');
eq('负数夹到 0', Caret.clampScroll(-120, 500), 0);
eq('超出上限夹到上限', Caret.clampScroll(900, 500), 500);
eq('区间内原样', Caret.clampScroll(123, 500), 123);
eq('上限为负当 0', Caret.clampScroll(50, -10), 0);
eq('上限 0（内容不滚动）', Caret.clampScroll(50, 0), 0);
eq('小数保留', Caret.clampScroll(12.5, 500), 12.5);

/* ---------------------------------------------------------------- 近邻 */

group('nearOf · 专注模式的近邻块');
eq('中间块前后各一', JSON.stringify(Caret.nearOf(2, 5)), '[1,3]');
eq('首块只有后一个', JSON.stringify(Caret.nearOf(0, 5)), '[1]');
eq('末块只有前一个', JSON.stringify(Caret.nearOf(4, 5)), '[3]');
eq('只有一块时没有近邻', JSON.stringify(Caret.nearOf(0, 1)), '[]');
eq('未在编辑（-1）时为空', JSON.stringify(Caret.nearOf(-1, 5)), '[]');
eq('null 安全', JSON.stringify(Caret.nearOf(null, 5)), '[]');
eq('两块时互为近邻', JSON.stringify(Caret.nearOf(0, 2)), '[1]');
eq('越界索引不越界返回', JSON.stringify(Caret.nearOf(9, 3)), '[]');

/* ---------------------------------------------------------------- 接线 */

group('接线 · index.html / editor.js / css');
const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const ed = fs.readFileSync(path.join(ROOT, 'app', 'js', 'editor.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');

ok('index.html 引入 caret.js', html.indexOf('<script src="js/caret.js"></script>') > 0);
ok('caret.js 排在 editor.js 之前', (function () {
  const a = html.indexOf('js/caret.js'), b = html.indexOf('js/editor.js');
  return a > 0 && b > 0 && a < b;
})(), 'caret@' + html.indexOf('js/caret.js') + ' editor@' + html.indexOf('js/editor.js'));

ok('editor.js 用 Caret.center 做打字机居中', ed.indexOf('Caret.center(ta, SCROLL)') > 0);
ok('editor.js 用 Caret.nearOf 算近邻', ed.indexOf('Caret.nearOf(st.editing, total)') > 0);
ok('editor.js 用 Caret.markLine 定位高亮条', ed.indexOf('Caret.markLine(layer, ta)') > 0);
ok('编辑态插入 caret-line 节点', ed.indexOf('Caret.makeLine()') > 0);
ok('光标移动绑了 keyup / click / select', (function () {
  return ed.indexOf("addEventListener('keyup', onCaretMove)") > 0 &&
    ed.indexOf("addEventListener('click', onCaretMove)") > 0 &&
    ed.indexOf("addEventListener('select', onCaretMove)") > 0;
})());
ok('输入时仍会重新居中（不是只在进入时）',
  // onInput 现在有两条路（textarea / live 的 contenteditable），两条都得居中
  (function () {
    const body = (/function onInput\(\)[\s\S]*?\n  \}/.exec(ed) || [''])[0];
    return (body.match(/if \(st\.typewriter\) centerCaret\(\)/g) || []).length === 2;
  })(), 'live 分支也要居中');
ok('两个开关都关时不做量测（省开销）',
  ed.indexOf('if (!st.focus && !st.typewriter) { lastNear = \'\'; return; }') > 0);
ok('render 后清近邻缓存', /ED\.innerHTML = out;[\s\S]{0,200}lastNear = ''/.test(ed));
ok('retag 保留 near 类', ed.indexOf("classList.contains('near')") > 0);

group('CSS · 三级衰减与高亮条');
ok('非光标块 0.3', /body\.focus-mode #editor \.blk \{[^}]*opacity:\s*\.3/.test(css));
ok('近邻块 0.62', /body\.focus-mode #editor \.blk\.near \{[^}]*opacity:\s*\.62/.test(css));
ok('光标块不透明', /body\.focus-mode #editor \.blk\.editing,\s*\nbody\.focus-mode #editor \.blk:hover \{\s*opacity:\s*1/.test(css));
ok('标题的近邻也有单独档', /\.blk\.h1\.near,[\s\S]{0,80}opacity:\s*\.72/.test(css));
ok('高亮条平时不可见', /\.caret-line \{[^}]*opacity:\s*0/.test(css));
ok('专注模式下高亮条显形', /body\.focus-mode \.caret-line \{\s*opacity:\s*1/.test(css));
ok('高亮条不挡鼠标', /\.caret-line \{[^}]*pointer-events:\s*none/.test(css));
ok('textarea 压在条上面', /\.blk\.editing textarea\.src \{[^}]*z-index:\s*1/.test(css));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
