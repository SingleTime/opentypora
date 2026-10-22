// 演示页：wiki 链接 + 脚注悬浮预览（node test/note.demo.js [pick]）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MODE = process.argv[2] === 'pick' ? 'pick' : 'links';
const OUT = path.join(ROOT, 'app', MODE === 'pick' ? '__note_demo_pick.html' : '__note_demo.html');

const DOC = [
  '# 笔记链接与脚注',
  '',
  '这一页演示两件小事：正文里的 `[[笔记名]]` 能直接跳到另一篇笔记，脚注角标不用跳到文末。',
  '',
  '先铺垫两行，好让浮层有地方待着。',
  '',
  '正文里引用一段说明[^1]，鼠标停在角标上就能读到内容，不用跳到底部。',
  '',
  '相关笔记：[[读书笔记]]、[[周报-2026-10|上周周报]]、[[#附注]]，以及还没写的 [[草稿]]。',
  '',
  '输入 `[[` 会浮出笔记选单，方向键选、回车插入。',
  '',
  '## 附注',
  '',
  '下面这条就是脚注定义区。',
  '',
  '[^1]: 浮层里能放**强调**、`行内代码` 与 [链接](https://example.com)，排版跟正文一致。'
].join('\n');

const NOTES = [
  { name: '读书笔记.md', rel: '读书笔记.md', path: '/tmp/demo/读书笔记.md' },
  { name: '周报-2026-10.md', rel: '周报/周报-2026-10.md', path: '/tmp/demo/周报/周报-2026-10.md' },
  { name: '写作计划.md', rel: '写作计划.md', path: '/tmp/demo/写作计划.md' }
];

const MOCK = `<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: false,
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  listThemes: function () { return Promise.resolve({ themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  confirm: function () { return Promise.resolve(true); },
  readFile: function (p) { return Promise.reject(new Error('ENOENT ' + p)); }
};
</script>`;

const TEST = String.raw`
(function () {
  var DOC = JSON.parse(document.getElementById('__doc').textContent);
  var NOTES = JSON.parse(document.getElementById('__notes').textContent);
  var MODE = document.getElementById('__mode').getAttribute('data-mode');
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  (async function () {
    await sleep(600);
    try {
      window.OpenTyporaCmd.listNotes = function () { return NOTES.slice(); };
      Editor.load(DOC, '/tmp/demo/当前.md', '当前.md');
      await sleep(400);

      if (MODE === 'pick') {
        var para = qa('#editor .blk.para')[2];
        var r = para.getBoundingClientRect();
        para.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, clientX: r.left + 6, clientY: r.top + 8
        }));
        await sleep(200);
        var ta = q('#editor textarea.src');
        if (ta) {
          ta.value = '再补一条：[[周';
          ta.setSelectionRange(ta.value.length, ta.value.length);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(200);
        window.__report = 'pick ok items=' + qa('.wl-pop .wl-item').length;
        return;
      }

      // 脚注浮层：静态截图里要它可见，直接调 show()
      var ref = q('#editor .fn-ref');
      if (ref && window.FnPop) FnPop.show(ref);
      await sleep(220);
      window.__report = 'links ok wiki=' + qa('#editor .wiki-link').length +
        ' missing=' + qa('#editor .wiki-link.wiki-missing').length +
        ' pop=' + !!q('.fn-pop.on');
    } catch (e) {
      window.__report = 'demo 异常 ' + (e && e.message);
    }
  })();
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
html = html.replace('<body>', function () {
  var doc = JSON.stringify(DOC).replace(/<\//g, '<\\/');
  var notes = JSON.stringify(NOTES).replace(/<\//g, '<\\/');
  return '<body>\n<script id="__doc" type="application/json">' + doc + '</script>' +
    '\n<script id="__notes" type="application/json">' + notes + '</script>' +
    '\n<script id="__mode" data-mode="' + MODE + '"></script>';
});
html = html.replace('</body>', function () { return MOCK + '\n<script>\n' + TEST + '\n</script>\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('demo →', OUT);
