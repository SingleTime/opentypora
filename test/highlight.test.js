/* 代码高亮：33 种语言的覆盖与词法正确性
 *
 * 两条主线：
 * 1) 覆盖 —— CODE_LANGS 里除 text 外每一种都必须有方言表（这条就是 11 → 33 的守卫）
 * 2) 不变量 —— 去掉 <span> 再反转义必须一字不差还原原文。比逐个断言颜色抗回归得多：
 *    任何规则多吃/少吃一个字符，这条立刻炸。
 */
const path = require('path');
const MD = require(path.join(__dirname, '..', 'app', 'js', 'md.js'));

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

/* 去标签 + 反转义 → 原文。span 只有一种形态，用逐段扫描而不是正则替换，
 * 免得 &amp;lt; 这类被连环替换。 */
function plain(html) {
  let out = '', i = 0;
  while (i < html.length) {
    if (html.startsWith('<span class="tok-', i)) {
      i = html.indexOf('>', i) + 1;
      continue;
    }
    if (html.startsWith('</span>', i)) { i += 7; continue; }
    out += html[i]; i++;
  }
  return out
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function rt(name, src, lang) {
  const h = MD.highlight(src, lang);
  const b = plain(h);
  ok(name + ' 往返无损', b === src, '进出不一致：' + JSON.stringify(b).slice(0, 160));
  return h;
}
function has(h, cls) { return h.indexOf('<span class="' + cls + '"') >= 0; }

/* 每种语言一段真实片段：至少覆盖「关键字 + 字符串 +（有注释的语言）注释」 */
const SAMPLES = {
  bash: '# deploy\nset -e\nNAME="api"\necho "deploy $NAME"\nif [ -d out ]; then\n  cd out\nfi',
  c: '#include <stdio.h>\n/* init */\nint main(void) {\n  const char *s = "hi";\n  return 0;\n}',
  cpp: '#include <vector>\nclass A : public B {\npublic:\n  int f() const { return 1; }\n};\n// done',
  csharp: 'using System;\npublic class A {\n  // note\n  private string s = "x";\n  public int F() => 1;\n}',
  css: '/* theme */\n.btn:hover {\n  color: #0969da;\n  margin: 8px 0;\n}\n@media print {\n  .btn { display: none !important; }\n}',
  diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-let a = 1;\n+let a = 2;',
  flow: 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]',
  go: 'package main\n\n// entry\nimport "fmt"\n\nfunc main() {\n  s := "hi"\n  fmt.Println(s)\n}',
  html: '<!DOCTYPE html>\n<!-- page -->\n<div class="box" id="main">\n  <a href="/x">链接</a>\n</div>',
  java: 'package a;\n// note\npublic class A {\n  private String s = "x";\n  @Override public String toString() { return s; }\n}',
  javascript: '// note\nconst a = 1;\nconst s = "x";\nfunction f(x) {\n  return `v=${x}`;\n}',
  json: '{\n  "name": "opentypora",\n  "n": 12,\n  "ok": true,\n  "list": [1, 2]\n}',
  jsx: 'const El = () => (\n  <div className="box">hi</div>\n);',
  kotlin: '// note\nfun main() {\n  val s = "hi"\n  println(s)\n}',
  latex: '% note\n\\section{标题}\n\\textbf{bold} $x^2$ 10pt\n\\begin{itemize}\n\\item a\n\\end{itemize}',
  lua: '-- note\nlocal t = { a = 1 }\nfunction f(x)\n  return "s" .. x\nend',
  markdown: '# 标题\n\n- 列表 **粗** `code`\n> 引用\n\n```js\nx\n```',
  mermaid: 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]',
  objectivec: '#import <Foundation/Foundation.h>\n// note\n@interface A : NSObject\n@property NSString *name;\n@end',
  php: '<?php\n// note\nfunction f($x) {\n  $s = "hi";\n  return $x . $s;\n}\n?>',
  python: '# note\ndef f(x):\n    """doc"""\n    s = "hi"\n    return {"a": x}\n',
  r: '# note\nf <- function(x) {\n  s <- "hi"\n  if (is.null(x)) return(NULL)\n  print(s)\n}',
  ruby: '# note\nclass A\n  def f(x)\n    s = "hi"\n    :sym\n  end\nend',
  rust: '// note\nfn main() {\n  let s = "hi";\n  let n: u32 = 1;\n  println!("{} {}", s, n);\n}',
  scss: '// note\n$brand: #0969da;\n.btn {\n  color: $brand;\n  &:hover { color: $brand; }\n}',
  shell: '#!/bin/bash\n# note\nNAME="x"\necho "$NAME"',
  sql: '-- note\nSELECT id, name\nFROM users\nWHERE name = \'a\'\nORDER BY id;\nINSERT INTO t (a) VALUES (1);',
  swift: '// note\nstruct A {\n  let s: String = "hi"\n  func f() -> Int { return 1 }\n}',
  toml: '# note\n[server]\nhost = "0.0.0.0"\nport = 8080\nstarted = 2026-10-19T10:00:00Z',
  tsx: 'type P = { a: number };\nconst El = (p: P) => <div className="box">{p.a}</div>;',
  typescript: '// note\ninterface A { a: string }\nconst f = (x: A): string => `v=${x.a}`;',
  xml: '<?xml version="1.0"?>\n<!-- note -->\n<root id="1">\n  <item>v</item>\n</root>',
  yaml: '# note\nname: opentypora\nlist:\n  - a\n  - b\nflag: true\nurl: http://a#b'
};

