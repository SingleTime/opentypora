// infmt.test.js —— ODT / reStructuredText → Markdown
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const In = require(path.join(ROOT, 'app/js/infmt.js'));
const Odt = require(path.join(ROOT, 'app/js/odt.js'));
const Importer = require(path.join(ROOT, 'app/js/importer.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function has(name, md, re) { ok(name, re.test(md), md.replace(/\n/g, '⏎').slice(0, 160)); }

function png(w, h) {
  const b = new Uint8Array(64);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4E; b[3] = 0x47;
  b[16] = (w >> 24) & 255; b[17] = (w >> 16) & 255; b[18] = (w >> 8) & 255; b[19] = w & 255;
  b[20] = (h >> 24) & 255; b[21] = (h >> 16) & 255; b[22] = (h >> 8) & 255; b[23] = h & 255;
  return b;
}

const DOC = [
  '# 一级标题', '',
  '正文 **粗体**、*斜体* 与 `code`。', '',
  '## 二级标题', '',
  '- 项目一', '- 项目二', '  - 子项', '',
  '1. 第一步', '2. 第二步', '',
  '| 列A | 列B |', '| --- | --- |', '| 1 | 2 |', '',
  '脚注[^a]', '',
  '[^a]: 注释内容', ''
].join('\n');

console.log('ODT → Markdown');
Odt.odt(DOC, {
  title: '往返',
  resolveImage: () => ({ bytes: png(200, 100), mime: 'image/png' })
}).then((r) => {
  const back = In.fromOdt(r.bytes, { assetDir: 'media/' });
  const md = back.markdown;

  has('标题还原', md, /^# 一级标题$/m);
  has('二级标题还原', md, /^## 二级标题$/m);
  has('粗体还原', md, /\*\*粗体\*\*/);
  has('斜体还原', md, /\*斜体\*/);
  has('行内代码还原', md, /`code`/);
  has('无序列表还原', md, /^- 项目一$/m);
  has('嵌套列表缩进 2 格', md, /^  - 子项$/m);
  has('有序列表从 1 编号', md, /^1\. 第一步$/m);
  has('有序列表第二项 2', md, /^2\. 第二步$/m);
  has('列表项之间不留空行', md, /^- 项目一\n- 项目二$/m);
  has('表格还原为 GFM', md, /^\| 列A \| 列B \|$/m);
  has('表格分隔行', md, /^\| --- \| --- \|$/m);
  has('脚注引用', md, /\[\^1\]/);
  has('脚注定义', md, /^\[\^1\]: 注释内容$/m);
  ok('没有残留 XML 标签', !/<\/?text:/.test(md), md.slice(0, 80));
  eq('空资产', back.assets.length, 0);

  console.log('ODT 里的图片');
  return Odt.odt('# 图\n\n![示意图](assets/a.png)\n', {
    resolveImage: () => ({ bytes: png(200, 100), mime: 'image/png' })
  });
}).then((im) => {
  const back = In.fromOdt(im.bytes, { assetDir: 'media/' });
  eq('图片资产被取出', back.assets.length, 1);
  eq('资产路径按 assetDir 重写', back.assets[0].path, 'media/img1.png');
  ok('资产带字节', back.assets[0].bytes && back.assets[0].bytes.length > 0);
  has('正文引用同样重写', back.markdown, /!\[\]\(media\/img1\.png\)/);

  console.log('ODT 异常输入');
  let threw = '';
  try { In.fromOdt(new Uint8Array([1, 2, 3]), {}); } catch (e) { threw = e.message; }
  ok('不是 zip 时报错', /EOCD|合法/.test(threw), threw);

  console.log('RST → Markdown');
  const RST = [
    '文档标题',
    '========',
    '',
    '正文 **粗** 与 ``code``、`链接 <https://e.com>`_、:math:`a^2`、:sup:`2`。',
    '',
    '二级',
    '----',
    '',
    '- 一',
    '- 二',
    '  - 子项',
    '',
    '1. 甲',
    '2. 乙',
    '',
    '.. code-block:: js',
    '',
    '   let x = 1;',
    '',
    '.. image:: assets/a.png',
    '   :alt: 示意图',
    '',
    '.. [#n] 注释内容',
    '',
    '引用 [#n]_',
    '',
    '.. 这一行是注释',
    '   注释的续行',
    '',
    '   这是一段引用',
    ''
  ].join('\n');
  const r = In.fromRst(RST);
  const md = r.markdown;

  has('文档标题 → #', md, /^# 文档标题$/m);
  has('二级 → ##', md, /^## 二级$/m);
  has('链接还原', md, /\[链接\]\(https:\/\/e\.com\)/);
  has('行内代码还原', md, /`code`/);
  has('公式还原', md, /\$a\^2\$/);
  has('上标还原', md, /\^2\^/);
  has('无序列表', md, /^- 一\n- 二$/m);
  has('嵌套列表', md, /^  - 子项$/m);
  has('有序列表保留编号', md, /^1\. 甲\n2\. 乙$/m);
  has('代码块带语言', md, /```js\nlet x = 1;\n```/);
  has('图片带 alt', md, /!\[示意图\]\(assets\/a\.png\)/);
  has('脚注定义', md, /^\[\^n\]: 注释内容$/m);
  has('脚注引用', md, /\[\^n\]/);
  ok('注释块被丢弃', !/这一行是注释/.test(md), md);
  has('缩进段落 → 引用块', md, /^> 这是一段引用$/m);
  eq('RST 导入不带资产', r.assets.length, 0);

  console.log('RST 边角');
  const g = In.fromRst([
    '+-----+-----+',
    '| A   | B   |',
    '+=====+=====+',
    '| 1   | 2   |',
    '+-----+-----+',
    ''
  ].join('\n')).markdown;
  has('grid 表格 → GFM', g, /^\| A \| B \|$/m);
  has('grid 表头分隔', g, /^\| --- \| --- \|$/m);
  has('grid 第二行', g, /^\| 1 \| 2 \|$/m);

  const t = In.fromRst('：无标题正文\n').markdown;
  has('没有标题也能出正文', t, /无标题正文/);

  console.log('LaTeX → Markdown');
  const TEX = String.raw`\documentclass[11pt]{ctexart}
\usepackage{graphicx}
\title{测试文档}
\author{张三}
\begin{document}
\maketitle
\tableofcontents

\section{第一章}
这是\textbf{加粗}、\emph{斜体}、\texttt{code}、\underline{下划} 与 \href{https://example.com}{链接}，
百分号 100\% 与美元 \$5，脚注\footnote{注释 $x^2$}。

\subsection{小节}
\begin{itemize}
  \item 第一项
  \item 第二项
  \begin{enumerate}
    \item 嵌套一
    \item 嵌套二
  \end{enumerate}
\end{itemize}

\begin{verbatim}
let x = 1 < 2;
\end{verbatim}

\begin{equation}
E = mc^2
\end{equation}

\begin{tabular}{|l|c|}
\hline
列A & 列B \\
\hline
1 & 2 \\
\hline
\end{tabular}

\begin{figure}
\centering
\includegraphics[width=3cm]{assets/pic.png}
\caption{图注}
\end{figure}

\begin{quote}
引用文字
\end{quote}

\begin{description}
  \item[术语] 解释
\end{description}
\end{document}`;
  const tx = In.fromLatex(TEX, {});
  const mdx = tx.markdown;
  eq('标题从 \\title 取', tx.title, '测试文档');
  has('\\section → #', mdx, /^# 第一章$/m);
  has('\\subsection → ##', mdx, /^## 小节$/m);
  has('\\tableofcontents → [TOC]', mdx, /^\[TOC\]$/m);
  has('\\textbf → **', mdx, /\*\*加粗\*\*/);
  has('\\emph → *', mdx, /\*斜体\*/);
  has('\\texttt → 反引号', mdx, /`code`/);
  has('\\underline → <u>', mdx, /<u>下划<\/u>/);
  has('\\href → 链接', mdx, /\[链接\]\(https:\/\/example\.com\)/);
  has('转义 \\% 还原', mdx, /100% 与美元 \$5/);
  has('脚注引用', mdx, /脚注\[\^1\]/);
  has('脚注定义', mdx, /^\[\^1\]: 注释 \$x\^2\$$/m);
  has('itemize → 无序列表', mdx, /^- 第一项$/m);
  has('嵌套 enumerate 缩进', mdx, /^  1\. 嵌套一$/m);
  has('verbatim → 围栏代码', mdx, /```\nlet x = 1 < 2;\n```/);
  has('equation → \\$\\$', mdx, /\$\$\nE = mc\^2\n\$\$/);
  has('tabular → GFM 表格', mdx, /^\| 列A \| 列B \|$/m);
  has('表格分隔行', mdx, /^\| --- \| --- \|$/m);
  has('表格数据行', mdx, /^\| 1 \| 2 \|$/m);
  has('includegraphics → 图片', mdx, /!\[\]\(assets\/pic\.png =113\)/);
  has('图片宽度换成 =px（3cm ≈ 113px）', mdx, / =113\)/);
  has('caption 保留为斜体', mdx, /\*图注\*/);
  has('quote → 引用块', mdx, /^> 引用文字$/m);
  has('description → 术语加粗', mdx, /^- \*\*术语\*\* 解释$/m);
  ok('不残留 begin/end', !/\\begin\{|\\end\{/.test(mdx), md);
  ok('preamble 不进正文', !/documentclass|usepackage|maketitle/.test(mdx), md);

  const frag = In.fromLatex('\\section*{无编号}\n正文 \\cite{foo,bar}', {}).markdown;
  has('没有 document 环境也能转', frag, /^# 无编号$/m);
  has('\\cite → [@key]', frag, /\[@foo,bar\]/);
  eq('LaTeX 片段不带资产', In.fromLatex('正文', {}).assets.length, 0);

  console.log('Importer.convert 分发');
  const b64 = Buffer.from(Odt_placeholder()).toString('base64');
  return Importer.convert('odt', b64, { assetDir: 'm/' }).then((res) => {
    has('convert odt 走 infmt', res.markdown || '', /ODT 占位/);
    const rst64 = Buffer.from('# 标题\n\n正文\n').toString('base64');
    return Importer.convert('rst', rst64, {}).then((r2) => {
      has('convert rst 走 infmt', r2.markdown, /^# 标题$/m);
      return Importer.convert('rest', rst64, {});
    }).then((r3) => has('rest 扩展名也算 rst', r3.markdown, /正文/));
  });
}).then(() => {
  console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.error('异常：', e && e.stack || e);
  process.exit(1);
});

function Odt_placeholder() {
  // 构造一个最小可用的 odt（只有 content.xml）
  const Zip = require(path.join(ROOT, 'app/js/zip.js'));
  return Zip.build([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', data: '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>ODT 占位</text:p></office:text></office:body></office:document-content>' }
  ]);
}
