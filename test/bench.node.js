const B = require('./bench.js');
const sizes = [500, 2000, 8000];   // ≈0.3 MB / 1.2 MB / 4.8 MB

function fmt(n) { return String(Math.round(n)).padStart(6) + ' ms'; }

B.run(sizes, (res) => {
  console.log('规模           字符数     parse    docx     epub     latex   同步阻塞  docx体积');
  res.rows.forEach(r => {
    console.log(
      String(r.units + ' 单元').padEnd(14),
      String((r.chars / 1024 / 1024).toFixed(2) + 'M').padStart(7),
      fmt(r.parse), fmt(r.docx), fmt(r.epub), fmt(r.tex),
      fmt(r.block), String((r.docxBytes / 1024 / 1024).toFixed(2) + 'M').padStart(8)
    );
  });
  console.log('\n纯 zip 写入 (2×3MB 文本, 共 ' + (res.zipBytes / 1024 / 1024).toFixed(1) + 'MB)：' + Math.round(res.zipMs) + ' ms');
  console.log('base64 编码 (同体积)：' + Math.round(res.b64Ms) + ' ms');

  const first = res.rows[0], last = res.rows[res.rows.length - 1];
  const scale = last.units / first.units;
  console.log('\n线性度（' + scale + '× 数据量）：parse ' + (last.parse / first.parse).toFixed(2) +
    '×，docx ' + (last.docx / first.docx).toFixed(2) + '×，epub ' + (last.epub / first.epub).toFixed(2) + '×');
});
