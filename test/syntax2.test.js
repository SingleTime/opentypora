// syntax2.test.js —— P0 语法扩展（引用式链接/裸 URL/上下标/Emoji/行内 HTML/Callout/引用续行）
// 纯 Node，不需要 WKWebView。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MD = require(path.join(ROOT, 'app/js/md.js'));
const Inline = require(path.join(ROOT, 'app/js/inline.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'got: ' + JSON.stringify(actual) + '  want: ' + JSON.stringify(expect));
}
function html(src) {
  const m = MD.parse(src);
  return MD.renderBlocks(m.blocks, true);
}
function toks(src) { return Inline.tokenize(src); }

console.log('引用式链接 / 图片');
{
  const src = '看 [官网][site] 和 [标题][] 还有 [site]。\n\n![图][pic]\n\n[site]: https://a.example "A"\n[标题]: https://b.example\n[pic]: p.png "P"\n';
  const m = MD.parse(src);
  eq('定义行不入段落', m.blocks.filter(b => b.type === 'linkdef').length, 3);
  eq('定义表 id', Object.keys(m.defs).sort().join(','), 'pic,site,标题');
  const h = MD.renderBlocks(m.blocks, true);
  ok('引用式链接 href', h.indexOf('href="https://a.example"') > 0);
  ok('引用式链接 title', h.indexOf('title="A"') > 0);
  ok('折叠式 [标题][]', h.indexOf('href="https://b.example"') > 0);
  ok('短形式 [site]', h.indexOf('>site</span></a>') > 0, h);
  ok('引用式图片', h.indexOf('src="p.png"') > 0 && h.indexOf('alt="图"') > 0);
  eq('序列化无损', MD.serialize(m), src);
  const noDef = html('空 [site] 无定义\n');
  ok('无定义时保持原文', noDef.indexOf('[site]') > 0 && noDef.indexOf('<a') < 0, noDef);
  ok('定义行渲染为空', MD.renderBlock(m.blocks[3]).html === '');
}

console.log('裸 URL 自动链接');
{
  const h = html('见 https://example.com/a?b=1 和 www.apple.com 以及 api@x.com。\n');
  ok('https 自动链接', h.indexOf('href="https://example.com/a?b=1"') > 0);
  ok('www 补 http://', h.indexOf('href="http://www.apple.com"') > 0);
  ok('中文标点不入链接', h.indexOf('href="https://example.com/a?b=1"') > 0 && h.indexOf('href="http://www.apple.com"') > 0);
  const trail = html('see https://x.com/a. done\n');
  ok('句号被剔除', trail.indexOf('href="https://x.com/a"') > 0, trail);
  const paren = html('(https://x.com/a_(b)) end\n');
  ok('成对括号保留', paren.indexOf('https://x.com/a_(b)') > 0, paren);
  const inCode = html('`https://x.com` 与 [a](https://y.com)\n');
  eq('代码与显式链接不重复处理', (inCode.match(/class="bare-url"/g) || []).length, 0);
}

console.log('上标 / 下标');
{
  const h = html('水 H~2~O，能量 E=mc^2^，~~删除~~ 仍是删除线。\n');
  ok('下标', h.indexOf('<sub') > 0 && h.indexOf('>2<') > 0);
  ok('上标', h.indexOf('<sup') > 0 && h.indexOf('>2<') > 0);
  ok('删除线不受影响', h.indexOf('<del') > 0);
  const noSpace = html('a ~ b ~ c\n');
  ok('带空白不转换', noSpace.indexOf('<sub') < 0, noSpace);
}

console.log('Emoji shortcode');
{
  const h = html('心情 :smile: 开工 :rocket: 时间 10:30 比例 1:2:3\n');
  ok(':smile: → 😄', h.indexOf('😄') > 0);
  ok(':rocket: → 🚀', h.indexOf('🚀') > 0);
  ok('时间不被误判', h.indexOf('10:30') > 0);
  ok('未知 shortcode 保持原样', html('试 :nosuchcode: 一下\n').indexOf(':nosuchcode:') > 0);
  eq('代码内不转换', (html('`:smile:`\n').match(/😄/g) || []).length, 0);
}

console.log('行内 HTML');
{
  const h = html('这是 <u>下划线</u>、<span style="color:#c00">红</span>、<kbd>Cmd</kbd>、<sup>2</sup>、<br>换行\n');
  ok('<u> 生效', h.indexOf('<u') === -1 ? false : true);
  ok('<span style> 生效', h.indexOf('style="color:#c00"') > 0);
  ok('<kbd> 生效', h.indexOf('<kbd') > 0);
  ok('<sup> 生效', h.indexOf('<sup') > 0);
  ok('<br> 生效', h.indexOf('<br>') > 0);
  const evil = html('<span onclick="alert(1)" style="x:expression(1)">x</span>\n');
  ok('事件属性被剥', evil.indexOf('onclick') < 0);
  ok('expression 被剥', evil.indexOf('expression') < 0);
  const bad = html('<b>没闭合的标签\n');
  ok('未闭合标签不吞内容', bad.indexOf('没闭合的标签') > 0, bad);
  const plainTag = html('<div>块级仍是 HTML 块</div>\n');
  ok('块级 HTML 走 html 块', plainTag.indexOf('html-body') > 0, plainTag);
}

console.log('Callouts');
{
  const h = html('> [!NOTE]\n> 提示一\n> 提示二\n');
  ok('callout class', h.indexOf('callout-note') > 0);
  ok('标题 Note', h.indexOf('>Note<') > 0);
  ok('正文保留', h.indexOf('提示一') > 0 && h.indexOf('提示二') > 0);
  ok('标记不显示', h.indexOf('[!NOTE]') < 0);
  ok('五种类型', ['TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].every(function (t) {
    return html('> [!' + t + ']\n> x\n').indexOf('callout-' + t.toLowerCase()) > 0;
  }));
  const custom = html('> [!TIP] 自定义标题\n> x\n');
  ok('自定义标题', custom.indexOf('>自定义标题<') > 0, custom);
  const plain = html('> 普通引用\n');
  ok('普通引用不受影响', plain.indexOf('callout') < 0);
  const m = MD.parse('> [!NOTE]\n> 提示\n');
  eq('callout 无损序列化', MD.serialize(m), '> [!NOTE]\n> 提示\n');
}

console.log('导出侧 token（docx / LaTeX / ePub 共用）');
{
  const src = '[a][id] https://x.com H~2~O X^2^ <u>u</u> :smile:\n\n[id]: https://id.example\n';
  Inline.setDefs(Inline.scanDefs(src));
  const t = toks('[a][id] https://x.com H~2~O X^2^ <u>u</u> :smile:');
  const kinds = t.map(function (x) { return x.t; }).join(',');
  ok('引用式链接 token', kinds.indexOf('link') >= 0);
  ok('裸 URL token', t.some(x => x.t === 'link' && x.href === 'https://x.com'));
  ok('上标 token', t.some(x => x.t === 'sup'));
  ok('下标 token', t.some(x => x.t === 'sub'));
  ok('下划线 token', t.some(x => x.t === 'u'));
  ok('Emoji 变文字', Inline.plain(t).indexOf('😄') >= 0);
  eq('plain 上标', Inline.plain([{ t: 'sup', kids: [{ t: 'text', v: '2' }] }]), '2');
  const imgTok = toks('![图][pic]');
  Inline.setDefs({ pic: { href: 'q.png', title: '' } });
  ok('引用式图片 token', Inline.tokenize('![图][pic]')[0].src === 'q.png');
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
