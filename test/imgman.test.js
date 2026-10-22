// imgman.test.js —— 图片管理纯函数：路径解析 / 引用扫描 / 改写 / 命名去重
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const I = require(path.join(ROOT, 'app/js/imgman.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

console.log('本地路径判定');
{
  ok('相对路径是本地', I.isLocal('assets/a.png'));
  ok('绝对路径是本地', I.isLocal('/Users/x/a.png'));
  ok('http 不是本地', !I.isLocal('https://x/a.png'));
  ok('data URI 不是本地', !I.isLocal('data:image/png;base64,AAA'));
  ok('file: 不算本地（按绝对路径处理）', !I.isLocal('file:///a.png'));
  ok('锚点不是本地', !I.isLocal('#top'));
  ok('空串不是本地', !I.isLocal(''));
}

console.log('路径工具');
{
  eq('取目录', I.dirOf('/a/b/c.md'), '/a/b');
  eq('根目录', I.dirOf('/c.md'), '/');
  eq('无目录', I.dirOf('c.md'), '');
  eq('取文件名', I.baseOf('/a/b/c.md'), 'c.md');
  eq('取扩展名', I.extOf('/a/b/c.PNG'), '.PNG');
  eq('无扩展名', I.extOf('/a/b/c'), '');
  eq('折叠 .', I.normalize('/a/./b/../c'), '/a/c');
  eq('保留前导 ..', I.normalize('../a/b'), '../a/b');
  eq('拼接', I.join('/a/b', '../img/x.png'), '/a/img/x.png');
  eq('拼绝对路径覆盖', I.join('/a/b', '/x/y.png'), '/x/y.png');
  eq('相对路径', I.relPath('/a/b', '/a/b/img/x.png'), 'img/x.png');
  eq('向上两级', I.relPath('/a/b/c', '/a/x.png'), '../../x.png');
  eq('同一层', I.relPath('/a/b', '/a/b.png'), '../b.png');
  eq('跨根目录', I.relPath('/a', '/b/x.png'), '../b/x.png');
  eq('目标不是绝对路径时原样返回', I.relPath('/a', 'rel/x.png'), 'rel/x.png');
}

console.log('front matter 选项');
{
  const fm = '---\ntitle: x\ntypora-root-url: ./res\ntypora-copy-images-to: assets/md\n---\n\n正文\n';
  const o = I.parseFront(fm);
  ok('识别到 front matter', o.found);
  eq('root-url', o.rootUrl, './res');
  eq('copy-images-to', o.copyTo, 'assets/md');

  const quoted = '---\ntypora-root-url: "/abs/res"\n---\n';
  eq('去引号', I.parseFront(quoted).rootUrl, '/abs/res');

  ok('没有 front matter', !I.parseFront('# 标题\n').found);
  eq('缺省为空', I.parseFront('').rootUrl, '');
  const other = '---\ntags: [a]\n---\n';
  eq('无关键不影响', I.parseFront(other).copyTo, '');
}

console.log('图片目录');
{
  eq('默认 assets', I.imgDir('/d/doc.md', ''), '/d/assets');
  eq('相对 copy-to', I.imgDir('/d/doc.md', 'pics'), '/d/pics');
  eq('绝对 copy-to', I.imgDir('/d/doc.md', '/srv/img'), '/srv/img');
  eq('文档未保存时返回空', I.imgDir('', ''), '');
  eq('root-url 绝对', I.rootDir('/d/doc.md', '/srv/res'), '/srv/res');
  eq('root-url 相对', I.rootDir('/d/doc.md', '../res'), '/res');
  eq('root-url 为空', I.rootDir('/d/doc.md', ''), '');
}

console.log('引用扫描');
{
  const raw = '文字 ![alt](assets/a.png) 中间 ![b](<x y.png> "标题") 尾巴';
  const list = I.refs(raw);
  eq('扫到两张', list.length, 2);
  eq('第一张 href', list[0].href, 'assets/a.png');
  eq('第一张 alt', list[0].alt, 'alt');
  eq('第二张带尖括号路径', list[1].href, 'x y.png');
  eq('第二张 title', list[1].title, '标题');
  eq('偏移能切片还原', raw.slice(list[0].start, list[0].end), '![alt](assets/a.png)');

  const sized = I.refs('![a](b.png =300x200)')[0];
  eq('尺寸宽', sized.w, 300);
  eq('尺寸高', sized.h, 200);

  eq('转义的感叹号不算', I.refs('\\![a](b.png)').length, 0);
  eq('引用式图片不算（无 href）', I.refs('![a][id]').length, 0);
  eq('普通链接不算', I.refs('[a](b.md)').length, 0);
}

console.log('引用改写');
{
  const raw = '前 ![a](old.png) 后 ![b](keep.png)';
  const out = I.rewrite(raw, { 'old.png': 'assets/old.png' });
  eq('只改命中项', out, '前 ![a](assets/old.png) 后 ![b](keep.png)');
  eq('没命中返回原串', I.rewrite(raw, { 'x.png': 'y.png' }), raw);
  eq('同值不算改动', I.rewrite(raw, { 'old.png': 'old.png' }), raw);

  const withTitle = I.rewrite('![a](o.png "t" =120)', { 'o.png': 'n.png' });
  eq('保留 title 与尺寸', withTitle, '![a](n.png "t" =120)');

  const space = I.rewrite('![](o.png)', { 'o.png': 'a b.png' });
  eq('含空格加尖括号', space, '![](<a b.png>)');
}

console.log('命名去重');
{
  const taken = { 'a.png': 1, 'a-2.png': 1 };
  eq('不重名原样', I.uniqueName('b.png', function (n) { return !!taken[n]; }), 'b.png');
  eq('重名加 -3', I.uniqueName('a.png', function (n) { return !!taken[n]; }), 'a-3.png');
  eq('无扩展名', I.uniqueName('Makefile', function (n) { return n === 'Makefile'; }), 'Makefile-2');
}

console.log('文档上下文换算');
{
  const doc = '/d/sub/doc.md';
  const ctx = I.context(doc, '---\ntypora-root-url: ./res\n---\n');
  eq('docDir', ctx.docDir, '/d/sub');
  eq('root 目录', ctx.root, '/d/sub/res');
  eq('默认目标目录', ctx.dest, '/d/sub/assets');
  eq('相对图转绝对', I.absOf('assets/a.png', ctx), '/d/sub/res/assets/a.png');
  eq('绝对图保持', I.absOf('/srv/a.png', ctx), '/srv/a.png');
  eq('回写相对', I.hrefOf('/d/sub/res/x.png', ctx), 'x.png');
  eq('回写到 assets', I.hrefOf('/d/sub/assets/x.png', ctx), '../assets/x.png');

  const plain = I.context(doc, '');
  eq('没有 root-url 时按文档目录', I.absOf('assets/a.png', plain), '/d/sub/assets/a.png');
  eq('没有 root-url 时回写', I.hrefOf('/d/sub/assets/a.png', plain), 'assets/a.png');

  const nested = I.context(doc, '---\ntypora-copy-images-to: media\n---\n');
  eq('copy-to 生效', nested.dest, '/d/sub/media');
}

console.log('远程图片');
{
  ok('http 是远程', I.isRemote('http://a/b.png'));
  ok('https 是远程', I.isRemote('https://a/b.png'));
  ok('大小写不敏感', I.isRemote('HTTPS://a/b.png'));
  ok('本地不是远程', !I.isRemote('assets/a.png'));
  ok('data URI 不是远程', !I.isRemote('data:image/png;base64,AAA'));
  ok('空值不是远程', !I.isRemote('') && !I.isRemote(null));

  eq('取末段文件名', I.downloadName('https://cdn.x.com/p/img/photo.png'), 'photo.png');
  eq('去掉 query', I.downloadName('https://x.com/a.png?w=200&h=100'), 'a.png');
  eq('去掉 hash', I.downloadName('https://x.com/a.jpg#frag'), 'a.jpg');
  eq('URL 解码', I.downloadName('https://x.com/%E5%9B%BE%201.png'), '图-1.png');
  eq('没有文件名时给 image.png', I.downloadName('https://x.com/'), 'image.png');
  eq('没有扩展名补 .png', I.downloadName('https://x.com/photo'), 'photo.png');
  eq('非法字符换横线', I.downloadName('https://x.com/a:b*c.png'), 'a-b-c.png');
  eq('空串兜底', I.downloadName(''), 'image.png');

  const raw = '![远程](https://x.com/a.png) 与 ![本地](assets/b.png)';
  const list = I.remoteRefs(raw);
  eq('只挑出远程引用', list.length, 1);
  eq('挑对了', list[0].href, 'https://x.com/a.png');
  eq('没有远程时为空', I.remoteRefs('![](assets/a.png)').length, 0);
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
