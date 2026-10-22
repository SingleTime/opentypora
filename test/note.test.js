// 脚注悬浮预览 + wiki 链接 的集成测试（真实 WKWebView，build/shot 取 __report）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', '__note_harness.html');

const DOC = [
  '# 笔记',
  '',
  '正文引用[^a]，再来一处[^b]。',
  '',
  '见 [[笔记]]、[[甲|别名]]、[[不存在]] 与 [[#小节]]。',
  '',
  '## 小节',
  '',
  '小节正文。',
  '',
  '[^a]: 甲说明里有 `code` 片段',
  '[^b]: 乙说明'
].join('\n');

const NOTES = [
  { name: '笔记.md', rel: '笔记.md', path: '/tmp/notes/笔记.md' },
  { name: '甲.md', rel: 'sub/甲.md', path: '/tmp/notes/sub/甲.md' }
];

// 注意：bridge.js 顶层是 var Bridge = …，会覆盖前面挂的 mock —— 必须放在 </body>（所有脚本之后）
const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
window.__opened = [];
window.Bridge = {
  available: true,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/n.md' }); },
  saveAs: function () { return Promise.resolve({ path: '/tmp/n.md' }); },
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
  translate: function () { return Promise.resolve({ text: '' }); },
  readFile: function (p) {
    window.__opened.push(p);
    if (p === '/tmp/notes/笔记.md') {
      return Promise.resolve({ path: p, name: '笔记.md', content: '# 目标页\\n\\n跳过来了。\\n' });
    }
    return Promise.reject(new Error('ENOENT ' + p));
  }
};
</script>`;

const TEST = String.raw`
(function () {
  var pass = 0, fail = 0, bad = [];
  function ok(c, m) { if (c) pass++; else { fail++; bad.push(m); } }
  function eq(a, b, m) { ok(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var DOC = JSON.parse(document.getElementById('__doc').textContent);
  var NOTES = JSON.parse(document.getElementById('__notes').textContent);

  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function ev(el, type, opt) {
    el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, opt || {})));
  }

  (async function () {
    await sleep(600);
    try {
      // 文件树清单是 wiki 判活链 / 解析目标的依据
      window.OpenTyporaCmd.listNotes = function () { return NOTES.slice(); };

      Editor.load(DOC, '/tmp/notes/当前.md', '当前.md');
      await sleep(300);

      /* ---------------- wiki 链接渲染 ---------------- */
      var links = qa('#editor .wiki-link');
      eq(links.length, 4, '4 个 wiki 链接都渲染成 a.wiki-link');
      eq(links[0] && links[0].getAttribute('data-wiki'), '笔记', '目标名存在 data-wiki');
      eq(links[0] && links[0].textContent, '笔记', '无别名时显示目标名');
      eq(links[1] && links[1].textContent, '别名', '[[目标|别名]] 显示别名');
      eq(links[1] && links[1].getAttribute('data-wiki'), '甲', '别名不影响目标');
      eq(links[1] && links[1].getAttribute('href'), '甲.md', '没有扩展名的目标补 .md');
      eq(links[3] && links[3].textContent, '小节', '[[#小节]] 显示时去掉 #');
      eq(links[3] && links[3].getAttribute('href'), '#小节', '锚点链接 href 是 #片段');
      ok(!!q('#editor .blk.para'), '旁边段落还在（没被 [[ 吃掉）');

      /* ---------------- 坏链标记 ---------------- */
      eq(links[2] && links[2].classList.contains('wiki-missing'), true, '目标不在文件树里 → wiki-missing');
      eq(links[0] && links[0].classList.contains('wiki-missing'), false, '存在的目标不标坏链');
      eq(links[1] && links[1].classList.contains('wiki-missing'), false, '[[甲]] 能按名字命中 sub/甲.md');

      /* ---------------- 点击打开 ---------------- */
      var before = Editor.getName();
      ev(links[0], 'click');
      await sleep(400);
      eq(Editor.getName(), '笔记.md', '点击 [[笔记]] 打开了目标文件');
      ok(window.__opened.indexOf('/tmp/notes/笔记.md') >= 0,
        '按文件树里的真实路径打开：' + window.__opened.join(' , '));
      ok(before === '当前.md', '打开前确实是当前文档');

      /* ---------------- 锚点链接不跳文件 ---------------- */
      Editor.load(DOC, '/tmp/notes/当前.md', '当前.md');
      await sleep(250);
      var openedBefore = window.__opened.length;
      ev(qa('#editor .wiki-link')[3], 'click');
      await sleep(200);
      eq(window.__opened.length, openedBefore, '[[#小节]] 不会去读文件');
      ok(window.__scrolled !== false, '锚点点击没抛异常');

      /* ---------------- 脚注悬浮预览 ---------------- */
      var ref = q('#editor .fn-ref');
      ok(!!ref, '有一个脚注角标');
      eq(ref && ref.getAttribute('data-n'), '1', '角标编号是 1');

      ev(ref, 'mouseover');
      await sleep(220);
      var pop = q('.fn-pop.on');
      ok(!!pop, '悬停后浮层出现');
      ok(!!pop && pop.textContent.indexOf('甲说明里有') >= 0, '浮层里是定义正文：' + (pop ? pop.textContent : ''));
      ok(!!pop && !!pop.querySelector('code'), '定义里的行内代码在浮层里也是 code');
      ok(!!pop && pop.textContent.indexOf('甲说明里有 code 片段') >= 0, '脚注序号没跑进正文');
      eq(ref.getAttribute('title'), null, '浮层出现时摘掉了原生 title（避免双 tooltip）');

      var r = pop ? pop.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
      ok(r.left >= 0 && r.top >= 0, '浮层位置在视口内：' + Math.round(r.left) + ',' + Math.round(r.top));
      ok(r.right <= window.innerWidth + 1, '没超出右边界：' + Math.round(r.right) + '/' + window.innerWidth);

      // 移到别处就收起
      ev(q('#editor .blk.para'), 'mouseover');
      await sleep(260);
      eq(!!q('.fn-pop.on'), false, '鼠标移开后浮层收起');
      ok(!!ref.getAttribute('title'), '收起后原生 title 还回去了');

      /* ---------------- 输入 [[ 浮出笔记选单 ---------------- */
      var pblock = qa('#editor .blk.para')[1];
      var pr = pblock.getBoundingClientRect();
      ev(pblock, 'mousedown', { clientX: pr.left + 4, clientY: pr.top + 6 });
      await sleep(200);
      var ta = q('#editor .src');
      ok(!!ta, '进入块内编辑态');
      if (ta) {
        ta.value = '看 [[';
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(80);
        var wl = q('.wl-pop.on');
        ok(!!wl, '敲到 [[ 后选单出现');
        var items = qa('.wl-pop .wl-item');
        eq(items.length, 2, '列出文件夹里的 2 篇笔记');
        ok(items.length && items[0].textContent.indexOf('笔记') >= 0, '选单里是笔记名');

        // 过滤
        ta.value = '看 [[甲';
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(80);
        eq(qa('.wl-pop .wl-item').length, 1, '输入查询词后只剩 1 条');

        // Enter 插入
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(120);
        eq(ta.value, '看 [[sub/甲]]', '回车插入 [[sub/甲]]（子目录里的笔记带相对路径）');
        eq(!!q('.wl-pop.on'), false, '插入后选单收起');
        ok(!!ta.closest('.blk'), '插入后仍停在编辑态');
        Editor.exitEdit();
        await sleep(80);
      }

      /* ---------------- 分栏预览里同样渲染 ---------------- */
      Editor.load(DOC, '/tmp/notes/当前.md', '当前.md');
      await sleep(250);
      window.OpenTyporaCmd.toggleSplit();
      await sleep(320);
      var pv = document.getElementById('split-prev-inner');
      eq(pv ? pv.querySelectorAll('.wiki-link').length : -1, 4,
        '分栏预览里也有 wiki 链接（pv=' + !!pv + ' n=' + (pv ? pv.querySelectorAll('.wiki-link').length : -1) +
        ' blk=' + (pv ? pv.querySelectorAll('.blk').length : -1) +
        ' split=' + Editor.isSplitMode() + '）');

      // 分栏源码里敲 [[ 也给选单
      var st2 = document.getElementById('split-src');
      ok(!!st2, '分栏源码 textarea 在');
      if (st2) {
        st2.value = '再补一条 [[';
        st2.setSelectionRange(st2.value.length, st2.value.length);
        st2.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(120);
        ok(!!q('.wl-pop.on'), '分栏源码里敲 [[ 也浮出选单');
        st2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(80);
        ok(!q('.wl-pop.on'), 'Esc 关掉选单');
      }

      window.OpenTyporaCmd.toggleSplit();
      await sleep(260);

      /* ---------------- 导出 ---------------- */
      Editor.load(DOC, '/tmp/notes/当前.md', '当前.md');
      await sleep(200);
      var h = Editor.exportHTML();
      ok(h.indexOf('class="wiki-link"') > 0, '导出的 HTML 保留 wiki 链接');

      window.__report = 'NOTE ' + pass + '/' + (pass + fail) +
        (fail ? ' | ' + bad.join(' ; ') : '') +
        (window.__errs.length ? ' [错误 ' + window.__errs.join(' / ') + ']' : '');
    } catch (e) {
      window.__report = 'NOTE 异常 ' + (e && e.message) + ' @ ' + (e && e.stack || '').split('\n')[1] +
        ' [已完成 ' + pass + '/' + (pass + fail) + ']' +
        (window.__errs.length ? ' [错误 ' + window.__errs.join(' / ') + ']' : '');
    }
  })();
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('<body>', function () {
  var doc = JSON.stringify(DOC).replace(/<\//g, '<\\/');
  var notes = JSON.stringify(NOTES).replace(/<\//g, '<\\/');
  return '<body>\n<script id="__doc" type="application/json">' + doc + '</script>' +
    '\n<script id="__notes" type="application/json">' + notes + '</script>';
});
html = html.replace('</body>', function () { return MOCK + '\n<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