/* -------------------------------------------------- 覆盖：34 项 → 33 种 */
group('语言覆盖（11 → 32 套词法 / 33 个下拉项）');
{
  const langs = MD.CODE_LANGS.map(l => l[0]);
  ok('CODE_LANGS 共 34 项（含 text）', langs.length === 34, '实际 ' + langs.length);
  const hl = MD.hlLangs();
  const missing = langs.filter(l => l !== 'text' && hl.indexOf(MD.langKey(l)) < 0);
  ok('除 text 外每种语言都有高亮表', missing.length === 0, '缺：' + missing.join(', '));
  // 下拉 34 项 = text + 33 项可高亮；其中 shell 就是 bash 的别名，
  // 所以真正独立的词法是 32 套（不是 33），这里按「归一后去重」来断言。
  const uniq = new Set(langs.filter(l => l !== 'text').map(l => MD.langKey(l)));
  ok('归一后 32 套词法，覆盖全部 33 个可高亮下拉项',
    hl.length === 32 && uniq.size === 32 && langs.length - 1 === 33,
    '词法 ' + hl.length + '，归一后 ' + uniq.size + '：' + hl.join(','));
  ok('text 不着色', MD.highlight('a < b // c', 'text') === 'a &lt; b // c');

  // 别名要落到同一张表
  const alias = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', objc: 'objectivec' };
  Object.keys(alias).forEach(a => {
    const h = MD.highlight(SAMPLES[alias[a]], a);
    ok('别名 ' + a + ' → ' + alias[a], has(h, 'tok-kw') || has(h, 'tok-tag') || has(h, 'tok-meta'));
  });
}

/* -------------------------------------------------- 不变量：往返无损 */
group('往返无损（去掉标签必须还原原文）');
{
  Object.keys(SAMPLES).forEach(lang => {
    rt(lang, SAMPLES[lang], lang);
  });
  // 边角：未闭合的字符串 / 块注释 / 空串 / 只有空白
  rt('未闭合字符串', 'x = "abc', 'javascript');
  rt('未闭合块注释', '/* abc', 'javascript');
  rt('未闭合三引号', '"""abc', 'python');
  rt('空串', '', 'python');
  rt('纯空白', '  \n\t\n', 'go');
  rt('HTML 特殊字符', 'a < b && c > d "q" \'s\'', 'javascript');
  rt('中文与 emoji', 'const 名 = "中文🙂";', 'javascript');
  rt('CRLF', 'let a = 1;\r\nlet b = 2;\r\n', 'javascript');
  const h = MD.highlight('<script>alert(1)</script>', 'html');
  ok('HTML 里的 <script> 被转义', h.indexOf('<script') < 0 && h.indexOf('&lt;script') >= 0);
  ok('不认识的围栏语言只转义', MD.highlight('<b>', 'zzz') === '&lt;b&gt;');
}

