/* 源码模式的行号高亮层：纯函数 + 接线
 *
 * 这里只测 Node 能跑的部分（lineCount / numbers / render 的结构与转义），
 * 视觉对齐与光标留给 srcmodedom.test.js（真 WKWebView）——对齐这种事只有真排版才知道。
 *
 * 一条不变量贯穿：把每行的 <span> 剥掉再反转义，必须一字不差还原原文。
 * 高亮层吃错字符立刻炸，比逐条断言颜色抗回归。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MD = require(path.join(ROOT, 'app', 'js', 'md.js'));

// srcmode.js 是 UMD：Node 走 module.exports，但工厂里的 root.MD 是运行时读的
globalThis.MD = MD;
const SrcMode = require(path.join(ROOT, 'app', 'js', 'srcmode.js'));

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

/* 剥掉本模块产出的标签（只认自己写的那几种形态），再反转义 */
function plain(html) {
  let out = '', i = 0;
  while (i < html.length) {
    if (html.startsWith('<span class="sl-n">', i) || html.startsWith('<span class="sl-t">', i)) {
      i = html.indexOf('>', i) + 1;
      continue;
    }
    if (html.startsWith('<span class="tok-', i)) {
      i = html.indexOf('>', i) + 1;
      continue;
    }
    if (html.startsWith('</span>', i)) { i += 7; continue; }
    if (html.startsWith('<div class="sl">', i)) { i += 17; continue; }
    if (html.startsWith('</div>', i)) { i += 6; continue; }
    out += html[i]; i++;
  }
  return out
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/* 从 render 输出里按行拆开：每行一个 .sl，取行号与正文 */
function rows(html) {
  const parts = html.split('<div class="sl">').slice(1);
  return parts.map(function (p) {
    const m = /^<span class="sl-n">(\d+)<\/span><span class="sl-t">([\s\S]*?)<\/span><\/div>$/.exec(p);
    return m ? { n: +m[1], body: m[2] } : { n: 0, body: p };
  });
}

console.log('源码模式 · 行号高亮层');

/* ---------------------------------------------------------------- 行数 */
group('lineCount');
eq('空串算一行', SrcMode.lineCount(''), 1);
eq('null 算一行', SrcMode.lineCount(null), 1);
eq('undefined 算一行', SrcMode.lineCount(undefined), 1);
eq('单行无换行', SrcMode.lineCount('a'), 1);
eq('两行', SrcMode.lineCount('a\nb'), 2);
eq('结尾换行多一个空行', SrcMode.lineCount('a\n\n'), 3);
eq('CRLF 不重复计数', SrcMode.lineCount('a\r\nb\r\n'), 3);
eq('数字入参按字符串算', SrcMode.lineCount(12345), 1);
eq('3000 行（末尾带换行 → 3001）', SrcMode.lineCount(new Array(3001).join('x\n')), 3001);

/* ---------------------------------------------------------------- 行号 */
group('numbers');
eq('0 个', SrcMode.numbers(0).join(','), '');
eq('1 个', SrcMode.numbers(1).join(','), '1');
eq('4 个', SrcMode.numbers(4).join(','), '1,2,3,4');
ok('长度等于 n', SrcMode.numbers(100).length === 100, String(SrcMode.numbers(100).length));
ok('末位等于 n', SrcMode.numbers(37)[36] === 37, String(SrcMode.numbers(37)[36]));
ok('从 1 起不从 0 起', SrcMode.numbers(3)[0] === 1);

/* ---------------------------------------------------------------- 结构 */
group('render · 结构');
let r = rows(SrcMode.render(''));
eq('空文档也是一行', r.length, 1);
eq('空文档行号 1', r[0].n, 1);
eq('空行补零宽空格', r[0].body, '\u200b');
ok('每行都恰好一个 .sl-n', (SrcMode.render('a\nb\nc').match(/class="sl-n"/g) || []).length === 3);

r = rows(SrcMode.render('a\nb\nc'));
eq('三行三行号', r.map(function (x) { return x.n; }).join(','), '1,2,3');
eq('正文各自对上', r.map(function (x) { return plain(x.body); }).join('|'), 'a|b|c');

r = rows(SrcMode.render('a\n'));
eq('结尾换行给出第 2 行', r.length, 2);
eq('第 2 行是空行', r[1].body, '\u200b');
ok('有内容的行不加零宽空格', rows(SrcMode.render('a'))[0].body.indexOf('\u200b') < 0);

ok('不产生嵌套 div', SrcMode.render('a\n\nb').indexOf('<div class="sl"><div') < 0);
ok('行号在正文之前', (function () {
  const h = SrcMode.render('x');
  return h.indexOf('class="sl-n"') < h.indexOf('class="sl-t"');
})());

/* 制表符：textarea 里是 tab-size:4，高亮层必须原样留着 tab 而不是换成空格 */
eq('制表符原样保留', rows(SrcMode.render('\tcode'))[0].body.indexOf('\t'), 0);
eq('制表符不被展开成空格', plain(rows(SrcMode.render('\tcode'))[0].body).length, 5);

/* ---------------------------------------------------------------- 转义 */
group('render · 转义（无 MD 时）');
const keepMD = globalThis.MD;
globalThis.MD = null;
eq('尖括号被转义', rows(SrcMode.render('<div>'))[0].body, '&lt;div&gt;');
eq('& 被转义', rows(SrcMode.render('a & b'))[0].body, 'a &amp; b');
eq('引号不动', rows(SrcMode.render('"x"'))[0].body, '"x"');
eq('还原回去一字不差', plain(rows(SrcMode.render('<a href="x">&</a>'))[0].body), '<a href="x">&</a>');
globalThis.MD = keepMD;

/* ---------------------------------------------------------------- 高亮 */
group('render · 交给 MD.highlight');
ok('# 标题 被上色', /tok-/.test(rows(SrcMode.render('# 标题'))[0].body), rows(SrcMode.render('# 标题'))[0].body);
ok('列表被上色', /tok-/.test(rows(SrcMode.render('- 项目'))[0].body));
ok('行内代码被上色', /tok-/.test(rows(SrcMode.render('`code` 后面'))[0].body));
ok('围栏行被上色', /tok-/.test(rows(SrcMode.render('```js'))[0].body), rows(SrcMode.render('```js'))[0].body);

/* 逐行往返：整段文档里每一行剥标签后都要还原 —— 这是最强的一条 */
const DOC = [
  '# 标题',
  '',
  '正文里有 **粗**、*斜*、`代码`、[链接](https://a.b)、脚注[^1]。',
  '',
  '> 引用',
  '- [ ] 待办',
  '- [x] 完成',
  '| a | b |',
  '| - | - |',
  '',
  '```js',
  'const a = 1; // 注释',
  '```',
  '',
  '$$\nE = mc^2\n$$',
  '',
  '---',
  '结尾'
].join('\n');
const dl = String(DOC).split('\n');
const dr = rows(SrcMode.render(DOC));
eq('行数一致', dr.length, dl.length);
let badLine = null;
for (let i = 0; i < dl.length; i++) {
  const got = plain(dr[i].body);
  const want = dl[i] || '\u200b';
  if (got !== want) { badLine = (i + 1) + ': ' + JSON.stringify(want) + ' ≠ ' + JSON.stringify(got); break; }
}
ok('逐行剥标签能还原原文', !badLine, badLine || '');
eq('行号连续', dr.map(function (x) { return x.n; }).join(','),
  SrcMode.numbers(dl.length).join(','));

/* 长行不被截断（高亮层是 white-space: pre，靠横滚而不是折行） */
const LONG = 'x'.repeat(4000);
eq('4000 字符长行完整保留', plain(rows(SrcMode.render(LONG))[0].body).length, 4000);

/* 中文与 emoji 不做二次处理 */
eq('中文原样', plain(rows(SrcMode.render('中文标题'))[0].body), '中文标题');
ok('emoji 原样', SrcMode.render('😀 表情').indexOf('😀') >= 0);

/* ---------------------------------------------------------------- 围栏 */
group('render · 围栏内按语言上色');
const F = '```';
function lineAt(doc, n) { return plain(rows(SrcMode.render(doc))[n].body); }
function bodyAt(doc, n) { return rows(SrcMode.render(doc))[n].body; }

ok('围栏外的 JS 语句不上色（是 markdown 正文）', bodyAt('var a = 1;', 0).indexOf('tok-') < 0,
  bodyAt('var a = 1;', 0));
ok('围栏内的 JS 语句按 JS 上色', bodyAt([F + 'js', 'var a = 1;', F].join('\n'), 1).indexOf('tok-kw') >= 0,
  bodyAt([F + 'js', 'var a = 1;', F].join('\n'), 1));
eq('围栏内的 JS 仍可原样还原', lineAt([F + 'js', 'var a = 1;', F].join('\n'), 1), 'var a = 1;');
ok('围栏内的 # 不当标题', bodyAt([F + 'js', '# 注释', F].join('\n'), 1).indexOf('tok-meta') < 0,
  bodyAt([F + 'js', '# 注释', F].join('\n'), 1));
ok('围栏外的 # 仍是标题', bodyAt('# 标题', 0).indexOf('tok-meta') >= 0);
ok('围栏标记自己按 markdown 上色',
  bodyAt([F + 'js', 'x', F].join('\n'), 0).indexOf('tok-meta') >= 0,
  bodyAt([F + 'js', 'x', F].join('\n'), 0));
ok('无语言围栏当纯文本（不瞎上色）',
  bodyAt([F, 'var a = 1;', F].join('\n'), 1).indexOf('tok-') < 0,
  bodyAt([F, 'var a = 1;', F].join('\n'), 1));
ok('~~~ 围栏同样生效',
  bodyAt(['~~~js', 'var a = 1;', '~~~'].join('\n'), 1).indexOf('tok-kw') >= 0);
ok('围栏内的 ~~~ 不关掉 ```',
  bodyAt([F + 'js', '~~~', 'var a = 1;', F].join('\n'), 2).indexOf('tok-kw') >= 0,
  bodyAt([F + 'js', '~~~', 'var a = 1;', F].join('\n'), 2));
ok('围栏关闭后回到 markdown',
  bodyAt([F + 'js', 'var a = 1;', F, 'var a = 1;'].join('\n'), 3).indexOf('tok-') < 0,
  bodyAt([F + 'js', 'var a = 1;', F, 'var a = 1;'].join('\n'), 3));
ok('未闭合围栏一直生效到文末',
  bodyAt([F + 'py', 'def f():', 'def g():'].join('\n'), 2).indexOf('tok-kw') >= 0,
  bodyAt([F + 'py', 'def f():', 'def g():'].join('\n'), 2));
ok('围栏内空行不关围栏',
  bodyAt([F + 'js', '', 'var a = 1;', F].join('\n'), 2).indexOf('tok-kw') >= 0);
ok('缩进 3 格的围栏也算围栏',
  bodyAt(['   ' + F + 'js', 'var a = 1;'].join('\n'), 1).indexOf('tok-kw') >= 0);
ok('缩进 4 格是代码块不是围栏（按 markdown 处理）',
  bodyAt(['    ' + F + 'js', 'var a = 1;'].join('\n'), 1).indexOf('tok-kw') < 0,
  bodyAt(['    ' + F + 'js', 'var a = 1;'].join('\n'), 1));
eq('围栏语言别名 js 等价 javascript',
  bodyAt([F + 'js', 'var a = 1;'].join('\n'), 1),
  bodyAt([F + 'javascript', 'var a = 1;'].join('\n'), 1));

/* ---------------------------------------------------------------- DOM 层 */
/* 用最小桩验 attach/show/hide 的接线本身。
 * 这条曾经救过一次：attach 里 `return api` 的 api 当时在 UMD 外层，
 * 工厂里根本没这个名字 —— 一调就抛，整个 UI boot 挂掉，而纯函数测试全绿。 */
group('attach / show / hide（桩对象）');
function stubEl() {
  const ev = {};
  return {
    value: '', hidden: true, innerHTML: '', scrollTop: 0, scrollLeft: 0,
    addEventListener: function (n, f) { (ev[n] = ev[n] || []).push(f); },
    has: function (n) { return !!(ev[n] && ev[n].length); },
    fire: function (n) { (ev[n] || []).forEach(function (f) { f({}); }); }
  };
}
const TA = stubEl(), HL = stubEl();
let chained;
ok('attach 不抛（空参数也一样）', (function () {
  try { SrcMode.attach(null, null); return true; } catch (e) { return false; }
})());
ok('attach 返回同一个 API（可链式）', (function () {
  chained = SrcMode.attach(TA, HL);
  return chained === SrcMode;
})());
ok('挂了 input 监听', TA.has('input'));
ok('挂了 scroll 监听', TA.has('scroll'));
ok('挂了 click 监听', TA.has('click'));
eq('attach 后仍是关闭态', SrcMode.isOn(), false);

SrcMode.show('a\nb');
ok('show 后进入开启态', SrcMode.isOn());
eq('show 把源码写进 textarea', TA.value, 'a\nb');
eq('show 渲染出两行', (HL.innerHTML.match(/class="sl"/g) || []).length, 2);
eq('show 取消 hidden', HL.hidden, false);

TA.value = 'x\ny\nz';
SrcMode.refresh();
eq('refresh 按当前 textarea 内容重画', (HL.innerHTML.match(/class="sl"/g) || []).length, 3);
eq('refresh 同步滚动', HL.scrollTop, TA.scrollTop);
TA.scrollTop = 40; TA.scrollLeft = 12;
TA.fire('scroll');
eq('scroll 事件把行号层跟上', HL.scrollTop, 40);
eq('scroll 事件同步横向', HL.scrollLeft, 12);

SrcMode.hide();
eq('hide 后关闭态', SrcMode.isOn(), false);
eq('hide 清空高亮层', HL.innerHTML, '');
eq('hide 重新 hidden', HL.hidden, true);

/* ---------------------------------------------------------------- 接线 */
group('接线（防止以后改坏）');
const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'app', 'js', 'editor.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');

