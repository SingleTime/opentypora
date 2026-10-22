/* 导入测试共用的样本：Word 风格 docx（deflate 压缩）与一段 HTML */
const zlib = require('zlib');
const Zip = require('../app/js/zip.js');

/* ---------------------------------------------------------- deflate zip */
function buildDeflateZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = Zip.crc32(new Uint8Array(raw));
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);            // method 8 = deflate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(lh, 30);
    chunks.push(lh, comp);
    central.push({ nameBuf, crc, csize: comp.length, usize: raw.length, offset });
    offset += lh.length + comp.length;
  }
  const cdParts = [];
  for (const c of central) {
    const ch = Buffer.alloc(46 + c.nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.csize, 20);
    ch.writeUInt32LE(c.usize, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28);
    ch.writeUInt32LE(c.offset, 42);
    c.nameBuf.copy(ch, 46);
    cdParts.push(ch);
  }
  const cd = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat(chunks.concat([cd, eocd])));
}

/* ---------------------------------------------------------- Word 风格样本 */
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>第一章 标题</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="a3"/></w:pPr><w:r><w:t>正文里有</w:t></w:r>
  <w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r>
  <w:r><w:t>和</w:t></w:r>
  <w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r>
  <w:r><w:t>，还有</w:t></w:r>
  <w:r><w:rPr><w:rStyle w:val="CodeChar"/></w:rPr><w:t>行内代码</w:t></w:r>
  <w:r><w:t>与</w:t></w:r>
  <w:r><w:rPr><w:strike/></w:rPr><w:t>删除线</w:t></w:r>
  <w:r><w:t>，上标</w:t></w:r>
  <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>
  <w:r><w:footnoteReference w:id="1"/></w:r>
</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>无序一</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>无序二</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>无序二·嵌套</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>有序一</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>有序二</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="QuoteStyle"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>引用的一段话</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t>const a = 1;</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>console.log(a);</w:t></w:r></w:p>
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/>
  <a:graphic><a:graphicData><a:blip r:embed="rId9"/></a:graphicData></a:graphic>
</wp:inline></w:drawing></w:r></w:p>
<w:p><w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>示例站点</w:t></w:r></w:hyperlink></w:p>
<w:tbl>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>名称</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>数量</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>苹果</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并两列</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
<w:p><w:r><w:t>结尾段落</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body></w:document>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="QuoteStyle"><w:name w:val="Quote"/></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>
  <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1" TargetMode="External"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const FOOTNOTES = `<?xml version="1.0" encoding="UTF-8"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:id="1"><w:p><w:r><w:t>这是脚注正文</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

function sampleDocx(extra) {
  return buildDeflateZip([
    { name: 'word/document.xml', data: DOC },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: NUMBERING },
    { name: 'word/_rels/document.xml.rels', data: RELS },
    { name: 'word/footnotes.xml', data: FOOTNOTES },
    { name: 'word/media/image1.png', data: Buffer.from('89504e470d0a1a0a', 'hex') }
  ].concat(extra || []));
}


module.exports = { buildDeflateZip: buildDeflateZip, sampleDocx: sampleDocx, DOC: DOC, HTML: null };