/* -------------------------------------------------- 逐语言要点 */
group('各语言要点');
{
  let h;

  h = MD.highlight(SAMPLES.javascript, 'javascript');
  ok('js 关键字', has(h, 'tok-kw'));
  ok('js 字符串（含模板串）', (h.match(/tok-st/g) || []).length >= 2);
  ok('js 注释', has(h, 'tok-cm'));
  ok('js 数字', has(h, 'tok-nu'));
  ok('js 调用', h.indexOf('<span class="tok-fn">f</span>') >= 0);

  h = MD.highlight(SAMPLES.typescript, 'typescript');
  ok('ts interface 是关键字', has(h, 'tok-kw'));

  h = MD.highlight(SAMPLES.python, 'python');
  ok('py 三引号算字符串', has(h, 'tok-st'));
  ok('py def/return 是关键字', has(h, 'tok-kw'));
  ok('py # 注释', has(h, 'tok-cm'));

  h = MD.highlight('@app.route("/x")\ndef f(): pass', 'python');
  ok('py 装饰器', h.indexOf('<span class="tok-fn">@app.route</span>') >= 0);

  h = MD.highlight(SAMPLES.java, 'java');
  ok('java 注解', h.indexOf('<span class="tok-meta">@Override</span>') >= 0);
  ok('java String 是类型', h.indexOf('<span class="tok-type">String</span>') >= 0);

  h = MD.highlight(SAMPLES.c, 'c');
  ok('c #include 整行当预处理', h.indexOf('<span class="tok-meta">#include &lt;stdio.h&gt;</span>') >= 0);
  ok('c int 是关键字', h.indexOf('<span class="tok-kw">int</span>') >= 0);

  h = MD.highlight(SAMPLES.cpp, 'cpp');
  ok('cpp public 是关键字', has(h, 'tok-kw'));

  h = MD.highlight(SAMPLES.csharp, 'csharp');
  ok('c# 关键字', has(h, 'tok-kw'));
  h = MD.highlight('var s = @"C:\\tmp"; var t = $"n={n}";', 'csharp');
  ok('c# @" 与 $" 前缀', (h.match(/tok-st/g) || []).length >= 3);

  h = MD.highlight(SAMPLES.objectivec, 'objectivec');
  ok('objc #import 预处理', h.indexOf('tok-meta">#import') >= 0);
  ok('objc @interface 注解', h.indexOf('tok-meta">@interface') >= 0);
  ok('objc NSString 类型', h.indexOf('<span class="tok-type">NSString</span>') >= 0);

  h = MD.highlight(SAMPLES.go, 'go');
  ok('go func 关键字', has(h, 'tok-kw'));
  ok('go 反引号/普通字符串', has(h, 'tok-st'));

  h = MD.highlight(SAMPLES.rust, 'rust');
  ok('rust let 关键字', has(h, 'tok-kw'));
  ok('rust u32 类型', h.indexOf('<span class="tok-type">u32</span>') >= 0);
  h = MD.highlight("fn f<'a>(x: &'a str) -> &'a str { x }", 'rust');
  ok('rust 生命周期不当成字符串', h.indexOf('tok-meta">&#39;a</span>') >= 0);

  h = MD.highlight(SAMPLES.ruby, 'ruby');
  ok('ruby def 关键字', has(h, 'tok-kw'));
  ok('ruby 符号 :sym', h.indexOf('<span class="tok-fn">:sym</span>') >= 0);

  h = MD.highlight(SAMPLES.php, 'php');
  ok('php $var', h.indexOf('<span class="tok-meta">$x</span>') >= 0);
  ok('php <?php', h.indexOf('tok-meta">&lt;?php') >= 0);

  h = MD.highlight(SAMPLES.bash, 'bash');
  ok('bash $NAME 变量', MD.highlight('echo $NAME', 'bash').indexOf('<span class="tok-meta">$NAME</span>') >= 0);
  ok('bash if 关键字', has(h, 'tok-kw'));

  h = MD.highlight(SAMPLES.lua, 'lua');
  ok('lua -- 注释', has(h, 'tok-cm'));
  ok('lua function 关键字', has(h, 'tok-kw'));
  h = MD.highlight('--[[ 多行\n注释 ]] local a = 1', 'lua');
  ok('lua --[[ 块注释优先于 --', h.indexOf('tok-cm">--[[ 多行\n注释 ]]</span>') >= 0);

  h = MD.highlight(SAMPLES.r, 'r');
  ok('r function 关键字', has(h, 'tok-kw'));

  h = MD.highlight(SAMPLES.sql, 'sql');
  ok('sql 大写 SELECT 也是关键字', h.indexOf('<span class="tok-kw">SELECT</span>') >= 0);
  ok('sql FROM/WHERE 关键字', h.indexOf('<span class="tok-kw">WHERE</span>') >= 0);
  ok("sql 单引号字符串", h.indexOf('tok-st">&#39;a&#39;') >= 0);
  h = MD.highlight("select 'it''s' from t", 'sql');
  ok('sql 双写引号转义', plain(h) === "select 'it''s' from t");

  h = MD.highlight(SAMPLES.json, 'json');
  ok('json 键单独着色', h.indexOf('<span class="tok-key">&quot;name&quot;</span>') >= 0);
  ok('json true 关键字', has(h, 'tok-kw'));

  h = MD.highlight(SAMPLES.yaml, 'yaml');
  ok('yaml 键着色', h.indexOf('<span class="tok-key">name</span>') >= 0);
  ok('yaml URL 里的 # 不算注释', h.indexOf('tok-cm">#b') < 0);
  h = MD.highlight('a: 1 # 注释', 'yaml');
  ok('yaml 空格后的 # 是注释', has(h, 'tok-cm'));

  h = MD.highlight(SAMPLES.toml, 'toml');
  ok('toml [section]', h.indexOf('<span class="tok-kw">[server]</span>') >= 0);
  ok('toml 键', h.indexOf('<span class="tok-key">host</span>') >= 0);
  ok('toml 日期整段', h.indexOf('2026-10-19T10:00:00Z') >= 0 && h.indexOf('<span class="tok-nu">2026') >= 0);

  h = MD.highlight(SAMPLES.css, 'css');
  ok('css 属性名', h.indexOf('<span class="tok-key">color</span>') >= 0);
  ok('css 色值', h.indexOf('<span class="tok-nu">#0969da</span>') >= 0);
  ok('css 带单位数字', h.indexOf('<span class="tok-nu">8px</span>') >= 0);
  ok('css at-rule', h.indexOf('<span class="tok-kw">@media</span>') >= 0);
  ok('css !important', h.indexOf('<span class="tok-kw">!important</span>') >= 0);

  h = MD.highlight(SAMPLES.scss, 'scss');
  ok('scss 变量', h.indexOf('<span class="tok-meta">$brand</span>') >= 0);

  h = MD.highlight(SAMPLES.html, 'html');
  ok('html 标签', h.indexOf('<span class="tok-tag">&lt;div</span>') >= 0);
  ok('html 属性名', h.indexOf('<span class="tok-key">class</span>') >= 0);
  ok('html 属性值', h.indexOf('tok-st">&quot;box&quot;') >= 0);
  ok('html DOCTYPE', h.indexOf('tok-meta">&lt;!DOCTYPE') >= 0);
  ok('html 注释', has(h, 'tok-cm'));

  h = MD.highlight(SAMPLES.xml, 'xml');
  ok('xml 声明', h.indexOf('tok-meta">&lt;?xml') >= 0);
  ok('xml 标签', h.indexOf('<span class="tok-tag">&lt;item</span>') >= 0);

  h = MD.highlight(SAMPLES.latex, 'latex');
  ok('latex 命令', h.indexOf('<span class="tok-kw">\\section</span>') >= 0);
  ok('latex 行内公式', h.indexOf('<span class="tok-st">$x^2$</span>') >= 0);
  ok('latex % 注释', has(h, 'tok-cm'));

  h = MD.highlight(SAMPLES.mermaid, 'mermaid');
  ok('mermaid graph 关键字', h.indexOf('<span class="tok-kw">graph</span>') >= 0);
  ok('mermaid 箭头', has(h, 'tok-meta'));
  ok('mermaid 节点文字', h.indexOf('<span class="tok-st">[开始]</span>') >= 0);

  h = MD.highlight(SAMPLES.diff, 'diff');
  ok('diff 增加行', h.indexOf('<span class="tok-ins">+let a = 2;</span>') >= 0);
  ok('diff 删除行', h.indexOf('<span class="tok-del">-let a = 1;</span>') >= 0);
  ok('diff 文件头', h.indexOf('tok-meta">diff --git') >= 0);
  ok('diff 上下文行不着色', h.indexOf('<span class="tok-ins">@@') < 0);

  h = MD.highlight(SAMPLES.markdown, 'markdown');
  ok('md 标题', h.indexOf('<span class="tok-kw">标题</span>') >= 0);
  ok('md 列表标记', h.indexOf('tok-meta">-') >= 0);
  ok('md 引用', has(h, 'tok-cm'));
  ok('md 行内代码', h.indexOf('<span class="tok-st">`code`</span>') >= 0);
  ok('md 粗体', h.indexOf('<span class="tok-kw">**粗**</span>') >= 0);

  h = MD.highlight('a < b && c', 'jsx');
  ok('jsx 里的比较号不误判成标签', h.indexOf('tok-tag') < 0 || h.indexOf('tok-tag">&lt; b') < 0);
}

/* -------------------------------------------------- 与编辑器其它入口的一致性 */
group('调用方一致');
{
  const doc = MD.renderDocument('```python\ndef f():\n    return 1\n```\n');
  ok('渲染管线的代码块走同一高亮', doc.indexOf('tok-kw">def') >= 0);
  ok('language-python 类名仍在', doc.indexOf('language-python') >= 0);
  const c = MD.highlight('```', 'text');
  ok('text 不崩', typeof c === 'string');
}

console.log('\n' + (fail ? '✗ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
