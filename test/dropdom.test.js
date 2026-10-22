// 生成「拖文件进编辑器插入链接」集成测试页（WKWebView）。
// 纯函数（路径解析 / 计划 / 转义）在 dropfile.test.js；这里测真实 drop 事件、
// FileReader 异步、Bridge 落盘与 toast 文案。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__dropdom_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__saved = [];
window.__imgs = [];
window.__toasts = [];
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  openFile: function () { return Promise.resolve(null); },
  openFolder: function () { return Promise.resolve({ root: '/ws', tree: [] }); },
  readText: function () { return Promise.resolve('# 标题\\n\\n正文\\n'); },
  readFile: function (p) {
    return Promise.resolve({ path: p, name: p.split('/').pop(), content: '# 标题\\n\\n正文段落。\\n' });
  },
  fsList: function (p) {
    var names = window.__saved.map(function (s) { return s.path.split('/').pop(); });
    return Promise.resolve({ root: p, tree: names.map(function (n) { return { name: n, dir: false }; }) });
  },
  save: function (p, c) { window.__saved.push({ path: p, content: c }); return Promise.resolve({ path: p }); },
  /* 图片落盘：把目录原样记下来，返回绝对路径（真机由原生侧写文件） */
  saveImage: function (data, docPath, dest) {
    window.__imgs.push({ docPath: docPath, dest: dest, len: String(data || '').length });
    var dir = dest || '/tmp/opentypora-assets';
    return Promise.resolve({ path: dir + '/image-1700000000.png' });
  },
  saveAs: function (n, c) { return Promise.resolve({ path: '/ws/' + n }); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  readBinary: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $() { return document.getElementById('editor'); }

  function mkFile(name, text, type) {
    return new File([text], name, { type: type || 'text/markdown' });
  }
  // payload: { 'text/uri-list': '...' } —— 模拟 Finder 拖入时挂着的那层文本
  function mkDT(files, payload) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    Object.keys(payload || {}).forEach(function (k) { dt.setData(k, payload[k]); });
    return dt;
  }
  function drop(dt, alt) {
    var ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, altKey: !!alt });
    $().dispatchEvent(ev);
  }
  function raw() { return Editor.getValue(); }
  /* 走真实的「打开文件」链路，currentPath 才会被设上（相对路径依赖它）。
   * 标签页之后，同一个路径再打开是「切过去」而不是「重新读盘」——
   * 所以这里切完再把正文重置回初值（这组用例要的是干净的起点）。 */
  async function clearWith(src) {
    await OpenTyporaCmd.openPath('/ws/doc.md');
    await sleep(150);
    Editor.load(src, '/ws/doc.md', 'doc.md');
    Editor.markSaved('/ws/doc.md', 'doc.md');
    await sleep(60);
  }
  function clear() { return clearWith('# 标题\\n\\n正文段落。\\n'); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'DROPDOM ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:720px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    await sleep(400);
    document.documentElement.setAttribute('data-theme', 'github');

    /* ---------- 1 有真实路径：相对当前文档 ---------- */
    await clear();
    Editor.enterEdit(1, 0);
    await sleep(100);
    drop(mkDT([mkFile('other.md', '# 别的\\n')], { 'text/uri-list': 'file:///ws/notes/other.md' }));
    await sleep(200);
    ok('插入了链接', raw().indexOf('[other.md]') > 0, raw());
    ok('路径按当前文档算相对', raw().indexOf('](notes/other.md)') > 0, raw());
    ok('没有误开文件（标题还在）', raw().indexOf('# 标题') === 0, raw().slice(0, 20));

    /* ---------- 2 文件名带空格 ---------- */
    await clear();
    Editor.enterEdit(1, 0);
    await sleep(100);
    drop(mkDT([mkFile('my note.md', 'x')], { 'text/uri-list': 'file:///ws/my%20note.md' }));
    await sleep(200);
    ok('空格转成 %20', raw().indexOf('](my%20note.md)') > 0, raw());
    ok('标签里保留原文件名', raw().indexOf('[my note.md]') > 0, raw());

    /* ---------- 3 拿不到路径：复制进 assets ---------- */
    await clear();
    window.__saved = [];
    Editor.enterEdit(1, 0);
    await sleep(100);
    drop(mkDT([mkFile('copyme.md', '# 复制我\\n')]));
    await sleep(350);
    ok('写盘到 assets/', window.__saved.length === 1 &&
      window.__saved[0].path === '/ws/assets/copyme.md',
      JSON.stringify(window.__saved.map(function (s) { return s.path; })));
    ok('写盘内容取自文件', window.__saved[0] && window.__saved[0].content.indexOf('复制我') >= 0);
    ok('链接指向 assets/', raw().indexOf('](assets/copyme.md)') > 0, raw());

    /* ---------- 4 同名已存在：自动改名 ---------- */
    await clear();
    Editor.enterEdit(1, 0);
    await sleep(100);
    drop(mkDT([mkFile('copyme.md', 'second')]));
    await sleep(350);
    ok('同名不覆盖，追加 -2', raw().indexOf('](assets/copyme-2.md)') > 0, raw());
    ok('第二份也落盘了', window.__saved.length === 2 &&
      window.__saved[1].path === '/ws/assets/copyme-2.md',
      JSON.stringify(window.__saved.map(function (s) { return s.path; })));

    /* ---------- 5 二进制且没路径：只能链文件名 ---------- */
    await clear();
    Editor.enterEdit(1, 0);
    await sleep(100);
    var before = window.__saved.length;
    drop(mkDT([mkFile('report.pdf', 'PDF', 'application/pdf')]));
    await sleep(250);
    ok('二进制不写盘', window.__saved.length === before, String(window.__saved.length));
    ok('退化成文件名链接', raw().indexOf('](report.pdf)') > 0, raw());
    ok('提示了路径可能不准', /手工修正/.test(document.body.textContent), '没有提示');

    /* ---------- 6 ⌥ 拖入 = 直接打开 ---------- */
    await clear();
    drop(mkDT([mkFile('openme.md', '# 打开我\\n\\n第二段\\n')], { 'text/uri-list': 'file:///ws/openme.md' }), true);
    await sleep(300);
    ok('⌥ 拖入替换为文档内容', raw().indexOf('# 打开我') === 0, raw().slice(0, 20));
    ok('⌥ 拖入不插链接', raw().indexOf('](openme.md)') < 0, raw());

    /* ---------- 7 拖到源码模式 ---------- */
    await clear();
    Editor.toggleSource(true);
    await sleep(150);
    var src = document.querySelector('#editor textarea, .src-mode textarea, textarea');
    ok('进入源码模式', !!src);
    drop(mkDT([mkFile('src.md', 'x')], { 'text/uri-list': 'file:///ws/src.md' }));
    await sleep(200);
    var srcNow = document.querySelector('textarea');
    ok('源码模式也插到光标处', srcNow && srcNow.value.indexOf('](src.md)') > 0,
      srcNow ? srcNow.value.slice(-40) : 'null');
    Editor.toggleSource(false);
    await sleep(150);

    /* ---------- 8 拖入图片：默认落文档同级 assets/ ---------- */
    await clear();
    window.__imgs = [];
    Editor.enterEdit(1, 0);
    await sleep(80);
    drop(mkDT([mkFile('shot.png', 'PNG', 'image/png')]));
    await sleep(300);
    ok('图片落文档同级 assets/', window.__imgs.length === 1 && window.__imgs[0].dest === '/ws/assets',
      JSON.stringify(window.__imgs));
    ok('引用写成相对路径', raw().indexOf('](assets/image-1700000000.png)') > 0, raw());
    ok('alt 取文件名去掉扩展名', raw().indexOf('![shot]') > 0, raw());

    /* ---------- 9 typora-copy-images-to 决定落盘目录 ---------- */
    await clearWith('---\\ntypora-copy-images-to: ./media/img\\n---\\n\\n正文段落。\\n');
    window.__imgs = [];
    Editor.enterEdit(1, 0);
    await sleep(80);
    drop(mkDT([mkFile('a.png', 'PNG', 'image/png')]));
    await sleep(300);
    ok('copy-images-to 按文档目录解析成绝对目录',
      !!window.__imgs[0] && window.__imgs[0].dest === '/ws/media/img', JSON.stringify(window.__imgs));
    ok('引用跟着写进 media/img/', raw().indexOf('](media/img/image-1700000000.png)') > 0, raw());

    /* ---------- 10 同时配了 root-url：引用按 root 目录换算 ---------- */
    await clearWith('---\\ntypora-copy-images-to: media/img\\ntypora-root-url: ./res\\n---\\n\\n正文段落。\\n');
    window.__imgs = [];
    Editor.enterEdit(1, 0);
    await sleep(80);
    drop(mkDT([mkFile('b.png', 'PNG', 'image/png')]));
    await sleep(300);
    ok('root-url 时引用按 root 目录换算',
      raw().indexOf('](../media/img/image-1700000000.png)') > 0, raw());

    /* ---------- 11 粘贴（不是拖入）走同一条落盘逻辑 ---------- */
    await clear();
    window.__imgs = [];
    Editor.enterEdit(1, 0);
    await sleep(80);
    var el = document.querySelector('#editor .src');
    var dt2 = mkDT([mkFile('clip.png', 'PNG', 'image/png')]);
    var pev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pev, 'clipboardData', { value: dt2 });
    el.dispatchEvent(pev);
    await sleep(350);
    ok('粘贴的图片也记下目录', window.__imgs.length === 1 && window.__imgs[0].dest === '/ws/assets',
      JSON.stringify(window.__imgs));
    ok('粘贴的图片插进正文', raw().indexOf('](assets/image-1700000000.png)') > 0, raw());

    /* ---------- 12 文档没落盘：不给目录，引用用绝对路径 ---------- */
    OpenTyporaCmd.newTab();
    await sleep(200);
    window.__imgs = [];
    Editor.enterEdit(0, 0);
    await sleep(80);
    drop(mkDT([mkFile('t.png', 'PNG', 'image/png')]));
    await sleep(300);
    ok('未保存文档不传目录（原生侧落临时目录）',
      !!window.__imgs[0] && window.__imgs[0].dest === '', JSON.stringify(window.__imgs));
    ok('引用退化成绝对路径',
      raw().indexOf('](/tmp/opentypora-assets/image-1700000000.png)') > 0, raw());

    report();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) { R.push('THROW ' + (e && e.message || e)); report(); });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
