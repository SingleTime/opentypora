// epub.test.js —— ePub 导入（spine 顺序、图片出包、脚注、deflate 解压）
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const E = require(path.join(ROOT, 'app/js/export.js'));
const Zip = require(path.join(ROOT, 'app/js/zip.js'));
const Importer = require(path.join(ROOT, 'app/js/importer.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra) : '')); }
}
function has(name, md, re) { ok(name, re.test(md), md.replace(/\n/g, '⏎').slice(0, 200)); }
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// 真实 ePub 几乎都是 deflate，而 Zip.build 只会 store，所以这里手写一个
function deflateZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  files.forEach(function (f) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = Zip.crc32(new Uint8Array(raw));
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBytes, comp);
    central.push({ nameBytes: nameBytes, crc: crc, csize: comp.length, usize: raw.length, offset: offset });
    offset += 30 + nameBytes.length + comp.length;
  });
  const cdStart = offset;
  const cdParts = [];
  central.forEach(function (c) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.csize, 20);
    ch.writeUInt32LE(c.usize, 24);
    ch.writeUInt16LE(c.nameBytes.length, 28);
    ch.writeUInt32LE(c.offset, 42);
    cdParts.push(ch, c.nameBytes);
  });
  const cd = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat(chunks.concat([cd, eocd])));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01]);

const SRC = [
  '# 第一章', '',
  '正文 **粗体** 与 [链接](https://example.com)。', '',
  '- 项目一', '- 项目二', '',
  '| 列A | 列B |', '| --- | --- |', '| 1 | 2 |', '',
  '```js', 'let x = 1 < 2;', '```', '',
  '![图](assets/a.png)', '',
  '第二张![图](assets/a.png)', '',
  '脚注[^n1]', '',
  '[^n1]: 注释内容', ''
].join('\n');

(async function () {
  console.log('导出再导入（store）');
  const built = await E.build('epub', SRC, {
    title: '示例书',
    resolveImage: function () { return Promise.resolve({ bytes: PNG, mime: 'image/png' }); }
  });
  const r = await Importer.convert('epub', Buffer.from(built.bytes).toString('base64'), { assetDir: 'media/' });

  eq('标题从 dc:title 取', r.title, '示例书');
  has('一级标题', r.markdown, /^# 第一章$/m);
  has('粗体', r.markdown, /\*\*粗体\*\*/);
  has('链接', r.markdown, /\[链接\]\(https:\/\/example\.com\)/);
  has('列表', r.markdown, /^- 项目一$/m);
  has('表格', r.markdown, /^\| 列A \| 列B \|$/m);
  has('代码块保留语言', r.markdown, /```js\nlet x = 1 < 2;\n```/);
  has('图片改成资产路径', r.markdown, /!\[图\]\(media\/img1\.png\)/);
  eq('重复图片只出一份', r.assets.length, 1);
  eq('资产路径带 assetDir', r.assets[0].path, 'media/img1.png');
  ok('资产带 base64', typeof r.assets[0].base64 === 'string' && r.assets[0].base64.length > 8);
  has('脚注引用还原成 [^n]', r.markdown, /脚注\[\^1\]/);
  has('脚注定义', r.markdown, /^\[\^1\]: 注释内容$/m);
  ok('没有把脚注页正文抄进来', !/↩/.test(r.markdown), r.markdown);
  ok('导航页不进正文', !/<nav|目录/.test(r.markdown));

  console.log('deflate 的 ePub');
  const chapter = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body>' +
    '<h2>压缩章</h2><p>来自 deflate 的正文。</p>' +
    '<p><img src="../Images/cover.jpeg" alt="封面" /></p>' +
    '</body></html>';
  const opf = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>压缩书</dc:title></metadata>' +
    '<manifest>' +
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
    '<item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="img" href="Images/cover.jpeg" media-type="image/jpeg"/>' +
    '</manifest><spine><itemref idref="c1"/></spine></package>';
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const nav = '<html><body><nav><ol><li><a href="Text/ch1.xhtml">章</a></li></ol></nav></body></html>';
  const bytes = deflateZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/Text/ch1.xhtml', data: chapter },
    { name: 'OEBPS/Images/cover.jpeg', data: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 1, 2, 3]) }
  ]);

  const r2 = await Importer.convert('epub', Buffer.from(bytes).toString('base64'), {});
  eq('deflate 也能解出标题', r2.title, '压缩书');
  has('章节标题', r2.markdown, /^## 压缩章$/m);
  has('段落', r2.markdown, /来自 deflate 的正文。/);
  has('子目录图片解析成资产', r2.markdown, /!\[封面\]\(assets\/media\/cover\.jpeg\)/);
  eq('资产默认目录', r2.assets[0].path, 'assets/media/cover.jpeg');
  ok('导航页被跳过', !/nav|目录/.test(r2.markdown), r2.markdown);

  console.log('异常');
  let threw = '';
  try {
    await Importer.convert('epub', Buffer.from('not a zip').toString('base64'), {});
  } catch (e) { threw = e.message || String(e); }
  ok('不是 zip 时给出明确错误', /zip|EOCD|ePub/i.test(threw), threw);

  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
