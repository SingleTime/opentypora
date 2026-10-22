// 图片尺寸演示页：生成 4 张对比图（原图 / 固定宽高 / 只定宽 / 只定高）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__image_demo.html');
const IMGDIR = '/tmp/opentypora-img';

/* 造一张 400×240 的渐变 PNG */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      raw[p++] = 40 + Math.round((x / w) * 120);
      raw[p++] = 90 + Math.round((y / h) * 100);
      raw[p++] = 200 - Math.round((x / w) * 90);
    }
  }
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([l, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(IMGDIR, { recursive: true });
fs.writeFileSync(path.join(IMGDIR, 'pic.png'), makePng(400, 240));

const DOC = [
  '# 图片尺寸',
  '',
  '原图 400×240，不写尺寸时按原样显示：',
  '',
  '![原图](' + IMGDIR + '/pic.png)',
  '',
  '固定 200×120（可能变形）：',
  '',
  '![固定](' + IMGDIR + '/pic.png =200x120)',
  '',
  '只定宽 260，高度按比例：',
  '',
  '![宽](' + IMGDIR + '/pic.png =260)',
  '',
  '只定高 90，宽度按比例：',
  '',
  '![高](' + IMGDIR + '/pic.png =x90)',
  '',
  '路径带空格也能写（用尖括号包起来）：',
  '',
  '![空格](<' + IMGDIR + '/my pic.png> =140)',
  ''
].join('\n');

// 顺带造一张带空格的文件，验证 `<...>` 路径
fs.writeFileSync(path.join(IMGDIR, 'my pic.png'), makePng(400, 240));

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true, setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__i.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__i.md' }); },
  saveImage: function () { return Promise.resolve('assets/x.png'); },
  confirm: function () { return Promise.resolve(true); },
  openUrl: function () { return Promise.resolve(null); },
  exportHTML: function () { return Promise.resolve({ path: '/tmp/x.html' }); },
  exportPDF: function () { return Promise.resolve({ path: '/tmp/x.pdf' }); },
  exportFile: function () { return Promise.resolve({ path: '/tmp/x.bin' }); },
  readBinary: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: '' }); }
};
</script>`;

const BODY = `setTimeout(function () {
  Editor.load(${JSON.stringify(DOC)}, '/tmp/image-demo.md', 'image-demo.md');
  setTimeout(function () {
    var imgs = [].slice.call(document.querySelectorAll('#editor img'));
    var bad = imgs.filter(function (i) { return !i.complete || !i.naturalWidth; });
    window.__report = 'IMG 图片数=' + imgs.length + ' 加载失败=' + bad.length +
      ' 尺寸=' + imgs.map(function (i) {
        return Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height);
      }).join(',');
  }, 700);
}, 500);`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('</head>', function () { return MOCK + '\n</head>'; });
html = html.replace('<body>', function () {
  return '<body>\n<script id="__doc" type="application/json">' + JSON.stringify(DOC) + '</script>';
});
html = html.replace('</body>', function () { return '<script>\n' + BODY + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
