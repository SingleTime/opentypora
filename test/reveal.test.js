// reveal.test.js —— RevealJS 幻灯片导出（分页规则、内容、图片内嵌、脚注）
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const E = require(path.join(ROOT, 'app/js/export.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

function count(hay, re) { return (hay.match(re) || []).length; }

const DECK = [
  '# 第一章', '',
  '开场段落。', '',
  '## 第一节', '',
  '- 甲', '- 乙', '',
  '## 第二节', '',
  '```js', 'let x = 1 < 2;', '```', '',
  '# 第二章', '',
  '| 列A | 列B |', '| --- | --- |', '| 1 | 2 |', '',
  '> 引用', '',
  '脚注[^n1]', '',
  '[^n1]: 注释', '',
  '[TOC]', ''
].join('\n');

(async function () {
  const r = await E.reveal(DECK, { title: '演示 <文稿>' });
  const t = r.text;

  console.log('骨架');
  ok('DOCTYPE', /^<!DOCTYPE html>/.test(t));
  ok('html lang', /<html lang="zh-CN">/.test(t));
  ok('标题做了转义', /<title>演示 &lt;文稿&gt;<\/title>/.test(t), (t.match(/<title>.*<\/title>/) || [])[0]);
  ok('引入 reveal.css', /reveal\.js@4\.6\.1\/dist\/reveal\.css/.test(t));
  ok('主题可换', /theme\/white\.css" id="theme"/.test(t));
  ok('初始化调用', /Reveal\.initialize\(\{/.test(t));
  ok('离线降级开关', /documentElement\.className \+= " no-reveal"/.test(t) && /\.no-reveal \.reveal \.slides section/.test(t));
  ok('.slides 容器', /<div class="reveal">\s*<div class="slides">/.test(t));

  console.log('分页');
  ok('有 h1 时按 h1 横向分页', count(t, /<h1 id="sec\d"/g) === 2, String(count(t, /<h1 id="sec\d"/g)));
  ok('h2 变成纵向子页', /<section><h2 id="sec2">[\s\S]*?<\/section>/.test(t));
  ok('h1 页里含正文段落', /<h1 id="sec1">[\s\S]*?开场段落。/.test(t));
  ok('第二个 h1 是新的一页', /<\/section>\s*<section>\s*<h1 id="sec4"/.test(t));
  ok('有纵向子页时父 section 只包 section（reveal 的 stack 规则）',
    /<section>\s*<section><h1 id="sec1">[\s\S]*?<\/section>\s*<section><h2 id="sec2">/.test(t),
    (t.match(/<div class="slides">[\s\S]{0,220}/) || [])[0]);
  ok('没有子页的 h1 不额外包一层', /<\/section>\n<section>\n<h1 id="sec4">/.test(t));
  eq('页数（含纵向子页与脚注页）', r.slides, 5);
  const vert = await E.reveal('# 一\n\n## a\n\n## b\n\n# 二\n', { title: 'x' });
  eq('纵向子页也算一页', vert.slides, 4);

  const noH1 = await E.reveal('## 甲\n\n一\n\n## 乙\n\n二\n', { title: 'x' });
  ok('没有 h1 时 h2 当横向页', count(noH1.text, /<h2 id="sec\d"/g) >= 2 && noH1.slides === 2, String(noH1.slides));

  const noHead = await E.reveal('只有一段话', { title: 'x' });
  ok('没有标题也给一页', noHead.slides === 1 && /<section>[\s\S]*只有一段话/.test(noHead.text));

  const h3 = await E.reveal('# 一\n\n### 深一层\n\n内容\n', { title: 'x' });
  ok('低于幻灯片层级的标题留在页内', /<h3 id="sec2"/.test(h3.text) && h3.slides === 1, String(h3.slides));

  console.log('内容');
  ok('代码块带语言类', /<pre><code class="language-js">let x = 1 &lt; 2;<\/code><\/pre>/.test(t), (t.match(/<pre>[\s\S]{0,80}/) || [])[0]);
  ok('表格转成语义 table', /<table><thead><tr><th>[\s\S]*?<td>/.test(t));
  ok('列表', /<ul><li>[\s\S]*?甲/.test(t));
  ok('引用', /<blockquote>[\s\S]*?引用/.test(t));
  ok('脚注引用变成锚点', /<a class="fn-ref" href="#fn1">1<\/a>/.test(t));
  ok('末尾脚注页', /<section class="footnotes">[\s\S]*?<li id="fn1">/.test(t));
  ok('不是 slides 属性的裸 div', !/data-i=/.test(t) && !/data-s=/.test(t));

  console.log('目录');
  ok('TOC 占位被换成列表', /<nav class="toc">/.test(t) && !/toc-body/.test(t));
  ok('目录项带锚点', /<a href="#sec1">第一章<\/a>/.test(t));

  console.log('图片');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const withImg = await E.reveal('![图](assets/a.png)\n', {
    title: 'x',
    resolveImage: function (src) {
      return src === 'assets/a.png' ? Promise.resolve({ bytes: png, mime: 'image/png' }) : Promise.resolve(null);
    }
  });
  ok('读得到字节就内嵌 data URI', /src="data:image\/png;base64,iVBORw0KGgo="/.test(withImg.text), (withImg.text.match(/<img[^>]*>/) || [])[0]);
  const noResolver = await E.reveal('![图](assets/a.png)\n', { title: 'x' });
  ok('没有 resolver 时保留原路径', /<img[^>]*src="assets\/a\.png"/.test(noResolver.text));
  const broken = await E.reveal('![图](assets/b.png)\n', {
    title: 'x', resolveImage: function () { return Promise.resolve(null); }
  });
  ok('读不到就保持原样不报错', /assets\/b\.png/.test(broken.text));

  console.log('边界');
  const mdOnly = await E.reveal('# 一\n\n[[笔记]]\n\n<div class="x">原文</div>\n', { title: 'x' });
  ok('wiki 链接退成文字', /<span class="wiki">[\s\S]*?笔记/.test(mdOnly.text), (mdOnly.text.match(/wiki[\s\S]{0,40}/) || [])[0]);
  ok('HTML 块只留文字', /原文/.test(mdOnly.text) && !/<div class="x">/.test(mdOnly.text));

  const listed = await E.build('revealjs', '# 一\n', { title: 'x' });
  ok('build 分发到 reveal', /<div class="slides">/.test(listed.text));
  eq('formats 里有 revealjs', E.formats.revealjs.ext, 'html');
  ok('导出入口暴露 reveal', typeof E.reveal === 'function');

  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
