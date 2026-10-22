// 生成「导出菜单 / 三种导出」集成测试页。
// 在真实 WKWebView 里跑（build/shot），验证 UI 接线与 Bridge 载荷。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__export_harness.html');

/* ---------- 一张真实 PNG（供 readBinary 返回，验证图片内嵌） ---------- */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) { raw[p++] = (x * 2) & 255; raw[p++] = (y * 3) & 255; raw[p++] = 200; }
  }
  let table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const PNG_B64 = makePng(120, 80).toString('base64');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__captured = [];
window.__readBin = [];
window.__html = [];
window.__pdf = [];
window.__img = [];
function b64ToBytes(b) {
  var bin = atob(b), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
window.__b64ToBytes = b64ToBytes;
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  saveImage: function () { return Promise.resolve({ path: '/tmp/x.png' }); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  exportHTML: function (name, html, styles, themeCss) {
    window.__html.push({ name: name, html: html, styles: styles, themeCss: themeCss });
    return Promise.resolve({ path: '/tmp/' + name });
  },
  exportPDF: function (opts) {
    window.__pdf.push(opts || null);
    return Promise.resolve({ path: '/tmp/x.pdf' });
  },
  exportImage: function (fmt) {
    window.__img.push(fmt);
    return Promise.resolve({ path: '/tmp/x.' + fmt });
  },
  print: function () { return Promise.resolve(null); },
  exportFile: function (name, ext, base64) {
    window.__captured.push({ name: name, ext: ext, base64: base64 });
    return Promise.resolve({ path: '/tmp/' + name });
  },
  readBinary: function (p) {
    window.__readBin.push(p);
    if (/\\.png$/i.test(p)) return Promise.resolve({ base64: ${JSON.stringify(PNG_B64)}, path: p });
    return Promise.resolve(null);
  },
  listThemes: function () {
    return Promise.resolve({ dir: '/tmp/themes', themes: [{ id: 'mine.css', name: '我的主题' }] });
  },
  readTheme: function (name) {
    window.__themeReads = (window.__themeReads || []).concat([name]);
    return Promise.resolve({ css: ':root{--bg:#123456;--text:#ffffff}.blk.h1{color:var(--accent)}' });
  },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); }
};
</script>
`;

const DOC = [
  '# 导出集成测试',
  '',
  '正文 **粗体**，脚注[^n]，图片 ![图](pic.png)。',
  '',
  '| a | b |',
  '|--|--|',
  '| 1 | 2 |',
  '',
  '[^n]: 注释内容',
  ''
].join('\n');

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'EXPORT ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:660px;max-height:76vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function bytesOf(cap) { return window.__b64ToBytes(cap.base64); }
  function latin(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  function utf8(bytes) {
    try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return latin(bytes); }
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 120000);
    await sleep(500);

    Editor.load(${JSON.stringify(DOC)}, null, '集成测试.md');
    await sleep(250);

    R.push('STEP 1 菜单');
    ok('初始化时没有弹层', !q('.xpop'));
    var btn = $('tb-export');
    ok('状态栏有「导出」按钮', !!btn, btn ? btn.textContent.trim() : 'null');
    btn.click();
    await sleep(60);

    var pop = q('.xpop');
    ok('点击后弹出导出菜单', !!pop);
    var items = pop ? Array.prototype.slice.call(pop.querySelectorAll('.xpop-item')) : [];
    ok('十七个导出入口', items.length === 17, String(items.length));
    var kinds = items.map(function (b) { return b.getAttribute('data-kind'); }).join(',');
    ok('分组顺序 html,html-plain,html-opts,pdf,pdf-opts,png,jpeg,docx,odt,epub,tex,rtf,rst,mediawiki,textile,opml,revealjs',
      kinds === 'html,html-plain,html-opts,pdf,pdf-opts,png,jpeg,docx,odt,epub,tex,rtf,rst,mediawiki,textile,opml,revealjs', kinds);
    ok('五组之间四条分隔线',
      !!pop && pop.querySelectorAll('.xpop-sep').length === 4,
      pop ? String(pop.querySelectorAll('.xpop-sep').length) : 'null');
    ok('菜单里有 Word', !!pop && /Word/.test(pop.textContent));
    ok('菜单里有 ODT', !!pop && /OpenDocument/.test(pop.textContent));
    ok('菜单里有 RTF', !!pop && /RTF/.test(pop.textContent));
    ok('菜单里有 RST', !!pop && /reStructuredText/.test(pop.textContent));
    ok('菜单里有 OPML', !!pop && /OPML/.test(pop.textContent));
    ok('菜单里有 Textile', !!pop && /Textile/.test(pop.textContent));
    ok('菜单里有 RevealJS', !!pop && /RevealJS/.test(pop.textContent));
    ok('菜单里有 ePub', !!pop && /ePub/.test(pop.textContent));
    ok('菜单里有 LaTeX', !!pop && /LaTeX/.test(pop.textContent));
    ok('菜单里有 HTML（无样式）', !!pop && /HTML（无样式）/.test(pop.textContent));
    ok('菜单里有 PDF 选项', !!pop && /PDF 选项/.test(pop.textContent));
    ok('菜单里有 PNG / JPEG', !!pop && /PNG/.test(pop.textContent) && /JPEG/.test(pop.textContent));

    var r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    ok('弹层在按钮正上方', pr.bottom <= r.top + 1 && pr.bottom > r.top - 20,
      'pop.bottom=' + Math.round(pr.bottom) + ' btn.top=' + Math.round(r.top));
    ok('右边缘对齐按钮右边缘', Math.abs(pr.right - r.right) < 2,
      Math.round(pr.right) + ' vs ' + Math.round(r.right));
    ok('不超出窗口', pr.left >= 0 && pr.right <= window.innerWidth && pr.top >= 0,
      Math.round(pr.left) + ',' + Math.round(pr.top));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(50);
    ok('Esc 关闭菜单', !q('.xpop'));

    R.push('STEP 1b HTML 两种导出与选项');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html"]').click();
    await sleep(150);
    var h0 = window.__html[0] || {};
    ok('HTML 默认 styles=true', h0.styles === true, String(h0.styles));
    ok('HTML 文件名取文档名', h0.name === '集成测试.html', h0.name);
    ok('带样式版保留包裹层行内宽度', /max-width:830px/.test(h0.html || ''));
    ok('样式由原生注入而非前端内联', (h0.html || '').indexOf('<style>') < 0);

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-plain"]').click();
    await sleep(150);
    var h1 = window.__html[1] || {};
    ok('无样式版 styles=false', h1.styles === false, String(h1.styles));
    ok('无样式版只丢 CSS，限宽另算', /max-width:830px/.test(h1.html || ''));
    ok('无样式版仍保留正文结构', /class="blk[^"]*\\bh1\\b/.test(h1.html || '') && /<table/.test(h1.html || ''));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    var hd = q('#html-dlg');
    ok('弹出 HTML 选项对话框', !!hd);
    ok('三个开关', !!hd && hd.querySelectorAll('.tbl-dlg-check').length === 3,
      hd ? String(hd.querySelectorAll('.tbl-dlg-check').length) : 'null');
    ok('对话框记住上次的选择（上一步选了无样式）',
      !!hd && hd.querySelector('#html-styles').checked === false,
      hd ? String(hd.querySelector('#html-styles').checked) : 'null');
    ok('默认不内嵌图片', !!hd && hd.querySelector('#html-embed').checked === false);
    ok('默认限宽', !!hd && hd.querySelector('#html-width').checked === true);
    hd.querySelector('#html-styles').checked = true;
    hd.querySelector('#html-width').checked = false;
    hd.querySelector('#html-go').click();
    await sleep(150);
    var h2 = window.__html[2] || {};
    ok('关掉限宽后没有行内宽度', !/max-width:830px/.test(h2.html || ''));
    ok('勾回样式后 styles=true', h2.styles === true, String(h2.styles));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html"]').click();
    await sleep(150);
    var h3 = window.__html[3] || {};
    ok('选项写进偏好：再导一次还是不限宽', !/max-width:830px/.test(h3.html || ''));

    R.push('STEP 1b2 HTML 自定义 head / body 片段');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    hd = q('#html-dlg');
    ok('对话框有 head / body 两个片段框',
      !!hd && !!hd.querySelector('#html-head') && !!hd.querySelector('#html-tail'));
    ok('片段默认是空的',
      !!hd && hd.querySelector('#html-head').value === '' && hd.querySelector('#html-tail').value === '');
    // 注意：这里不能写完整的闭合标签，否则会把本页的脚本提前结束
    var TAIL_SNIP = '<script>window.__tail = 1;<' + '/script>';
    hd.querySelector('#html-head').value = '<link rel="stylesheet" href="my.css">';
    hd.querySelector('#html-tail').value = TAIL_SNIP;
    hd.querySelector('#html-go').click();
    await sleep(160);
    var h4 = window.__html[4] || {};
    ok('head 片段进了导出的 HTML',
      (h4.html || '').indexOf('<link rel="stylesheet" href="my.css">') > 0);
    ok('head 片段在 </head> 之前',
      (h4.html || '').indexOf('<link rel="stylesheet" href="my.css">') < (h4.html || '').indexOf('</head>'));
    ok('tail 片段在 </body> 之前',
      (h4.html || '').indexOf(TAIL_SNIP) > 0 &&
      (h4.html || '').indexOf(TAIL_SNIP) < (h4.html || '').indexOf('</body>'));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html"]').click();
    await sleep(150);
    var h5 = window.__html[5] || {};
    ok('片段写进偏好：走快捷项也带上', (h5.html || '').indexOf('my.css') > 0);

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    hd = q('#html-dlg');
    hd.querySelector('#html-head').value = '';
    hd.querySelector('#html-tail').value = '';
    hd.querySelector('#html-go').click();
    await sleep(160);
    var h6 = window.__html[6] || {};
    ok('清空后不再注入片段',
      (h6.html || '').indexOf('my.css') < 0 && (h6.html || '').indexOf('__tail') < 0);

    R.push('STEP 1b3 HTML 导出主题');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    hd = q('#html-dlg');
    var tsel = hd.querySelector('#html-theme');
    ok('对话框有导出主题下拉', !!tsel);
    var builtins = tsel ? tsel.querySelectorAll('option').length : 0;
    ok('六个内置 + 一个自定义主题', builtins === 7, String(builtins));
    ok('自定义主题在下拉里（带 user: 前缀）', !!tsel && !!tsel.querySelector('option[value="user:mine.css"]'));
    ok('默认跟当前主题', !!tsel && tsel.value === 'github', tsel ? tsel.value : 'null');
    ok('默认勾着包含样式', hd.querySelector('#html-styles').checked === true);
    ok('样式开着时下拉可用', tsel.disabled === false);

    hd.querySelector('#html-styles').checked = false;
    hd.querySelector('#html-styles').dispatchEvent(new Event('change'));
    ok('不导出样式时主题下拉灰掉', tsel.disabled === true);
    hd.querySelector('#html-styles').checked = true;
    hd.querySelector('#html-styles').dispatchEvent(new Event('change'));
    ok('勾回样式后恢复可选', tsel.disabled === false);

    tsel.value = 'night';
    hd.querySelector('#html-go').click();
    await sleep(200);
    var h7 = window.__html[7] || {};
    ok('导出 HTML 写 data-theme="night"', (h7.html || '').indexOf('data-theme="night"') > 0,
      (h7.html || '').slice(0, 80));
    ok('内置主题不需要额外 CSS', h7.themeCss === '', JSON.stringify(h7.themeCss));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html"]').click();
    await sleep(200);
    var h8 = window.__html[8] || {};
    ok('主题写进偏好：再导一次还是 night', (h8.html || '').indexOf('data-theme="night"') > 0);

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    hd = q('#html-dlg');
    var tsel2 = hd.querySelector('#html-theme');
    ok('下拉记住了上次选的 night', tsel2.value === 'night', tsel2.value);
    tsel2.value = 'user:mine.css';
    hd.querySelector('#html-go').click();
    await sleep(250);
    var h9 = window.__html[9] || {};
    ok('自定义主题的文件名传给了原生', (window.__themeReads || []).indexOf('mine.css') >= 0,
      (window.__themeReads || []).join(','));
    ok('自定义主题的 CSS 随导出带上', /--bg:#123456/.test(h9.themeCss || ''), h9.themeCss);
    ok('用户主题的 :root 被抬成 html[data-theme]（否则压不住内置变量）',
      (h9.themeCss || '').indexOf('html[data-theme]') >= 0 && (h9.themeCss || '').indexOf(':root') < 0,
      h9.themeCss);
    ok('自定义主题叠在当前基底上', (h9.html || '').indexOf('data-theme="github"') > 0);

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html"]').click();
    await sleep(250);
    var h10 = window.__html[10] || {};
    ok('自定义主题也写进偏好', (h10.html || '').indexOf('data-theme="github"') > 0 &&
      /--bg:#123456/.test(h10.themeCss || ''));

    // 收尾：把主题改回内置，免得影响后面几步对 HTML 的判断
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="html-opts"]').click();
    await sleep(80);
    hd = q('#html-dlg');
    hd.querySelector('#html-theme').value = 'github';
    hd.querySelector('#html-go').click();
    await sleep(200);

    R.push('STEP 1c PDF 选项与图片');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="pdf-opts"]').click();
    await sleep(80);
    var dlg = q('#pdf-dlg');
    ok('弹出 PDF 选项对话框', !!dlg);
    ok('纸张有四种', !!dlg && dlg.querySelectorAll('#pdf-paper option').length === 4,
      dlg ? String(dlg.querySelectorAll('#pdf-paper option').length) : 'null');
    ok('边距默认 42', !!dlg && dlg.querySelector('#pdf-margin').value === '42',
      dlg ? dlg.querySelector('#pdf-margin').value : 'null');

    dlg.querySelector('#pdf-paper').value = 'letter';
    dlg.querySelector('#pdf-margin').value = '30';
    dlg.querySelector('#pdf-hf').checked = true;
    dlg.querySelector('#pdf-h1').checked = true;
    dlg.querySelector('#pdf-go').click();
    await sleep(160);
    ok('导出后对话框关闭', !q('#pdf-dlg'));
    var po = window.__pdf[0] || {};
    ok('纸张传 letter', po.paper === 'letter', po.paper);
    ok('边距传 30', po.margin === 30, String(po.margin));
    ok('页眉页脚传 true', po.headerFooter === true, String(po.headerFooter));
    ok('H1 分页传 true', po.h1page === true, String(po.h1page));
    ok('书签开关默认开', po.bookmarks === true, String(po.bookmarks));
    ok('书签从标题生成', Array.isArray(po.outline) && po.outline.length === 1 &&
      po.outline[0].level === 1 && po.outline[0].text === '导出集成测试',
      JSON.stringify(po.outline));
    ok('导出结束清掉 pdf-h1page', !document.body.classList.contains('pdf-h1page'));
    ok('打印类也清掉', !document.body.classList.contains('printing'));
    var savedPref = {};
    try { savedPref = JSON.parse(localStorage.getItem('opentypora.prefs') || '{}'); } catch (e) {}
    ok('选项写进偏好', savedPref.pdfPaper === 'letter' && savedPref.pdfMargin === 30,
      JSON.stringify(savedPref.pdfPaper) + '/' + JSON.stringify(savedPref.pdfMargin));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="pdf"]').click();
    await sleep(160);
    var po2 = window.__pdf[1] || {};
    ok('直接导出沿用上次选项', po2.paper === 'letter' && po2.margin === 30 && po2.h1page === true,
      JSON.stringify(po2));

    // 书签可以关掉：关掉后 payload 里 outline 必须是空数组，原生才不会白跑一遍
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="pdf-opts"]').click();   // 走「PDF 选项…」才有对话框
    await sleep(120);
    var dlg2 = q('#pdf-dlg');
    ok('对话框有书签开关且默认勾选', !!dlg2 && dlg2.querySelector('#pdf-book').checked === true);
    dlg2.querySelector('#pdf-book').checked = false;
    dlg2.querySelector('#pdf-go').click();
    await sleep(180);
    var po3 = window.__pdf[2] || {};
    ok('关掉书签后 bookmarks=false', po3.bookmarks === false, String(po3.bookmarks));
    ok('关掉书签后 outline 为空', Array.isArray(po3.outline) && po3.outline.length === 0,
      JSON.stringify(po3.outline));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="png"]').click();
    await sleep(150);
    ok('PNG 走 exportImage(png)', window.__img[0] === 'png', String(window.__img[0]));

    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="jpeg"]').click();
    await sleep(150);
    ok('JPEG 走 exportImage(jpeg)', window.__img[1] === 'jpeg', String(window.__img[1]));

    R.push('STEP 2 Word 导出');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="docx"]').click();
    await sleep(900);
    ok('选完自动关菜单', !q('.xpop'));
    ok('只导出一次', window.__captured.length === 1, String(window.__captured.length));

    var cap = window.__captured[0] || {};
    ok('扩展名 docx', cap.ext === 'docx', cap.ext);
    ok('文件名取自文档', cap.name === '集成测试.docx', cap.name);

    var bytes = cap.base64 ? bytesOf(cap) : new Uint8Array();
    var head = latin(bytes.subarray(0, 4));
    ok('是合法 zip 头（PK\\\\x03\\\\x04）', head === 'PK\\u0003\\u0004', JSON.stringify(head));

    var blob = utf8(bytes);   // store 包里的中文是原始 UTF-8，按 utf-8 解才能搜到
    ['word/document.xml', 'word/styles.xml', 'word/footnotes.xml', '[Content_Types].xml'].forEach(function (n) {
      ok('包含部件 ' + n, blob.indexOf(n) >= 0);
    });
    ok('读图走了 readBinary', window.__readBin.length >= 1 && /pic\\.png$/.test(window.__readBin[0]),
      window.__readBin.join(','));
    ok('图片进了 media', blob.indexOf('word/media/image1.png') >= 0);
    ok('图片按 120×80 定尺寸', blob.indexOf('cx="1143000"') >= 0, '缺 1143000');
    ok('脚注内容写进 footnotes', blob.indexOf('注释内容') >= 0);

    R.push('STEP 3 ePub 导出');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="epub"]').click();
    await sleep(900);
    var cap2 = window.__captured[1] || {};
    ok('扩展名 epub', cap2.ext === 'epub', cap2.ext);
    var b2 = cap2.base64 ? bytesOf(cap2) : new Uint8Array();
    ok('epub 也以 PK 开头', latin(b2.subarray(0, 2)) === 'PK');
    var s2 = latin(b2);
    ok('开局就是 mimetype', s2.indexOf('mimetype') >= 0 && s2.indexOf('mimetype') < 40,
      String(s2.indexOf('mimetype')));
    ok('有 content.opf', s2.indexOf('OEBPS/content.opf') >= 0);
    ok('有 nav.xhtml', s2.indexOf('OEBPS/nav.xhtml') >= 0);
    ok('章节里有 h1', s2.indexOf('<h1 id="sec1"') >= 0);

    R.push('STEP 4 LaTeX 导出');
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="tex"]').click();
    await sleep(900);
    var cap3 = window.__captured[2] || {};
    ok('扩展名 tex', cap3.ext === 'tex', cap3.ext);
    var tex = cap3.base64 ? utf8(bytesOf(cap3)) : '';
    ok('有 ctexart 文档类', tex.indexOf('\\\\documentclass') >= 0 && tex.indexOf('ctexart') >= 0);
    ok('标题平成 section', tex.indexOf('\\\\section{导出集成测试}') >= 0);
    ok('脚注内联', tex.indexOf('\\\\footnote{注释内容}') >= 0);
    ok('表格转 tabular', tex.indexOf('\\\\begin{tabular}') >= 0);

    R.push('STEP 5 边界');
    Editor.load('', null, '空文档.md');
    await sleep(150);
    var before = window.__captured.length;
    btn.click();
    await sleep(60);
    q('.xpop-item[data-kind="docx"]').click();
    await sleep(300);
    ok('空文档不导出', window.__captured.length === before, String(window.__captured.length - before));
    ok('空文档给了提示', !!q('#toast') && /空/.test(q('#toast').textContent), q('#toast') ? q('#toast').textContent : '');

    clearTimeout(watchdog);
    report();
  }

  window.addEventListener('load', function () {
    run().catch(function (e) {
      R.push('FAIL 脚本异常 | ' + (e && e.message ? e.message : e));
      report();
    });
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('<script src="js/bridge.js"></script>', '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
