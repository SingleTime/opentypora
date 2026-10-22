// highlight.demo.js —— 语法高亮演示页（出 docs/opentypora-highlight.png 与 -night.png）
// 选四种「以前只有字面量颜色」的语言：CSS（属性/色值/at-rule）、Python（装饰器/文档串）、
// SQL（大写关键字）、diff（增删行）。一屏能看出 tok-key / tok-type / tok-meta / tok-ins
// 这几个新 token 类都用上了。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__highlight_demo.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  var F = String.fromCharCode(96, 96, 96);
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var src = [
    '# 语法高亮：32 套词法', '',
    '以前只认 11 种语言，其余一律按「注释 + 字符串」蒙。现在按语言给了方言表：',
    '关键字、类型、属性名、注解、预处理器、diff 增删行各有颜色。', '',
    F + 'css',
    '/* 主题按钮 */',
    '.btn:hover {',
    '  color: #0969da;',
    '  margin: 8px 0;',
    '}',
    '@media print { .btn { display: none !important; } }',
    F, '',
    F + 'python',
    '@app.route("/health")',
    'def health():',
    '    """K8s 探针走这里"""',
    '    return {"ok": True, "n": 1}',
    F, '',
    F + 'sql',
    '-- 上周新增的慢查询',
    'SELECT id, name FROM users',
    "WHERE name = 'fw' AND deleted_at IS NULL",
    'ORDER BY id DESC LIMIT 20;',
    F, '',
    F + 'diff',
    'diff --git a/limit.js b/limit.js',
    '--- a/limit.js',
    '+++ b/limit.js',
    '@@ -1,3 +1,4 @@',
    '-var timeout = 800;',
    '+var timeout = 1000; // 上游 P99 再留 20%',
    '+var retries = 2;',
    F, ''
  ].join('\\n');

  function run() {
    // 主题交给 shot 的第 6 个参数（Editor.setTheme 会设 data-theme），没传就用 github
    if (!document.documentElement.getAttribute('data-theme')) {
      document.documentElement.setAttribute('data-theme', 'github');
    }
    Editor.load(src, '/Users/fw/notes/highlight.md', 'highlight.md');
    setTimeout(function () {
      Editor.setTyping({ codeLineNo: true });
      setTimeout(function () { window.__demoReady = true; }, 250);
    }, 400);
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