ok('index.html 有高亮层', /<pre id="source-hl"/.test(html));
ok('高亮层默认隐藏', /<pre id="source-hl"[^>]*hidden/.test(html));
ok('高亮层对读屏隐藏', /<pre id="source-hl"[^>]*aria-hidden="true"/.test(html));
ok('高亮层在 textarea 之前（先画底再放字）',
  html.indexOf('id="source-hl"') < html.indexOf('id="source-area"'));
ok('srcmode.js 被引入', /<script src="js\/srcmode\.js"><\/script>/.test(html));
ok('srcmode.js 在 ui.js 之前引入（ui 才会调 init）',
  html.indexOf('js/srcmode.js') < html.indexOf('js/ui.js'));

ok('init 里接上 attach', /SrcMode\.attach\(\s*SRCAREA\s*,\s*SRCHL\s*\)/.test(js));
ok('进源码模式时 show', /if \(window\.SrcMode\) SrcMode\.show\(/.test(js));
ok('退出源码模式时 hide', /if \(window\.SrcMode\) SrcMode\.hide\(\)/.test(js));
ok('show 在 SRCAREA 显示之后调用', (function () {
  const a = js.indexOf("SRCAREA.style.display = 'block'");
  const b = js.indexOf('SrcMode.show(');
  return a > 0 && b > a;
})());

ok('css 里 textarea 文字透明（颜色交给高亮层）', /#source-area\s*\{[^}]*color:\s*transparent/.test(css));
ok('css 里 caret 仍可见', /#source-area\s*\{[^}]*caret-color:\s*var\(--accent\)/.test(css));
ok('css 里高亮层不吃鼠标', /#source-hl\s*\{[^}]*pointer-events:\s*none/.test(css));
ok('css 里行号列 sticky', /\.sl-n\s*\{[^}]*position:\s*sticky/.test(css));
ok('css 里两层共用 tab-size', (function () {
  const m = /#source-area,\s*#source-hl\s*\{([\s\S]*?)\}/.exec(css);
  return !!m && /tab-size:\s*4/.test(m[1]);
})());
ok('css 里两层共用等宽字体', (function () {
  const m = /#source-area,\s*#source-hl\s*\{([\s\S]*?)\}/.exec(css);
  return !!m && /font-family:\s*var\(--font-mono\)/.test(m[1]);
})());

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
