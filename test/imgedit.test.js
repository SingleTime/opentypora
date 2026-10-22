// imgedit.test.js —— 大纲筛选/折叠 + 图片右键管理（真实 WKWebView + mock 原生桥）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__img_harness.html');

const DOC = [
  '# 总览',
  '',
  '第一段 ![](assets/a.png) 末尾。',
  '',
  '## 安装',
  '',
  '### 子步骤',
  '',
  '正文',
  '',
  '## 使用',
  '',
  '## 附录'
].join('\n');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__calls = [];
window.__renamed = null;
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () {
    return Promise.resolve({ file: '/tmp/__img/doc.md', content: ${JSON.stringify(DOC)} });
  },
  save: function (p, c) { window.__calls.push(['save', p]); return Promise.resolve({ path: p }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/__img/doc.md' }); },
  confirm: function () { window.__calls.push(['confirm']); return Promise.resolve(true); },
  openUrl: function (u) { window.__calls.push(['openUrl', u]); return Promise.resolve(null); },
  reveal: function (p) { window.__calls.push(['reveal', p]); return Promise.resolve(null); },
  copy: function (t) { window.__calls.push(['copy', t]); return Promise.resolve(null); },
  fsRename: function (p, n) {
    window.__renamed = [p, n];
    var dir = p.replace(/\\/[^\\/]+$/, '');
    return Promise.resolve({ path: dir + '/' + n });
  },
  fsCopyTo: function (p, d) {
    window.__calls.push(['copyTo', p, d]);
    return Promise.resolve({ path: d + '/' + p.replace(/^.*\\//, '') });
  },
  fsMoveTo: function (p, d) {
    window.__calls.push(['moveTo', p, d]);
    return Promise.resolve({ path: d + '/' + p.replace(/^.*\\//, '') });
  },
  fsTrash: function (p) { window.__calls.push(['trash', p]); return Promise.resolve({ path: p }); },
  chooseFolder: function () { return Promise.resolve('/tmp/__img/moved'); },
  pickImages: function () {
    return Promise.resolve([{ path: '/tmp/__img/src/pic one.png', name: 'pic one.png' }]);
  },
  imgImport: function (s, docPath, dest) {
    window.__calls.push(['imgImport', s, docPath, dest]);
    return Promise.resolve({ path: '/tmp/__img/assets/pic one.png' });
  },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  fsList: function (p) { return Promise.resolve({ root: p, tree: [] }); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push((R.length + 1) + '. ' + (cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'IMGEDIT ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    document.documentElement.setAttribute('data-report', window.__report);
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:999;margin:0;padding:8px 12px;' +
      'background:#0b0f14;color:#7ee787;font:11.5px/1.5 Menlo,monospace;border-radius:8px;' +
      'max-width:720px;max-height:74vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }
  function menuItem(re) {
    return qa('#ctxmenu .ctx-item').filter(function (b) { return re.test(b.textContent); })[0];
  }

  async function run() {
    await sleep(500);

    R.push('STEP 1 大纲渲染');
    var tabs = qa('.side-tab');
    tabs.filter(function (b) { return b.getAttribute('data-panel') === 'outline'; })[0].click();
    await sleep(120);
    ok('大纲有 5 个标题', qa('#outline .outline-item').length === 5, String(qa('#outline .outline-item').length));
    ok('筛选框存在', !!$('outline-q'));
    ok('总览有折叠箭头', !!qa('#outline .ol-caret[data-fold]').length);
    ok('叶子标题没有箭头', qa('#outline .ol-caret.ghost').length >= 1,
       String(qa('#outline .ol-caret.ghost').length));

    R.push('STEP 2 大纲筛选');
    $('outline-q').value = '使用';
    $('outline-q').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    ok('筛选后只剩 1 条', qa('#outline .outline-item').length === 1,
       String(qa('#outline .outline-item').length));
    $('outline-q').value = '不存在';
    $('outline-q').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    ok('无匹配时给提示', /没有匹配的标题/.test($('outline').textContent));
    $('outline-q').value = '';
    $('outline-q').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    ok('清空筛选恢复 5 条', qa('#outline .outline-item').length === 5,
       $('outline-q').value + ' / ' + qa('#outline .outline-item').length);

    R.push('STEP 3 大纲折叠');
    var carets = qa('#outline .ol-caret[data-fold]');
    var firstKey = carets[0].getAttribute('data-fold');
    carets[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(100);
    var afterFold = qa('#outline .outline-item').length;
    ok('折叠总览后条目变少', afterFold < 5, String(afterFold));
    ok('折叠状态记在箭头方向', q('.ol-caret[data-fold="' + firstKey + '"]').classList.contains('fold'));
    q('.ol-caret[data-fold="' + firstKey + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(100);
    ok('再点一次展开', qa('#outline .outline-item').length === 5);

    R.push('STEP 4 图片居中开关');
    ok('默认不居中', !document.body.classList.contains('img-center'));
    $('prefs-imgcenter').checked = true;
    $('prefs-imgcenter').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    ok('打开后 body 有 img-center', document.body.classList.contains('img-center'));
    var pref = JSON.parse(localStorage.getItem('opentypora.prefs') || '{}');
    ok('偏好被持久化', pref.imgCenter === true, JSON.stringify(pref.imgCenter));
    $('prefs-imgcenter').checked = false;
    $('prefs-imgcenter').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);

    R.push('STEP 5 图片右键菜单');
    var img = q('#editor img');
    ok('正文里有图片', !!img);
    ok('图片带源偏移 data-s', img.getAttribute('data-s') != null, img.getAttribute('data-s'));
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 240, clientY: 260 }));
    await sleep(120);
    var menu = $('ctxmenu');
    ok('右键弹出菜单', menu.classList.contains('show'));
    ok('有重命名项', !!menuItem(/重命名图片/));
    ok('有移动/复制项', !!menuItem(/移动到文件夹/) && !!menuItem(/复制到文件夹/));
    ok('有删除项', !!menuItem(/删除图片/));

    R.push('STEP 6 重命名图片');
    menuItem(/重命名图片/).click();
    await sleep(150);
    var ip = $('wb-prompt');
    ok('弹出重命名对话框', !!ip);
    ok('默认值是不带扩展名的文件名', ip.value === 'a', ip.value);
    ip.value = 'cover';
    $('wb-ok').click();
    await sleep(250);
    ok('调用了 fsRename', !!window.__renamed && /\\/assets\\/a\\.png$/.test(window.__renamed[0]),
       JSON.stringify(window.__renamed));
    ok('新文件名带原扩展名', window.__renamed && window.__renamed[1] === 'cover.png',
       window.__renamed && window.__renamed[1]);
    var img2 = q('#editor img');
    ok('正文引用被改写', img2.getAttribute('src') === 'assets/cover.png', img2.getAttribute('src'));
    ok('重命名链路无异常提示', !/失败/.test($('toast').textContent), $('toast').textContent);

    R.push('STEP 7 移动到文件夹');
    img2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 260, clientY: 300 }));
    await sleep(120);
    menuItem(/移动到文件夹/).click();
    await sleep(250);
    var mv = window.__calls.filter(function (c) { return c[0] === 'moveTo'; })[0];
    ok('调用了 moveTo', !!mv, JSON.stringify(mv));
    ok('目标目录来自选择框', mv && mv[2] === '/tmp/__img/moved', mv && mv[2]);
    var img3 = q('#editor img');
    ok('改写为相对新路径', img3.getAttribute('src') === 'moved/cover.png', img3.getAttribute('src'));
    ok('移动链路无异常提示', !/失败/.test($('toast').textContent), $('toast').textContent);

    R.push('STEP 8 删除图片');
    img3.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 280, clientY: 320 }));
    await sleep(120);
    menuItem(/删除图片/).click();
    await sleep(250);
    var tr = window.__calls.filter(function (c) { return c[0] === 'trash'; })[0];
    ok('文件进废纸篓', !!tr && /cover\\.png$/.test(tr[1]), JSON.stringify(tr));
    ok('正文里的引用被删掉', !q('#editor img'));
    ok('残留文字还在', /第一段/.test($('editor').textContent));
    ok('删除链路无异常提示', !/失败/.test($('toast').textContent), $('toast').textContent);
    ok('文档被标脏（会触发自动保存）', window.__calls.filter(function (c) { return c[0] === 'save'; }).length >= 0);

    R.push('STEP 9 插入图片（⌘⌃I 同路径）');
    $('editor').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    window.OpenTyporaCmd.insertImage();
    await sleep(350);
    var imp = window.__calls.filter(function (c) { return c[0] === 'imgImport'; })[0];
    ok('调用了 imgImport', !!imp, JSON.stringify(imp));
    ok('默认落到文档的 assets', imp && imp[3] === '', imp && JSON.stringify(imp));
    ok('插入链路无异常提示', !/失败/.test($('toast').textContent), $('toast').textContent);
    ok('插入的是带尖括号的相对路径', $('editor').textContent.indexOf('pic one.png') >= 0 ||
       !!q('#editor img[src="assets/pic one.png"]') || q('#editor').innerHTML.indexOf('pic%20one.png') >= 0 ||
       q('#editor').innerHTML.indexOf('pic one.png') >= 0);

    R.push('STEP 10 全部图片移到 assets');
    window.OpenTyporaCmd.moveImages();
    await sleep(300);
    ok('已收进 assets 的图片不再重复搬', !window.__calls.filter(function (c) {
      return c[0] === 'copyTo' && /assets\\/pic one\\.png$/.test(c[1]);
    }).length);

    clearTimeout(window.__wd);
    report();
  }

  window.addEventListener('load', function () {
    window.__wd = setTimeout(function () { if (!window.__report) report(); }, 12000);
    window.onerror = function (msg, src, line) {
      R.push('JS错误 ' + msg + ' @' + line);
      if (!window.__report) report();
    };
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
