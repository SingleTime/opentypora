// odt.test.js —— ODT 导出：zip 结构 / 元素映射 / 图片与脚注
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Odt = require(path.join(ROOT, 'app/js/odt.js'));
const Zip = require(path.join(ROOT, 'app/js/zip.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

function png(w, h) {
  const b = new Uint8Array(64);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4E; b[3] = 0x47; b[4] = 0x0D; b[5] = 0x0A;
  b[8] = 0x49; b[9] = 0x48; b[10] = 0x44; b[11] = 0x52;
  b[16] = (w >> 24) & 255; b[17] = (w >> 16) & 255; b[18] = (w >> 8) & 255; b[19] = w & 255;
  b[20] = (h >> 24) & 255; b[21] = (h >> 16) & 255; b[22] = (h >> 8) & 255; b[23] = h & 255;
  return b;
}

function entry(result, name) {
  const files = Zip.read(result.bytes);
  const f = files.filter((x) => x.name === name)[0];
  return f ? f.text : '';
}

const DOC = [
  '---', 'title: 测试文档', 'author: FW', '---', '',
  '# 一级标题', '',
  '正文 **粗体**、*斜体*、`code`、~~删除~~。', '',
  '## 二级标题', '',
  '- 项目一', '- 项目二', '  - 子项', '',
  '1. 第一步', '2. 第二步', '',
  '| 列A | 列B |', '| --- | --- |', '| 1 | 2 |', '',
  '```js', 'let x = 1;', '```', '',
  '脚注引用[^n1]', '',
  '[^n1]: 这是注释', ''
].join('\n');

const IMG_DOC = '# 图\n\n![示意图](assets/a.png)\n';

let R = null;

console.log('ODT 包结构');
Odt.odt(DOC, {}).then((r) => {
  R = r;
  ok('返回字节', r.bytes instanceof Uint8Array && r.bytes.length > 1000, String(r.bytes && r.bytes.length));
  ok('zip 魔数 PK', r.bytes[0] === 0x50 && r.bytes[1] === 0x4B);

  const files = Zip.read(r.bytes).map((f) => f.name);
  eq('条目顺序固定', files.join(','),
    'mimetype,content.xml,styles.xml,meta.xml,META-INF/manifest.xml');
  eq('mimetype 是第一个且不压缩', Zip.read(r.bytes)[0].text,
    'application/vnd.oasis.opendocument.text');

  const content = entry(r, 'content.xml');
  const styles = entry(r, 'styles.xml');
  const manifest = entry(r, 'META-INF/manifest.xml');

  console.log('元素映射');
  ok('标题 → text:h 带 outline-level', /<text:h text:outline-level="1"[^>]*>一级标题<\/text:h>/.test(content));
  ok('二级标题 outline-level=2', /<text:h text:outline-level="2"/.test(content));
  ok('段落 → text:p', /<text:p text:style-name="Pstd">/.test(content));
  ok('粗体 → text:span Tb', /text:style-name="Tb"/.test(content));
  ok('斜体 → text:span Ti', /text:style-name="Ti"/.test(content));
  ok('行内代码 → Tmono', /text:style-name="Tmono">code<\/text:span>/.test(content));
  ok('删除线 → Tdel', /text:style-name="Tdel"/.test(content));
  ok('列表 → text:list', /<text:list text:style-name="LB">/.test(content));
  ok('有序列表用编号样式', /<text:list text:style-name="LN">/.test(content));
  ok('嵌套列表在 list-item 内', /<text:list-item><text:p[^>]*>[^<]*<\/text:p><text:list /.test(content));
  ok('表格 → table:table', /<table:table table:name="T0" table:style-name="Tbl">/.test(content));
  eq('表格列数', (content.match(/table:number-columns-repeated="(\d+)"/) || [])[1], '2');
  ok('表头用 Thead 单元格样式', /table:style-name="Thead"/.test(content));
  ok('代码块 → Pcode 段落', /<text:p text:style-name="Pcode">let x = 1;<\/text:p>/.test(content));

  console.log('脚注与元数据');
  ok('脚注 → text:note', /<text:note text:id="ftn1" text:note-class="footnote">/.test(content));
  ok('脚注序号 1', /<text:note-citation>1<\/text:note-citation>/.test(content));
  ok('脚注正文进 note-body', /<text:note-body>[\s\S]*这是注释[\s\S]*<\/text:note-body>/.test(content));
  eq('脚注计数', r.footnotes, 1);
  eq('标题计数', r.headings, 2);
  ok('meta 带标题', /<dc:title>测试文档<\/dc:title>/.test(entry(r, 'meta.xml')));
  ok('meta 带作者', /<dc:creator>FW<\/dc:creator>/.test(entry(r, 'meta.xml')));

  console.log('样式表');
  ok('styles.xml 有 Heading_1_20_', /style:name="Heading_1_20_"/.test(styles));
  ok('Heading 带 default-outline-level', /style:default-outline-level="1"/.test(styles));
  ok('页面 A4 + 2.5cm 边距', /fo:page-width="21cm"/.test(styles) && /fo:margin-left="2.5cm"/.test(styles));
  ok('等宽字体声明', /<style:font-face style:name="Mono"/.test(styles));

  console.log('manifest');
  ok('根目录条目声明 odt 类型', /manifest:full-path="\/"[\s\S]*?application\/vnd\.oasis\.opendocument\.text/.test(manifest));
  ok('content.xml 已登记', /manifest:full-path="content.xml"/.test(manifest));

  console.log('空文档');
  return Odt.odt('', {});
}).then((empty) => {
  ok('空文档也能生成', empty.bytes instanceof Uint8Array && empty.bytes.length > 500);
  eq('空文档零标题', empty.headings, 0);
  eq('空文档无警告', empty.warnings.length, 0);

  console.log('图片');
  return Odt.odt(IMG_DOC, {
    resolveImage: () => ({ bytes: png(480, 240), mime: 'image/png' })
  });
}).then((im) => {
  const files = Zip.read(im.bytes);
  const names = files.map((f) => f.name);
  ok('Pictures/img1.png 进包', names.indexOf('Pictures/img1.png') >= 0, names.join(','));
  const content = entry(im, 'content.xml');
  ok('引用 Pictures 路径', /xlink:href="Pictures\/img1\.png"/.test(content));
  ok('draw:frame 带 as-char 锚', /text:anchor-type="as-char"/.test(content));
  ok('宽 480px → 12.7cm', /svg:width="12\.7cm"/.test(content));
  ok('高 240px → 6.35cm', /svg:height="6\.35cm"/.test(content));
  eq('图片计数', im.images, 1);
  ok('manifest 登记图片', /manifest:full-path="Pictures\/img1\.png" manifest:media-type="image\/png"/.test(entry(im, 'META-INF/manifest.xml')));

  console.log('图片读不到时');
  return Odt.odt(IMG_DOC, { resolveImage: () => null });
}).then((miss) => {
  const content = entry(miss, 'content.xml');
  ok('用文字占位', /\[图片：示意图\]/.test(content));
  eq('给出警告', miss.warnings.length, 1);
  ok('警告里带路径', /assets\/a\.png/.test(miss.warnings[0]));

  console.log('图片尺寸解析 / 单位换算');
  const s = Odt.imgSize(png(1000, 500));
  ok('PNG 尺寸', s && s.w === 1000 && s.h === 500, JSON.stringify(s));
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]);
  const g = Odt.imgSize(gif);
  ok('GIF 尺寸', g && g.w === 800 && g.h === 600, JSON.stringify(g));
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x2C, 0x02, 0x58, 0, 0, 0, 0, 0, 0, 0, 0]);
  const j = Odt.imgSize(jpg);
  ok('JPEG 尺寸（SOF0）', j && j.w === 600 && j.h === 300, JSON.stringify(j));
  ok('不是图片时返回 null', Odt.imgSize(new Uint8Array([1, 2, 3, 4])) === null);
  eq('96dpi 下 960px = 25.4cm', Odt.sizeCm(960), 25.4);
}).then(() => {
  // 独立验证封顶逻辑
  return Odt.odt('![w](a.png)', {
    resolveImage: () => ({ bytes: png(3000, 1500), mime: 'image/png' })
  });
}).then((wide) => {
  const c = entry(wide, 'content.xml');
  ok('3000px 宽封顶 15cm', /svg:width="15cm"/.test(c));
  ok('封顶后高度按比例缩放', /svg:height="7\.5cm"/.test(c), (c.match(/svg:height="[^"]+"/) || [])[0]);
  return Odt.odt('```\n<div>&amp; "x"\n```\n', {});
}).then((esc) => {
  const c = entry(esc, 'content.xml');
  ok('代码里的 < & 已转义', /&lt;div&gt;&amp;amp;/.test(c), (c.match(/Pcode">[^<]*/) || [])[0]);
  return Odt.odt('段落  两个空格\n', {});
}).then((sp) => {
  ok('段内双空格转 text:s', /<text:s text:c="2"\/>/.test(entry(sp, 'content.xml')));
  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.error('异常：', e && e.stack || e);
  process.exit(1);
});
