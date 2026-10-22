/* Code Tools 纯函数测试 */
const path = require('path');
const Code = require(path.join(__dirname, '..', 'app', 'js', 'code.js'));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, want) {
  const g = Array.isArray(got) || typeof got === 'object' ? JSON.stringify(got) : String(got);
  const w = Array.isArray(want) || typeof want === 'object' ? JSON.stringify(want) : String(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      期望 ' + w + '\n      实际 ' + g); }
}
function group(n) { console.log('\n' + n); }
// 覆盖到最后一行的选区终点
function END() { return 1e9; }
function noiseOf(src, lang) {
  const n = Code.stripNoise(src, lang);
  if (n.length !== src.length) return '<长度不符 ' + n.length + '≠' + src.length + '>';
  return n;
}

/* -------------------------------------------------- 围栏拆分 */
group('围栏拆分 / 还原');
{
  const raw = '```javascript\nlet a = 1;\n```';
  const sp = Code.split(raw);
  ok('识别出围栏', sp !== null);
  eq('fence 行', sp.fence, '```javascript');
  eq('语言', sp.lang, 'javascript');
  eq('正文行', sp.lines, ['let a = 1;']);
  eq('闭合行', sp.closing, '```');
  eq('join 还原原样', Code.join(sp), raw);
}
{
  const sp = Code.split('~~~python\nx=1\n~~~');
  eq('~~~ 围栏也认', sp.lang, 'python');
  eq('~~~ 还原', Code.join(sp), '~~~python\nx=1\n~~~');
}
{
  const sp = Code.split('````\na\n````');
  eq('四反引号围栏', sp.fence, '````');
  eq('四反引号闭合', sp.closing, '````');
}
{
  const sp = Code.split('```js\na\n');           // 没有闭合（正在输入中）
  eq('无闭合时 closing 为空', sp.closing, '');
  eq('无闭合时正文不吞', sp.lines, ['a', '']);
}
ok('非代码块返回 null', Code.split('hello') === null);
{
  // 围栏自带缩进的情况：因为它在引用里
  const raw = '   ```js\n   a\n   ```';
  const sp = Code.split(raw);
  eq('缩进围栏保留缩进', sp.fence, '   ```js');
  eq('缩进围栏还原', Code.join(sp), raw);
}
{
  const sp = Code.split('```  js \na\n```');
  eq('语言后多余空白剥掉', sp.lang, 'js');
}

group('setLang：只动首行');
eq('改语言', Code.setLang('```js\na\n```', 'python'), '```python\na\n```');
eq('改成 text 时清空语言', Code.setLang('```js\na\n```', 'text'), '```\na\n```');
eq('无语言时补上', Code.setLang('```\na\n```', 'go'), '```go\na\n```');
eq('~~~ 围栏改语言', Code.setLang('~~~bash\na\n~~~', 'sh'), '~~~sh\na\n~~~');
eq('正文不受影响', Code.setLang('```js\n```\n```', 'html'), '```html\n```\n```');

/* -------------------------------------------------- 选区行区间 */
group('选区行判定');
{
  const code = 'aaa\nbbb\nccc';
  const s = Code.selLines(code, 0, 0);
  eq('段首 → 第 0 行', [s.from, s.to], [0, 0]);
  const s2 = Code.selLines(code, 5, 5);
  eq('第 2 行起点', [s2.from, s2.to], [1, 1]);
  const s3 = Code.selLines(code, 4, 8);        // 跨 1、2 行
  eq('跨行框选', [s3.from, s3.to], [1, 2]);
  const s4 = Code.selLines(code, 8, 4);        // 反向框选自动归一
  eq('反向框选归一', [s4.from, s4.to], [1, 2]);
  const s5 = Code.selLines(code, 10, 10);
  eq('末行', [s5.from, s5.to], [2, 2]);
}

/* -------------------------------------------------- 缩进 / 反缩进 */
group('Tab 缩进 / Shift+Tab 反缩进');
eq('单行缩进', Code.indent('a\nb', 0, 0), '  a\nb');
eq('多行缩进', Code.indent('a\nb\nc', 0, END()), '  a\n  b\n  c');
eq('只缩到 end 之前那一行', Code.indent('a\nb\nc', 0, 3), '  a\n  b\nc');
eq('空行不参与缩进', Code.indent('a\n\nb', 0, END()), '  a\n\n  b');
eq('反缩进一级', Code.outdent('    a\nb', 0, 0), '  a\nb');
eq('反缩进到顶就停', Code.outdent('a\nb', 0, 0), 'a\nb');
eq('不足一级时吞到底', Code.outdent(' a\nb', 0, 0), 'a\nb');
eq('Tab 打头反缩进吃一个 tab', Code.outdent('\ta\nb', 0, 0), 'a\nb');
eq('tab 混空格整段剥', Code.outdent(' \t a\nb', 0, 0), 'a\nb');
eq('自定义单位', Code.indent('a', 0, 0, '    '), '    a');
ok('缩进保持行数', Code.indent('a\nb\nc', 0, 5).split('\n').length === 3);

/* -------------------------------------------------- 注释切换 */
group('行注释切换');
eq('JS 用 //', Code.toggleComment('let a = 1;', 0, 0, 'javascript'), '// let a = 1;');
eq('Python 用 #', Code.toggleComment('a = 1', 0, 0, 'python'), '# a = 1');
eq('SQL 用 --', Code.toggleComment('SELECT 1', 0, 0, 'sql'), '-- SELECT 1');
eq('LaTeX 用 %', Code.toggleComment('\\section', 0, 0, 'latex'), '% \\section');
eq('再切一次取消',
  Code.toggleComment(Code.toggleComment('a\nb', 0, 0, 'js'), 0, 0, 'js'), 'a\nb');
eq('保留缩进', Code.toggleComment('    let a;', 0, 0, 'js'), '    // let a;');
eq('取消时也保留缩进', Code.toggleComment('    // let a;', 0, 0, 'js'), '    let a;');
eq('带空格的注释也能取消', Code.toggleComment('//a', 0, 0, 'js'), 'a');
{
  // 混合：不全注释 → 全部加上（含已经注释过的那行）
  const r = Code.toggleComment('// a\nb', 0, END(), 'js');
  eq('混合时全部加注释', r, '// // a\n// b');
}
eq('不支持注释的语言原样返回', Code.toggleComment('a', 0, 0, 'json'), 'a');
eq('未知语言原样返回', Code.toggleComment('a', 0, 0, 'klingon'), 'a');
eq('多行全部注释后再切全部取消',
  Code.toggleComment(Code.toggleComment('a\nb\nc', 0, END(), 'go'), 0, END(), 'go'), 'a\nb\nc');
eq('空行不加注释', Code.toggleComment('a\n\nb', 0, END(), 'go'), '// a\n\n// b');

/* -------------------------------------------------- 上下移行 */
group('上下移动行');
eq('下移一行', Code.moveLine('a\nb\nc', 0, 1), 'b\na\nc');
eq('上移一行', Code.moveLine('a\nb\nc', 2, -1), 'a\nc\nb');
eq('首行上移不动', Code.moveLine('a\nb', 0, -1), 'a\nb');
eq('末行下移不动', Code.moveLine('a\nb', 1, 1), 'a\nb');
eq('只有一行不动', Code.moveLine('a', 0, 1), 'a');
ok('行数不变', Code.moveLine('a\nb\nc', 1, 1).split('\n').length === 3);

/* -------------------------------------------------- 噪声抹平 */
group('字符串 / 注释里的括号不算数');
/* 不断言「第几个字符是空格」这种脆弱写法，只锁两条不变式：
 *   1. 长度守恒 —— noise 与原文逐字符对齐，下标能映射回原文
 *   2. 该抹掉的一个字符都不留（保留的是外壳：引号本身、外围代码） */
function flat(name, src, lang) {
  const n = Code.stripNoise(src, lang);
  ok(name + '（长度守恒）', n.length === src.length);
  return n;
}
ok('双引号内容被抹平', !/{/.test(flat('双引号', 'if ("{") x();', 'js')));
ok('单引号内容被抹平', !/{/.test(flat('单引号', "x = '{'", 'python')));
ok('转义引号不算字符串结束', !/{/.test(flat('转义引号', 'a = "x\\"{"', 'js')));
ok('块注释内容被抹平', !/{/.test(flat('块注释', '/* { */ x();', 'js')));
ok('行注释内容被抹平', !/[{}]/.test(flat('行注释', 'a // } {', 'js')));
ok('块注释之外的代码原样保留', flat('外围', '/* { */ ({})', 'js').slice(-4) === '({})');
eq('Python 不认块注释', Code.stripNoise('/* x */', 'python'), '/* x */');
ok('长度守恒（混合串）', Code.stripNoise('a"{"b', 'js').length === 'a"{"b'.length);
eq('净括号计数', Code.netBrackets('a{b}(c)'), 0);
eq('净括号 +1', Code.netBrackets('if (a) {'), 1);
eq('净括号 -1', Code.netBrackets(');'), -1);

/* -------------------------------------------------- 自动缩进 */
group('自动缩进：brace 系');
{
  const src = 'function f() {\nreturn 1;\n}';
  eq('函数体重排', Code.autoIndent(src, 'js'),
    'function f() {\n  return 1;\n}');
}
{
  const src = 'if (a) {\nb;\n} else {\nc;\n}';
  eq('} else { 两分支都对齐', Code.autoIndent(src, 'javascript'),
    'if (a) {\n  b;\n} else {\n  c;\n}');
}
{
  const src = 'class A {\nfoo() {\nbar();\n}\n}';
  eq('嵌套两级', Code.autoIndent(src, 'java'),
    'class A {\n  foo() {\n    bar();\n  }\n}');
}
{
  const src = 'foo(\na,\nb\n);\nx;';
  eq('多行调用参数 + 收尾降回', Code.autoIndent(src, 'js'),
    'foo(\n  a,\n  b\n);\nx;');
}
{
  const src = 'const x = {\na: 1,\nb: 2\n};';
  eq('对象字面量', Code.autoIndent(src, 'js'),
    'const x = {\n  a: 1,\n  b: 2\n};');
}
{
  // 字符串里有括号也不该抬 struct depth —— 这是最容易错的一例
  const src = 'if (s === "{") {\nok();\n}';
  eq('字符串里的括号不影响', Code.autoIndent(src, 'js'),
    'if (s === "{") {\n  ok();\n}');
}
{
  const src = '// { \nx;';
  eq('注释里的括号不影响', Code.autoIndent(src, 'js'), '// {\nx;');
}
{
  const src = 'do {\nx;\n} while (y);\nend;';
  eq('do-while 收尾降回', Code.autoIndent(src, 'js'),
    'do {\n  x;\n} while (y);\nend;');
}
eq('空行不生成尾随空格', Code.autoIndent('a\n\nb', 'js'), 'a\n\nb');
eq('已经是好的就保持稳定',
  Code.autoIndent('function f() {\n  return 1;\n}', 'js'),
  'function f() {\n  return 1;\n}');
eq('自定义单位（四空格）',
  Code.autoIndent('function f() {\na;\n}', 'js', '    '),
  'function f() {\n    a;\n}');

group('自动缩进：缩进驱动系');
{
  const src = 'def f():\nif x:\nreturn 1\nelse:\nreturn 2';
  eq('Python 只规范化不猜结构', Code.autoIndent(src, 'python'), src);
}
eq('Python 把 tab 换成四空格', Code.autoIndent('def f():\n\ta = 1', 'python'),
  'def f():\n    a = 1');
eq('Python 不足一级也保住层级（不能抹平）', Code.autoIndent('a\n   b', 'python'), 'a\n    b');
{
  const src = 'a:\n  b: 1\n  c: 2\n    d:\n      e';
  eq('YAML 两空格单位，结构不变', Code.autoIndent(src, 'yaml'), src);
  eq('YAML 的 tab 展开成两空格', Code.autoIndent('a:\n\tb: 1', 'yaml'), 'a:\n  b: 1');
}

group('自动缩进：边界');
eq('纯文本返回空也一样', Code.autoIndent('', 'js'), '');
eq('只有空白不乱来', Code.autoIndent('   \n  ', 'js'), '   \n  ');
eq('无括号语言走规范化', Code.autoIndent('a\n  b', 'markdown'), 'a\n  b');
ok('结果行数与输入一致',
  Code.autoIndent('function f() {\na;\n}', 'js').split('\n').length === 3);

/* -------------------------------------------------- 导出片段 */
group('复制为 HTML / Markdown');
{
  const h = Code.toHtml('let a = 1;', 'js');
  eq('HTML 带 language 类', h, '<pre><code class="language-js">let a = 1;</code></pre>');
  ok('HTML 转义了尖括号',
    Code.toHtml('a < b && c > d', 'js').indexOf('&lt;') > 0);
  ok('HTML 转义了 & ',
    Code.toHtml('a && b', 'js').indexOf('&amp;&amp;') > 0);
  ok('能用外部 highlighter',
    Code.toHtml('x', 'js', (c, l) => '<span class="tok-kw">' + c + '</span>').indexOf('tok-kw') > 0);
}
eq('无语言时退到 text',
  Code.toHtml('x', ''), '<pre><code class="language-text">x</code></pre>');
{
  const md = Code.toMarkdown('let a = 1;', 'js');
  eq('Markdown 带围栏', md, '```js\nlet a = 1;\n```');
}
{
  const md = Code.toMarkdown('```\nnested\n```', 'js');
  ok('正文含 ``` 时加长围栏', md.indexOf('````js') === 0);
}
{
  const md = Code.toMarkdown('x', '');
  eq('无语言时不写语言', md, '```\nx\n```');
}

/* -------------------------------------------------- 语言元数据 */
group('语言元数据');
eq('js 别名归一', Code.langAliases('js'), 'javascript');
eq('py 别名归一', Code.langAliases('py'), 'python');
eq('sh 别名归一', Code.langAliases('sh'), 'bash');
eq('大小写不敏感', Code.langAliases('JavaScript'), 'javascript');
eq('注释符查表', Code.commentMark('python'), '#');
eq('未知语言无注释符', Code.commentMark('klingon'), null);
eq('缩进驱动判定', Code.isIndentDriven('python'), true);
eq('非缩进驱动判定', Code.isIndentDriven('javascript'), false);
ok('每种支持的语言都有注释符',
  Object.keys(Code.LINE_CM).every(k => typeof Code.LINE_CM[k] === 'string' && Code.LINE_CM[k].length > 0));

console.log('\n' + (fail ? '✗ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
