/* Node 单测：YAML front matter 覆盖导出设置
 * 覆盖 tex / epub / docx / reveal / htmlDoc 五个出口，
 * 外加「没有 front matter 时输出与以前逐字节一致」的回归锚点。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const Zip = require('../app/js/zip.js');
const Docx = require('../app/js/docx.js');
const Export = require('../app/js/export.js');
const Yaml = require('../app/js/yaml.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).toString().split('\n')[0]); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function has(s, sub, msg) {
  ok(String(s).indexOf(sub) >= 0, (msg || '应包含') + '「' + sub + '」\n实际片段：' + String(s).slice(0, 300));
}
function hasNot(s, sub, msg) {
  ok(String(s).indexOf(sub) < 0, (msg || '不应包含') + '「' + sub + '」');
}

const TMP = path.join(os.tmpdir(), 'typora-yaml-export-test');
fs.mkdirSync(TMP, { recursive: true });

function files(bytes) {
  const out = {};
  Zip.read(bytes).forEach(e => { if (e.text != null) out[e.name] = e.text; });
  return out;
}
// 用 python 验 XML 良构（与 export.test.js 同一套路）
function xmlOk(name, text) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, text);
  execFileSync('python3', ['-c',
    'import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])', p]);
}

const FULL_YAML = [
  '---',
  'title: 主标题',
  'subtitle: 副标题',
  'author: FW',
  'date: 2026-10-18',
  'keywords: 金融, AI, 工程',
  'toc: true',
  'toc-title: 本文目录',
  'papersize: A4',
  'geometry: margin=2cm,top=1.5cm',
  'fontsize: 12pt',
  'linestretch: 1.5',
  'documentclass: ctexrep',
  '---',
  '',
  '# 第一章',
  '',
  '正文段落。',
  '',
  '## 1.1 小节',
  ''
].join('\n');

const PLAIN = [
  '# 第一章',
  '',
  '正文段落。',
  '',
  '## 1.1 小节',
  ''
].join('\n');

// 没有 h1 的文档：LaTeX 才会生成 \title / \maketitle（与旧逻辑一致）
const NO_H1 = [
  '---',
  'title: 主标题',
  'subtitle: 副标题',
  'author: FW',
  'date: 2026-10-18',
  '---',
  '',
  '正文段落，没有一级标题。',
  ''
].join('\n');

const BODY_KEYS = ['title', 'subtitle', 'author', 'date', 'keywords', 'toc', 'toc-title'];

(async function () {
  /* ================= LaTeX ================= */
  console.log('LaTeX：YAML 覆盖');
  await t('preamble 吃 documentclass/fontsize/papersize', async () => {
    const tex = Export.latex(FULL_YAML, {});
    has(tex, '\\documentclass[12pt,a4paper]{ctexrep}', 'documentclass 行');
  });
  await t('geometry 覆盖默认边距', async () => {
    const tex = Export.latex(FULL_YAML, {});
    has(tex, '\\usepackage[margin=2cm,top=1.5cm]{geometry}');
    hasNot(tex, 'margin=2.5cm');
  });
  await t('title/subtitle/author/date 都进 preamble', async () => {
    const tex = Export.latex(NO_H1, {});
    has(tex, '\\title{主标题 \\\\ {\\Large 副标题}}');
    has(tex, '\\author{FW}');
    has(tex, '\\date{2026-10-18}');
    has(tex, '\\maketitle');
  });
  await t('keywords 进 hypersetup', async () => {
    const tex = Export.latex(FULL_YAML, {});
    has(tex, 'pdfkeywords={金融, AI, 工程}');
  });
  await t('linestretch 生成 linespread', async () => {
    const tex = Export.latex(FULL_YAML, {});
    has(tex, '\\linespread{1.5}');
  });
  await t('toc-title 改 contentsname', async () => {
    const tex = Export.latex(FULL_YAML, {});
    has(tex, '\\renewcommand{\\contentsname}{本文目录}');
  });
  await t('toc: true 且无 [TOC] 块时补目录', async () => {
    const tex = Export.latex(FULL_YAML, {});
    ok((tex.match(/\\tableofcontents/g) || []).length === 1, '应恰好一份 tableofcontents');
    ok(tex.indexOf('\\maketitle') < tex.indexOf('\\tableofcontents'), '目录应在标题页之后');
  });
  await t('有 [TOC] 块时不重复生成', async () => {
    const src = FULL_YAML.replace('正文段落。', '[TOC]\n\n正文段落。');
    const tex = Export.latex(src, {});
    ok((tex.match(/\\tableofcontents/g) || []).length === 1, '应恰好一份 tableofcontents');
  });
  await t('LaTeX 特殊字符仍被转义', async () => {
    const src = '---\ntitle: 100% & _下划线_\n---\n\n正文';
    const tex = Export.latex(src, {});
    has(tex, '\\title{100\\% \\& \\_下划线\\_}');
  });
  await t('注入型 geometry 被丢弃、回落默认', async () => {
    const src = '---\ngeometry: "margin=1cm}\\input{/etc/passwd}"\n---\n\n正文';
    const tex = Export.latex(src, {});
    has(tex, '\\usepackage[margin=2.5cm]{geometry}');
    hasNot(tex, 'input{');
  });
  await t('注入型 documentclass 被丢弃', async () => {
    const src = '---\ndocumentclass: "article}\\evil"\n---\n\n正文';
    const tex = Export.latex(src, {});
    has(tex, ']{ctexart}');
    hasNot(tex, 'evil');
  });
  await t('没有 front matter 时输出与旧版一致', async () => {
    const tex = Export.latex(PLAIN, {});
    has(tex, '\\documentclass[11pt,a4paper]{ctexart}');
    has(tex, '\\usepackage[margin=2.5cm]{geometry}');
    has(tex, '\\date{}');
    hasNot(tex, '\\title{');
    hasNot(tex, '\\linespread');
  });
  await t('YAML title 优先于 opts.title（文件名）', async () => {
    const tex = Export.latex(NO_H1, { title: '文件名' });
    has(tex, '\\title{主标题');
    hasNot(tex, '文件名');
  });
  await t('没有 YAML title 时仍用 opts.title', async () => {
    const tex = Export.latex('正文，没有标题也没有 front matter。', { title: '文件名' });
    has(tex, '\\title{文件名}');
  });

  /* ================= ePub ================= */
  console.log('ePub：YAML 覆盖');
  await t('dc:subject / title-type / dc:date', async () => {
    const r = await Export.epub(FULL_YAML, {});
    const f = files(r.bytes);
    const opf = f['OEBPS/content.opf'];
    has(opf, '<dc:subject>金融</dc:subject>');
    has(opf, '<dc:subject>AI</dc:subject>');
    has(opf, '<dc:subject>工程</dc:subject>');
    has(opf, '<dc:title id="t-main">主标题</dc:title>');
    has(opf, '<meta refines="#t-main" property="title-type">main</meta>');
    has(opf, '<dc:title id="t-sub">副标题</dc:title>');
    has(opf, '<meta refines="#t-sub" property="title-type">subtitle</meta>');
    has(opf, '<dc:date>2026-10-18</dc:date>');
    has(opf, '<dc:creator>FW</dc:creator>');
    xmlOk('yaml-epub.opf', opf);
    xmlOk('yaml-epub-nav.xhtml', f['OEBPS/nav.xhtml']);
    xmlOk('yaml-epub-chapter.xhtml', f['OEBPS/chapter.xhtml']);
  });
  await t('nav 标题吃 toc-title', async () => {
    const r = await Export.epub(FULL_YAML, {});
    const f = files(r.bytes);
    has(f['OEBPS/nav.xhtml'], '<title>本文目录</title>');
    has(f['OEBPS/nav.xhtml'], '<h1>本文目录</h1>');
  });
  await t('chapter 标题吃 YAML title', async () => {
    const r = await Export.epub(FULL_YAML, {});
    const f = files(r.bytes);
    has(f['OEBPS/chapter.xhtml'], '<title>主标题</title>');
  });
  await t('没有副标题时 dc:title 保持单行', async () => {
    const src = '---\ntitle: 只有主标题\n---\n\n正文';
    const r = await Export.epub(src, {});
    const opf = files(r.bytes)['OEBPS/content.opf'];
    has(opf, '<dc:title>只有主标题</dc:title>');
    hasNot(opf, 'title-type');
    xmlOk('yaml-epub-nosub.opf', opf);
  });
  await t('date 不是 ISO 形态时回落导出时刻', async () => {
    const src = '---\ntitle: t\ndate: 二零二六年十月十八日\n---\n\n正文';
    const r = await Export.epub(src, {});
    const opf = files(r.bytes)['OEBPS/content.opf'];
    ok(/<dc:date>\d{4}-\d{2}-\d{2}T/.test(opf), 'dc:date 应是导出时刻，实际：' +
      (/<dc:date>[^<]*/.exec(opf) || [''])[0]);
  });

  /* ================= docx ================= */
  console.log('docx：YAML 覆盖');
  await t('core.xml 吃 subtitle/keywords/date', async () => {
    const r = await Docx.build(FULL_YAML, {});
    const f = files(r.bytes);
    const core = f['docProps/core.xml'];
    has(core, '<dc:title>主标题</dc:title>');
    has(core, '<dc:subject>副标题</dc:subject>');
    has(core, '<cp:keywords>金融, AI, 工程</cp:keywords>');
    has(core, '<dc:creator>FW</dc:creator>');
    has(core, '<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-18T00:00:00Z</dcterms:created>');
    xmlOk('yaml-docx-core.xml', core);
    xmlOk('yaml-docx-document.xml', f['word/document.xml']);
  });
  await t('toc: true 且无 [TOC] 块时开头补目录域', async () => {
    const r = await Docx.build(FULL_YAML, {});
    const doc = files(r.bytes)['word/document.xml'];
    ok((doc.match(/TOC \\o/g) || []).length === 1, '应恰好一个 TOC 域');
    ok(doc.indexOf('TOC \\o') < doc.indexOf('第一章'), '目录域应在正文之前');
  });
  await t('没有 YAML 时 core.xml 与旧版一致', async () => {
    const r = await Docx.build(PLAIN, { title: '文件名' });
    const core = files(r.bytes)['docProps/core.xml'];
    has(core, '<dc:title>文件名</dc:title>');
    hasNot(core, '<dc:subject>');
    hasNot(core, '<cp:keywords>');
  });
  await t('YAML title 优先于 opts.title', async () => {
    const r = await Docx.build(FULL_YAML, { title: '文件名' });
    const core = files(r.bytes)['docProps/core.xml'];
    has(core, '<dc:title>主标题</dc:title>');
    hasNot(core, '<dc:title>文件名</dc:title>');
  });

  /* ================= RevealJS ================= */
  console.log('RevealJS：YAML 覆盖');
  await t('副标题/作者生成标题页', async () => {
    const r = await Export.reveal(FULL_YAML, {});
    has(r.text, '<section class="title-slide">');
    has(r.text, '<h1>主标题</h1>');
    has(r.text, '<p class="rv-sub">副标题</p>');
    has(r.text, '<p class="rv-au">FW · 2026-10-18</p>');
    ok(r.text.indexOf('title-slide') < r.text.indexOf('第一章'), '标题页应在正文前');
    ok(r.slides >= 2, '页数应包含标题页');
  });
  await t('只有标题时不加标题页', async () => {
    const src = '---\ntitle: 只要标题\n---\n\n# 第一章\n';
    const r = await Export.reveal(src, {});
    hasNot(r.text, '<section class="title-slide">');
    hasNot(r.text, '<p class="rv-sub">');
    hasNot(r.text, '<p class="rv-au">');
  });
  await t('没有 front matter 时没有标题页', async () => {
    const r = await Export.reveal(PLAIN, {});
    hasNot(r.text, '<section class="title-slide">');
  });

  /* ================= htmlDoc ================= */
  console.log('HTML：YAML 覆盖');
  await t('meta 标签与 title 优先级', async () => {
    const y = Export.readYaml(FULL_YAML);
    const html = Export.htmlDoc('<p>正文</p>', {
      width: true,
      title: y.title || '文件名',
      author: y.author, keywords: y.keywords,
      description: y.subtitle, date: y.date
    });
    has(html, '<title>主标题</title>');
    has(html, '<meta name="author" content="FW">');
    has(html, '<meta name="keywords" content="金融, AI, 工程">');
    has(html, '<meta name="description" content="副标题">');
    has(html, '<meta name="dcterms.created" content="2026-10-18">');
  });
  await t('元信息缺省时不写 meta', async () => {
    const html = Export.htmlDoc('<p>正文</p>', { title: 'x' });
    hasNot(html, 'name="author"');
    hasNot(html, 'name="keywords"');
  });
  await t('meta 内容被 HTML 转义', async () => {
    const html = Export.htmlDoc('', { title: 'a<b>&"c"', author: '<script>' });
    has(html, '<title>a&lt;b&gt;&amp;&quot;c&quot;</title>');
    has(html, 'content="&lt;script&gt;"');
  });
  await t('自定义 head 片段插在 </head> 之前', async () => {
    const html = Export.htmlDoc('<p>x</p>', {
      title: 'T',
      head: '<link rel="stylesheet" href="a.css">'
    });
    const at = html.indexOf('<link rel="stylesheet" href="a.css">');
    ok(at > 0, '没找到 head 片段');
    ok(html.indexOf('</head>') > at, 'head 片段跑到 head 外面了');
    ok(html.indexOf('<title>T</title>') < at, 'head 片段应在 title 之后');
  });
  await t('自定义 tail 片段插在 </body> 之前', async () => {
    const html = Export.htmlDoc('<p>x</p>', {
      title: 'T',
      tail: '<script src="app.js"></script>'
    });
    const at = html.indexOf('<script src="app.js"></script>');
    ok(at > 0, '没找到 tail 片段');
    ok(html.indexOf('</body>') > at, 'tail 片段跑到 body 外面了');
    ok(html.indexOf('<div class="editor"') < at, 'tail 片段应在正文之后');
  });
  await t('片段原样保留，不被转义', async () => {
    const html = Export.htmlDoc('', {
      title: 'T', head: '<meta name="x" content="a&b">', tail: '<div data-x="1">&nbsp;</div>'
    });
    has(html, '<meta name="x" content="a&b">');
    has(html, '<div data-x="1">&nbsp;</div>');
  });
  await t('空片段不留下多余空行', async () => {
    const html = Export.htmlDoc('<p>x</p>', { title: 'T' });
    hasNot(html, '</title>\n\n</head>');
    has(html, '</title>\n</head>');
  });
  await t('htmlOptions 归一化 head / tail', async () => {
    const o = Export.htmlOptions({ head: '<a>', tail: null });
    ok(o.head === '<a>', 'head 没带上');
    ok(o.tail === '', 'null 应归一成空串');
    ok(Export.htmlOptions({}).head === '' && Export.htmlOptions({}).tail === '', '默认应为空串');
  });
  await t('readYaml 返回归一化覆盖', async () => {
    const y = Export.readYaml(FULL_YAML);
    eq(y.title, '主标题'); eq(y.paper, 'a4'); eq(y.toc, true);
    function eq(a, b) { ok(a === b, a + ' != ' + b); }
  });

  /* ================= pdfOptions 交互 ================= */
  console.log('PDF：papersize 覆盖');
  await t('pdfOptions 仍夹合法值', async () => {
    const o = Export.pdfOptions({ paper: 'A9', margin: 999 });
    ok(o.paper === 'a4', '非法纸张回落 a4');
    ok(o.margin === 120, '边距夹到 120');
  });
  await t('YAML papersize 可被上层应用到 pdfOptions 结果', async () => {
    const y = Export.readYaml(FULL_YAML);
    const o = Export.pdfOptions({ paper: 'letter' });
    if (y.paper && Export.papers[y.paper]) o.paper = y.paper;
    ok(o.paper === 'a4', 'YAML 的 A4 应覆盖 letter');
  });

  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
