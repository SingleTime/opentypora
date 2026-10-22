/* Node 单测：内置导出引擎（zip / docx / epub / latex）
 * 除了结构断言，还会把文件真的写到 /tmp，再用 python 的
 * zipfile + ElementTree 逐个部件验 XML 是否良构、unzip 是否通过。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');

const Zip = require('../app/js/zip.js');
const Docx = require('../app/js/docx.js');
const Export = require('../app/js/export.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).split('\n')[0]); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).split('\n')[0]); }
}

const TMP = path.join(os.tmpdir(), 'opentypora-export-test');
fs.mkdirSync(TMP, { recursive: true });

function files(bytes) {
  const out = {};
  Zip.read(bytes).forEach(e => { if (e.text != null) out[e.name] = e.text; });
  return out;
}
function entry(bytes, name) {
  return Zip.read(bytes).find(e => e.name === name);
}

// 造一张真实 PNG（120×80），验证像素尺寸嗅探与 EMU 换算
function makePng(w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) { raw[p++] = (x * 2) & 255; raw[p++] = (y * 3) & 255; raw[p++] = 200; }
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32b(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  }
  function crc32b(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const PNG = makePng(120, 80);

const DOC = [
  '---',
  'title: 导出测试',
  'author: FW',
  '---',
  '',
  '[TOC]',
  '',
  '# 第一章',
  '',
  '正文**粗**、*斜*、~~删~~、==亮==、`code`，[链接](https://ex.com/a?b=1&c=2 "标题")。',
  '',
  '脚注先引 b[^b]，再引 a[^a]。',
  '',
  '## 1.1 列表',
  '',
  '- 一',
  '- 二',
  '  - 二.一',
  '',
  '1. 甲',
  '2. 乙',
  '',
  '### 1.1.1 表',
  '',
  '| 左 | 中 | 右 |',
  '|:---|:--:|---:|',
  '| a | b | c |',
  '',
  '```js',
  'const x = 1;',
  '\tif (x) { y(); }',
  '```',
  '',
  '> 引用一段',
  '',
  '---',
  '',
  '![图](pic.png)',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  '[^a]: 甲注释',
  '[^b]: 乙注释 **粗**',
  ''
].join('\n');

/* ============================================================ */
console.log('\n[1] ZIP 写入器');

t('crc32 标准测试向量', () => {
  assert.strictEqual(Zip.crc32(Zip.utf8('')), 0);
  assert.strictEqual(Zip.crc32(Zip.utf8('123456789')), 0xCBF43926);
  assert.strictEqual(Zip.crc32(Zip.utf8('The quick brown fox jumps over the lazy dog')), 0x414FA339);
});

t('build → read 往返无损（含中文文件名）', () => {
  const z = Zip.build([
    { name: 'a.txt', data: 'hello' },
    { name: '目录/中文.md', data: '# 标题\n内容' },
    { name: 'bin.dat', data: new Uint8Array([0, 255, 7, 128]) }
  ]);
  const r = Zip.read(z);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].text, 'hello');
  assert.strictEqual(r[1].name, '目录/中文.md');
  assert.strictEqual(r[1].text, '# 标题\n内容');
  assert.deepStrictEqual(Array.from(r[2].data), [0, 255, 7, 128]);
});

t('store 模式：method 全 0、mimetype 排第一', () => {
  const z = Zip.build([{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'x', data: 'y' }]);
  const r = Zip.read(z);
  assert.strictEqual(r[0].name, 'mimetype');
  assert.ok(r.every(e => e.method === 0));
  assert.strictEqual(r[0].usize, 20);
});

/* ============================================================ */
console.log('\n[2] docx 结构');

const docxOpts = {
  title: '导出测试',
  resolveImage: () => Promise.resolve({ bytes: new Uint8Array(PNG), mime: 'image/png' })
};
let DOCX_RES = null;

