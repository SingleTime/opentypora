// code.demo.js —— 代码块 Code Tools 演示页（出 docs/opentypora-code-tools.png）
// 一张图说明三件事：代码块本身（行号 + 语言下拉）、右键菜单八项、以及缩进整理后的样子。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__code_demo.html');

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
  async function run() {
    await sleep(400);
    // 主题变量挂在 html[data-theme]，不设的话所有 var(--x) 都是空值
    document.documentElement.setAttribute('data-theme', 'github');

    var src = [
      '# 网关限流改造', '',
      '限流器改成令牌桶，超时时间按上游 P99 再留 20% 余量。', '',
      F + 'js',
      'function take(bucket, n) {',
      'if (!bucket.tokens) return false;',
      'var ok = bucket.tokens >= n;',
      'if (ok) bucket.tokens -= n;',
      'return ok;',
      '}',
      F, '',
      '注意：令牌桶只在单进程内有效，多副本要换成 Redis 版本。', ''
    ].join('\\n');
    Editor.load(src, '/Users/fw/限流.md', '限流.md');
    await sleep(350);
    // 行号是偏好项（默认关），截图里开着更能体现 gutter 与正文对齐
    Editor.setTyping({ autoPair: true, smart: false, codeLineNo: true });
    await sleep(250);

    // 先把缩进整理一次，让截图里显示的是「整理后」的正常代码
    var blk = document.querySelector('#editor .blk.code');
    var rect = blk.getBoundingClientRect();
    var ctx = Code.ctxOf(blk, rect.left + 40, rect.top + 20);
    Code.runCmd(ctx, 'reindent');
    await sleep(250);

    // 打开右键菜单，落在代码块右下方
    blk = document.querySelector('#editor .blk.code');
    var i = +blk.getAttribute('data-i');
    var raw = Editor.getRaw(i);
    var rg = Code.bodyRange(raw);
    Code.showMenu(Code.menuItems(rg.sp.lang), 470, 300, function () {});
    await sleep(250);

    // 给代码块加个柔和的聚焦框，截图里能一眼看出菜单属于它
    blk.style.cssText += ';box-shadow:0 0 0 2px #0969da;border-radius:8px';
    var pop = document.getElementById('ctxmenu');
    if (pop) pop.style.cssText += ';box-shadow:0 8px 24px rgba(0,0,0,.18)';
    await sleep(200);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
