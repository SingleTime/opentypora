// exportopts.test.js —— 导出选项归一化（PDF 纸张/边距、图片格式）
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const E = require(path.join(ROOT, 'app/js/export.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

console.log('纸张尺寸表');
{
  eq('内置四种纸张', Object.keys(E.papers).join(','), 'a4,letter,a3,a5');
  ok('A4 尺寸', Math.abs(E.papers.a4.w - 595.28) < 0.01 && Math.abs(E.papers.a4.h - 841.89) < 0.01);
  ok('Letter 尺寸', E.papers.letter.w === 612 && E.papers.letter.h === 792);
}

console.log('PDF 选项归一化');
{
  const d = E.pdfOptions();
  eq('默认纸张 A4', d.paper, 'a4');
  eq('默认边距 42', d.margin, 42);
  eq('默认不带页眉脚', d.headerFooter, false);
  eq('默认不按 H1 分页', d.h1page, false);

  eq('大小写不敏感', E.pdfOptions({ paper: 'Letter' }).paper, 'letter');
  eq('未知纸张回落 A4', E.pdfOptions({ paper: 'b5' }).paper, 'a4');
  eq('空值回落 A4', E.pdfOptions({ paper: null }).paper, 'a4');

  eq('边距取整', E.pdfOptions({ margin: 41.6 }).margin, 42);
  eq('负边距夹到 0', E.pdfOptions({ margin: -20 }).margin, 0);
  eq('过大边距夹到 120', E.pdfOptions({ margin: 999 }).margin, 120);
  eq('非数字边距回落 42', E.pdfOptions({ margin: 'abc' }).margin, 42);
  eq('字符串数字可用', E.pdfOptions({ margin: '30' }).margin, 30);

  ok('布尔强制', E.pdfOptions({ headerFooter: 1, h1page: 'x' }).headerFooter === true &&
                 E.pdfOptions({ headerFooter: 1, h1page: 'x' }).h1page === true);
  ok('假值收敛', E.pdfOptions({ headerFooter: 0, h1page: null }).headerFooter === false);

  const full = E.pdfOptions({ paper: 'a5', margin: 60, headerFooter: true, h1page: true, extra: 1 });
  eq('只保留已知字段', Object.keys(full).sort().join(','), 'bookmarks,h1page,headerFooter,margin,paper');
  eq('书签默认开', full.bookmarks, true);
  eq('书签可关', E.pdfOptions({ bookmarks: false }).bookmarks, false);
}

console.log('图片格式');
{
  eq('默认 png', E.imageFormat(), 'png');
  eq('jpeg 原样', E.imageFormat('jpeg'), 'jpeg');
  eq('大写归一', E.imageFormat('JPEG'), 'jpeg');
  eq('jpg 视为 png（桥接只认 jpeg）', E.imageFormat('jpg'), 'png');
  eq('未知回落 png', E.imageFormat('webp'), 'png');
  eq('png 扩展名', E.imageExt('png'), 'png');
  eq('jpeg 扩展名', E.imageExt('jpeg'), 'jpg');
}

console.log('原有导出 API 未被破坏');
{
  ok('formats 仍在', !!E.formats.docx && !!E.formats.epub && !!E.formats.tex);
  ok('build 仍是函数', typeof E.build === 'function');
  ok('latex 仍是函数', typeof E.latex === 'function');
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