(async () => {
  await ta('必需部件齐全且 XML 良构', async () => {
    DOCX_RES = await Docx.build(DOC, docxOpts);
    fs.writeFileSync(path.join(TMP, 'a.docx'), Buffer.from(DOCX_RES.bytes));
    const f = files(DOCX_RES.bytes);
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
      'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml',
      'word/footnotes.xml', 'word/media/image1.png'].forEach(n => {
        assert.ok(Object.prototype.hasOwnProperty.call(f, n) || entry(DOCX_RES.bytes, n), '缺部件 ' + n);
      });
  });

  await ta('document.xml 有 body/sectPr，标题用 Heading 样式', async () => {
    const f = files(DOCX_RES.bytes);
    const d = f['word/document.xml'];
    assert.ok(/<w:body>/.test(d) && /<w:sectPr>/.test(d));
    assert.ok(/<w:pStyle w:val="Heading1"\/>/.test(d));
    assert.ok(/<w:pStyle w:val="Heading2"\/>/.test(d));
    assert.ok(/<w:pStyle w:val="Heading3"\/>/.test(d));
  });

  await ta('行内样式：粗/斜/删除线/高亮/行内代码', async () => {
    const d = files(DOCX_RES.bytes)['word/document.xml'];
    assert.ok(/<w:b\/>/.test(d), '缺粗体');
    assert.ok(/<w:i\/>/.test(d), '缺斜体');
    assert.ok(/<w:strike\/>/.test(d), '缺删除线');
    assert.ok(/<w:highlight w:val="yellow"\/>/.test(d), '缺高亮');
    assert.ok(/<w:rStyle w:val="CodeChar"\/>/.test(d), '缺行内代码样式');
  });

  await ta('链接走真超链接关系（TargetMode=External）', async () => {
    const f = files(DOCX_RES.bytes);
    assert.ok(/<w:hyperlink r:id="rId\d+">/.test(f['word/document.xml']));
    const rels = f['word/_rels/document.xml.rels'];
    assert.ok(/relationships\/hyperlink/.test(rels));
    assert.ok(/TargetMode="External"/.test(rels));
    assert.ok(/https:\/\/ex\.com\/a\?b=1&amp;c=2/.test(rels), 'URL 里的 & 没转义');
  });

  await ta('列表：无序 numId=1，有序 numId=2 且是 decimal', async () => {
    const f = files(DOCX_RES.bytes);
    const d = f['word/document.xml'];
    assert.ok(/<w:numId w:val="1"\/>/.test(d), '无序列表 numId 丢了');
    assert.ok(/<w:numId w:val="2"\/>/.test(d), '有序列表 numId 丢了');
    assert.ok(/<w:ilvl w:val="1"\/>/.test(d), '嵌套层级丢了');
    const n = f['word/numbering.xml'];
    assert.ok(/<w:numFmt w:val="decimal"\/>/.test(n));
    assert.ok(/<w:abstractNum w:abstractNumId="101">/.test(n));
  });

  await ta('表格：tblHeader + 三列 + 单元格对齐', async () => {
    const d = files(DOCX_RES.bytes)['word/document.xml'];
    assert.ok(/<w:tbl>/.test(d));
    assert.ok(/<w:tblHeader\/>/.test(d));
    assert.strictEqual((d.match(/<w:gridCol /g) || []).length, 3);
    assert.ok(/<w:jc w:val="center"\/>/.test(d), '居中列丢了');
    assert.ok(/<w:jc w:val="right"\/>/.test(d), '右对齐列丢了');
  });

  await ta('代码块：换行用 w:br，缩进保留', async () => {
    const d = files(DOCX_RES.bytes)['word/document.xml'];
    assert.ok(/<w:pStyle w:val="CodeBlock"\/>/.test(d));
    assert.ok(/<w:br\/>/.test(d));
    assert.ok(/const x = 1;/.test(d));
    assert.ok(/xml:space="preserve"/.test(d));
  });

  await ta('[TOC] 生成 Word 目录域（可更新）', async () => {
    const d = files(DOCX_RES.bytes)['word/document.xml'];
    assert.ok(/TOC \\o "1-3"/.test(d), '缺 TOC 域指令');
    assert.ok(/w:fldCharType="begin"/.test(d) && /w:fldCharType="end"/.test(d));
  });

  await ta('脚注按「首次引用顺序」编号，与定义顺序无关', async () => {
    const f = files(DOCX_RES.bytes);
    const d = f['word/document.xml'];
    // 正文先引 b 再引 a → b 应为 1，a 为 2
    assert.deepStrictEqual(d.match(/<w:footnoteReference w:id="\d+"\/>/g).map(s => s.match(/\d+/)[0]), ['1', '2']);
    const fn = f['word/footnotes.xml'];
    assert.ok(/<w:footnote w:id="1">[\s\S]*乙注释/.test(fn), '脚注 1 内容不对应 b');
    assert.ok(/<w:footnote w:id="2">[\s\S]*甲注释/.test(fn), '脚注 2 内容不对应 a');
    assert.ok(/<w:footnote w:type="separator" w:id="-1">/.test(fn));
  });

  await ta('图片按真实像素内嵌（120×80 → EMU）', async () => {
    const d = files(DOCX_RES.bytes)['word/document.xml'];
    const m = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(d);
    assert.ok(m, '缺 wp:extent');
    assert.strictEqual(Number(m[1]), 120 * 9525);
    assert.strictEqual(Number(m[2]), 80 * 9525);
    assert.ok(/r:embed="rId\d+"/.test(d));
    assert.ok(entry(DOCX_RES.bytes, 'word/media/image1.png'), '缺 media 部件');
  });

  await ta('XML 特殊字符全部转义', async () => {
    const r = await Docx.build('a & b < c > d "引号" \'单\'', { title: 'x' });
    const d = files(r.bytes)['word/document.xml'];
    assert.ok(/&lt; c &gt;/.test(d), '< > 没转义');
    assert.ok(/&amp; b/.test(d), '& 没转义');
    assert.ok(/&quot;引号&quot;/.test(d), '引号没转义');
    assert.ok(!/[^&]&(?![a-z]+;|#\d+;)/.test(d), '有裸 & 未转义');
  });

  await ta('读不到的图片退化为占位文本 + 警告', async () => {
    const r = await Docx.build('前 ![图](nope.png) 后', { title: 'x', resolveImage: () => Promise.resolve(null) });
    const d = files(r.bytes)['word/document.xml'];
    assert.ok(/\[图片：图\]/.test(d));
    assert.strictEqual(r.missingImages.length, 1);
    assert.ok(r.warnings.length === 1);
  });

  await ta('frontmatter 的 title/author 进 docProps', async () => {
    const r = await Docx.build('---\ntitle: 元数据标题\nauthor: 某人\n---\n\n正文\n', {});
    const core = files(r.bytes)['docProps/core.xml'];
    assert.ok(/<dc:title>元数据标题<\/dc:title>/.test(core));
    assert.ok(/<dc:creator>某人<\/dc:creator>/.test(core));
    assert.strictEqual(r.title, '元数据标题');
  });

  /* ---------------------------------------------------------- */
  console.log('\n[3] epub 结构');

  let EPUB_RES = null;
  await ta('mimetype 第一个、store、内容精确', async () => {
    EPUB_RES = await Export.epub(DOC, docxOpts);
    fs.writeFileSync(path.join(TMP, 'a.epub'), Buffer.from(EPUB_RES.bytes));
    const all = Zip.read(EPUB_RES.bytes);
    assert.strictEqual(all[0].name, 'mimetype');
    assert.strictEqual(all[0].method, 0);
    assert.strictEqual(all[0].text, 'application/epub+zip');
  });

  await ta('container.xml 指向 OEBPS/content.opf', async () => {
    const c = files(EPUB_RES.bytes)['META-INF/container.xml'];
    assert.ok(/full-path="OEBPS\/content.opf"/.test(c));
    assert.ok(/application\/oebps-package\+xml/.test(c));
  });

  await ta('opf 元数据与 spine 完整', async () => {
    const opf = files(EPUB_RES.bytes)['OEBPS/content.opf'];
    assert.ok(/version="3.0"/.test(opf));
    assert.ok(/unique-identifier="bookid"/.test(opf));
    assert.ok(/<dc:identifier id="bookid">urn:uuid:[0-9a-f-]{36}<\/dc:identifier>/.test(opf));
    assert.ok(/<dc:title>导出测试<\/dc:title>/.test(opf));
    assert.ok(/<dc:language>zh-CN<\/dc:language>/.test(opf));
    assert.ok(/<dc:creator>FW<\/dc:creator>/.test(opf));
    assert.ok(/dcterms:modified/.test(opf));
    assert.ok(/<item id="nav"[^>]*properties="nav"/.test(opf));
    assert.ok(/<spine><itemref idref="chapter"\/><\/spine>/.test(opf));
  });

  await ta('章节用真 h1/h2/h3（不是 div 伪装）', async () => {
    const ch = files(EPUB_RES.bytes)['OEBPS/chapter.xhtml'];
    assert.ok(/<h1 id="sec1">/.test(ch));
    assert.ok(/<h2 id="sec2">/.test(ch));
    assert.ok(/<h3 id="sec3">/.test(ch));
    assert.ok(!/class="blk h1"/.test(ch), '还残留 WYSIWYG 的 div 标题');
    assert.ok(!/data-s="/.test(ch), '还残留 data-s');
  });

  await ta('[TOC] 展开成嵌套 ol，层级正确', async () => {
    const ch = files(EPUB_RES.bytes)['OEBPS/chapter.xhtml'];
    const toc = /<nav class="toc">([\s\S]*?)<\/nav>/.exec(ch);
    assert.ok(toc, '缺目录');
    assert.ok(/href="#sec1">第一章/.test(toc[1]));
    assert.ok(/<li><a href="#sec1">第一章<\/a><ol><li><a href="#sec2">/.test(toc[1]), '嵌套层级不对');
  });

  await ta('脚注：编号 + 文末 section + 回链', async () => {
    const ch = files(EPUB_RES.bytes)['OEBPS/chapter.xhtml'];
    assert.ok(/<a class="fn-ref" id="fnref1" href="#fn1">1<\/a>/.test(ch));
    assert.ok(/<section class="footnotes">/.test(ch));
    assert.ok(/<li id="fn1">[\s\S]*乙注释/.test(ch), '脚注 1 应为最先被引用的 b');
    assert.ok(/href="#fnref1">↩<\/a>/.test(ch));
  });

  await ta('图片重写进 images/ 并登记 manifest', async () => {
    const f = files(EPUB_RES.bytes);
    assert.ok(/<img src="images\/img1.png"/.test(f['OEBPS/chapter.xhtml']));
    assert.ok(/href="images\/img1.png" media-type="image\/png"/.test(f['OEBPS/content.opf']));
    assert.ok(entry(EPUB_RES.bytes, 'OEBPS/images/img1.png'));
  });

  await ta('nav.xhtml 的链接带 chapter.xhtml 前缀', async () => {
    const nav = files(EPUB_RES.bytes)['OEBPS/nav.xhtml'];
    assert.ok(/href="chapter.xhtml#sec1"/.test(nav));
    assert.ok(/epub:type="toc"/.test(nav));
    assert.ok(!/href="#sec1"/.test(nav), '链接漏了文件前缀，会指向 nav 自己');
  });

  await ta('标签成对闭合（粗查 XML 良构）', async () => {
    const scan = (s, name) => {
      const stack = [];
      const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
      let m;
      while ((m = re.exec(s)) !== null) {
        const [, close, tag, attrs, selfClose] = m;
        if (selfClose || /^(br|img|hr|meta|link|input)$/i.test(tag)) continue;
        if (close) {
          const top = stack.pop();
          assert.strictEqual(top, tag, name + ' 标签不匹配：期望 </' + top + '> 实际 </' + tag + '>');
        } else stack.push(tag);
      }
      assert.strictEqual(stack.length, 0, name + ' 有未闭合标签：' + stack.join(','));
    };
    const f = files(EPUB_RES.bytes);
    scan(f['OEBPS/chapter.xhtml'], 'chapter');
    scan(f['OEBPS/nav.xhtml'], 'nav');
  });

  /* ---------------------------------------------------------- */
  console.log('\n[4] LaTeX');

  const tex = Export.latex(DOC, { title: '导出测试', filename: 'a' });

  t('文档类与编译说明', () => {
    assert.ok(/\\documentclass\[11pt,a4paper\]\{ctexart\}/.test(tex));
    assert.ok(/xelatex a\.tex/.test(tex));
    assert.ok(/\\usepackage\{hyperref\}/.test(tex));
  });

  t('标题映射到 section 层级', () => {
    assert.ok(/\\section\{第一章\}/.test(tex));
    assert.ok(/\\subsection\{1\.1 列表\}/.test(tex));
    assert.ok(/\\subsubsection\{1\.1\.1 表\}/.test(tex));
  });

  t('行内样式宏', () => {
    assert.ok(/\\textbf\{粗\}/.test(tex));
    assert.ok(/\\emph\{斜\}/.test(tex));
    assert.ok(/\\sout\{删\}/.test(tex));
    assert.ok(/\\colorbox\{yellow!35\}\{亮\}/.test(tex));
    assert.ok(/\\texttt\{code\}/.test(tex));
    assert.ok(/\\href\{https:\/\/ex\.com\/a\?b=1\\&c=2\}/.test(tex), '链接没转义');
  });

  t('列表 / 表格 / 代码 / 引用 / 分隔线', () => {
    assert.ok(/\\begin\{itemize\}/.test(tex) && /\\end\{itemize\}/.test(tex));
    assert.ok(/\\begin\{enumerate\}/.test(tex));
    assert.ok(/\\begin\{tabular\}\{lcr\}/.test(tex), '列对齐没继承分隔行');
    assert.ok(/\\begin\{verbatim\}[\s\S]*const x = 1;[\s\S]*\\end\{verbatim\}/.test(tex));
    assert.ok(/\\begin\{quote\}/.test(tex));
    assert.ok(/\\rule\{\\linewidth\}\{0\.4pt\}/.test(tex));
  });

  t('脚注内联成 \\footnote', () => {
    assert.ok(/\\footnote\{乙注释 \\textbf\{粗\}\}/.test(tex));
  });

  t('[TOC] → \\tableofcontents，公式保留原文', () => {
    assert.ok(/\\tableofcontents/.test(tex));
    assert.ok(/\\\[/.test(tex) && /E = mc\^2/.test(tex));
  });

  t('特殊字符转义', () => {
    const out = Export.texEsc('50% & $5 #1 a_b {x} ~ ^ \\');
    assert.strictEqual(out, '50\\% \\& \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}');
  });

  t('图片走 includegraphics', () => {
    assert.ok(/\\includegraphics\[width=0\.9\\linewidth,keepaspectratio\]\{pic\.png\}/.test(tex));
  });

  /* ---------------------------------------------------------- */
  console.log('\n[5] 真实文件校验（python zipfile + ElementTree + unzip）');

  await ta('docx：unzip -t 通过，全部 XML 良构', async () => {
    const out = execFileSync('python3', ['-c', `
import sys, zipfile, xml.etree.ElementTree as ET
p = sys.argv[1]
z = zipfile.ZipFile(p)
bad = z.testzip()
assert bad is None, 'zip 损坏于 ' + str(bad)
n = 0
for name in z.namelist():
    if name.endswith(('.xml', '.rels')):
        ET.fromstring(z.read(name)); n += 1
print(n)
`, path.join(TMP, 'a.docx')]).toString().trim();
    assert.ok(Number(out) >= 7, '良构部件只有 ' + out + ' 个');
  });

  await ta('epub：mimetype 未压缩且在最前，XHTML 良构', async () => {
    const out = execFileSync('python3', ['-c', `
import sys, zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile(sys.argv[1])
info = z.infolist()[0]
assert info.filename == 'mimetype', info.filename
assert info.compress_type == 0, 'mimetype 被压缩了'
assert z.read('mimetype') == b'application/epub+zip'
for n in z.namelist():
    if n.endswith(('.xml', '.xhtml', '.opf')):
        ET.fromstring(z.read(n))
print(len(z.namelist()))
`, path.join(TMP, 'a.epub')]).toString().trim();
    assert.ok(Number(out) >= 7, '部件数不足：' + out);
  });

  await ta('docx 能被 macOS 自己的 importer 读出文字', async () => {
    const txt = execFileSync('textutil', ['-convert', 'txt', '-stdout', path.join(TMP, 'a.docx')], {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    assert.ok(txt.includes('第一章'), '没读到标题');
    assert.ok(txt.includes('粗') && txt.includes('斜'), '没读到行内文本');
    // 脚注是真正的 w:footnote（Word 里在页脚），textutil 的 txt 导出本身不搬脚注，
    // 所以这里只验正文；脚注内容由上面的 footnotes.xml 断言覆盖。
    assert.ok(txt.includes('第一章'));
  });

  await ta('大数据量不炸（500 段 + 50 行表格）', async () => {
    let big = '# 大文档\n\n';
    for (let i = 0; i < 500; i++) big += '第 ' + i + ' 段，**加粗**与 `code`。\n\n';
    big += '| a | b |\n|--|--|\n';
    for (let i = 0; i < 50; i++) big += '| ' + i + ' | v' + i + ' |\n';
    const t0 = Date.now();
    const r = await Docx.build(big, { title: 'big' });
    const ms = Date.now() - t0;
    assert.ok(r.bytes.length > 50000);
    assert.ok(ms < 3000, '太慢：' + ms + 'ms');
    console.log('      （' + (r.bytes.length / 1024).toFixed(0) + ' KB / ' + ms + 'ms）');
  });

  /* ---------- 图片尺寸（Markdown 里 =300x200） ---------- */
  const withPng = { resolveImage: () => Promise.resolve({ bytes: new Uint8Array(PNG), mime: 'image/png' }) };
  const docXml = (r) => Zip.read(r.bytes).find((f) => f.name === 'word/document.xml').text;

  await ta('docx：=300x200 按指定像素换算 EMU', async () => {
    const r = await Docx.build('![图](a.png =300x200)\n', Object.assign({ title: 't' }, withPng));
    const d = docXml(r);
    assert.ok(d.includes('cx="2857500" cy="1905000"'), '实际：' + (/<wp:extent[^>]*>/.exec(d) || [''])[0]);
  });

  await ta('docx：只写宽度时按原图比例算高', async () => {
    const r = await Docx.build('![图](a.png =150)\n', Object.assign({ title: 't' }, withPng));
    const d = docXml(r);
    // 原图 120×80 → 宽 150 时高 100
    assert.ok(d.includes('cx="1428750" cy="952500"'), '实际：' + (/<wp:extent[^>]*>/.exec(d) || [''])[0]);
  });

  await ta('docx：不写尺寸时用原图像素', async () => {
    const r = await Docx.build('![图](a.png)\n', Object.assign({ title: 't' }, withPng));
    assert.ok(docXml(r).includes('cx="1143000" cy="762000"'));
  });

  await ta('ePub：尺寸落成 width/height 属性，且不留 data-*', async () => {
    const r = await Export.epub('![图](a.png =300x200)\n', Object.assign({ title: 't' }, withPng));
    const h = Zip.read(r.bytes).find((f) => f.name === 'OEBPS/chapter.xhtml').text;
    assert.ok(/width="300"/.test(h), '缺 width 属性：' + (/<img[^>]*>/.exec(h) || [''])[0]);
    assert.ok(/height="200"/.test(h), '缺 height 属性');
    assert.ok(h.indexOf('data-w=') === -1, 'ePub 里不该留 data-w');
  });

  await ta('LaTeX：尺寸换算成 pt（96dpi → 0.75）', async () => {
    const tex = Export.latex('![图](a.png =300x200)\n\n![b](b.png)\n', { title: 't' });
    assert.ok(tex.includes('width=225.0pt,height=150.0pt'), '实际：' + (/\\includegraphics\[[^\]]*\]/.exec(tex) || [''])[0]);
    assert.ok(tex.includes('width=0.9\\linewidth'), '没写尺寸时应回到行宽百分比');
  });

  await ta('docx：HTML 块只留文字，<br> 拆成两段', async () => {
    const r = await Docx.build('<div>第一行<br>第二行</div>\n', { title: 't' });
    const d = docXml(r);
    assert.ok(d.includes('第一行') && d.includes('第二行'), '文字丢了');
    assert.ok(d.indexOf('&lt;div') === -1, '不该把标签当正文写进去');
    const paras = (d.match(/<w:p[ >]/g) || []).length;
    assert.ok(paras >= 2, '应拆成两段，实际段落数 ' + paras);
  });

  await ta('ePub：HTML 块只留文字（XHTML 必须良构）', async () => {
    const r = await Export.epub('<div class="x">正文<em>强调</em></div>\n', { title: 't' });
    const h = Zip.read(r.bytes).find((f) => f.name === 'OEBPS/chapter.xhtml').text;
    assert.ok(h.includes('正文'), '正文丢了');
    assert.ok(h.indexOf('class="x"') === -1, '原样标签不该进 ePub');
    assert.ok(h.indexOf('<em>强调</em>') === -1, '行内标签也应收成文字');
  });

  await ta('LaTeX：HTML 块文字进 quote 并转义', async () => {
    const tex = Export.latex('<div>a &amp; b</div>\n', { title: 't' });
    assert.ok(tex.includes('\\begin{quote}'), '没进 quote');
    assert.ok(tex.includes('a \\& b'), '实体会被当普通字符：' + (/\\begin\{quote\}[\s\S]*?\\end\{quote\}/.exec(tex) || [''])[0]);
  });

  await ta('docx：wiki 链接只留显示文字', async () => {
    const r = await Docx.build('见 [[笔记|别名]] 和 [[另一篇]]\n', { title: 't' });
    const d = docXml(r);
    assert.ok(d.includes('别名') && d.includes('另一篇'), '文字丢了');
    assert.ok(d.indexOf('wiki-link') === -1, '不该把 HTML 类名写进去');
    assert.ok(d.indexOf('笔记.md') === -1, '不该出现目标文件名');
  });

  await ta('ePub：wiki 链接降级成 span.wiki', async () => {
    const r = await Export.epub('见 [[笔记|别名]]\n', { title: 't' });
    const h = Zip.read(r.bytes).find((f) => f.name === 'OEBPS/chapter.xhtml').text;
    assert.ok(h.includes('别名'), '文字丢了');
    assert.ok(h.indexOf('class="wiki"') > 0, '缺 span.wiki');
    assert.ok(h.indexOf('wiki-link') === -1, '还留着指向不存在文件的 a');
    assert.ok(h.indexOf('笔记.md') === -1, 'href 指向了包外文件');
  });

  await ta('LaTeX：wiki 链接不产生 \\href', async () => {
    const tex = Export.latex('见 [[笔记|别名]]\n', { title: 't' });
    assert.ok(tex.includes('别名'), '文字丢了');
    assert.ok(tex.indexOf('\\href') === -1, 'wiki 链接不该变成超链接：' + tex.split('\n').slice(0, 8).join(' | '));
    assert.ok(tex.indexOf('笔记.md') === -1);
  });

  /* ------------------------------------------------ flowchart 导出内嵌 */
  const FLOW_MD = [
    '# 流程图',
    '',
    '```flow',
    'st=>start: 开始',
    'op=>operation: 处理',
    'e=>end: 结束',
    'st->op->e',
    '```',
    '',
    '```flow',
    '坏行没有箭头',
    '```',
    ''
  ].join('\n');

  t('inlineFlow：flow 块换成内嵌 SVG', () => {
    const src = '<pre><code class="language-flow">st=&gt;start: 开始\ne=&gt;end: 结束\nst-&gt;e</code></pre>';
    const out = Export.inlineFlow(src);
    assert.ok(out.startsWith('<div class="flow-fig"><svg'), out.slice(0, 60));
    assert.ok(out.endsWith('</svg></div>'), out.slice(-40));
    assert.ok(out.indexOf('<pre>') === -1, '源码块没被替换');
  });

  t('inlineFlow：语法错误保留源码块', () => {
    const src = '<pre><code class="language-flow">坏行没有箭头</code></pre>';
    assert.strictEqual(Export.inlineFlow(src), src);
  });

  t('inlineFlow：flowchart 别名与其它语言', () => {
    const alias = Export.inlineFlow('<pre><code class="language-flowchart">a=&gt;start: A\nb=&gt;end: B\na-&gt;b</code></pre>');
    assert.ok(alias.indexOf('<svg') > 0, '别名没内嵌');
    const js = '<pre><code class="language-js">const a = 1;</code></pre>';
    assert.strictEqual(Export.inlineFlow(js), js, '其它语言被误改');
  });

  t('inlineFlow：&amp; 在最后一步解，不会解出乱码', () => {
    const src = '<pre><code class="language-flow">a=&gt;operation: A &amp;amp; B</code></pre>';
    const out = Export.inlineFlow(src);
    // 源码里的 &amp;amp; 解一次是 &amp;，进 SVG 再转义回 &amp;amp;
    assert.ok(out.indexOf('A &amp;amp; B') > 0, out.slice(0, 200));
    assert.ok(out.indexOf('A & B') === -1, '标签被解成了裸 &');
  });

  await ta('ePub：flowchart 块内嵌 SVG 且 XHTML 良构', async () => {
    const r = await Export.epub(FLOW_MD, { title: 't' });
    const h = Zip.read(r.bytes).find((f) => f.name === 'OEBPS/chapter.xhtml').text;
    assert.ok(h.indexOf('<div class="flow-fig"><svg') > 0, '没内嵌 SVG');
    assert.ok(h.indexOf('flow-arrow') > 0, 'SVG 里没有箭头定义');
    assert.ok(h.indexOf('开始') > 0, '节点文字丢了');
    // 坏块退化成源码 <pre>，章节里两种形态共存
    assert.ok(h.indexOf('<pre><code class="language-flow">') > 0, '坏块没保留源码');
    assert.ok(h.indexOf('class="language-js"') === -1);
  });

  await ta('ePub：flowchart 的 XHTML 能过 ElementTree', async () => {
    const r = await Export.epub(FLOW_MD, { title: 't' });
    fs.writeFileSync(path.join(TMP, 'flow.epub'), Buffer.from(r.bytes));
    const out = execFileSync('python3', ['-c', `
import sys, zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist():
    if n.endswith(('.xml', '.xhtml', '.opf')):
        ET.fromstring(z.read(n))
svg = z.read('OEBPS/chapter.xhtml').decode('utf-8')
assert '<svg' in svg, 'chapter 里没有 SVG'
print('ok')
`, path.join(TMP, 'flow.epub')]).toString().trim();
    assert.strictEqual(out, 'ok');
  });

  await ta('RevealJS：flowchart 块内嵌 SVG', async () => {
    const r = await Export.reveal(FLOW_MD, { title: 't' });
    assert.ok(r.text.indexOf('<div class="flow-fig"><svg') > 0, '没内嵌 SVG');
    assert.ok(r.text.indexOf('flow-arrow') > 0, 'SVG 里没有箭头定义');
    assert.ok(r.text.indexOf('<pre><code class="language-flow">') > 0, '坏块没保留源码');
    assert.ok(r.text.indexOf('.flow-fig svg') > 0, 'CSS 里没有 flow-fig 规则');
  });

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  console.log('产物：' + TMP + '\n');
  process.exit(fail ? 1 : 0);
})();
