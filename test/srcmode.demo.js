// srcmode.demo.js —— 源码模式（⌘/）行号 + 高亮演示页
// 出两张图：docs/opentypora-source-code.png（github）与 -night.png。
// 一张图要说明三件事：左边行号列、正文按 markdown 上色、以及「这仍是可编辑的 textarea」。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__srcmode_demo.html');

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
  var Q = String.fromCharCode(96);
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function run() {
    await sleep(420);

    var src = [
      '# 网关限流改造',
      '',
      '把进程内的计数器换成令牌桶，桶容量按上游 P99 留 20% 余量。',
      '',
      '## 为什么不是漏桶',
      '',
      '- 漏桶恒定速率，突发流量直接丢掉；',
      '- 令牌桶允许短时突发，代价是要多存一个 ' + Q + 'tokens' + Q + ' 字段；',
      '- 多副本必须换 Redis 版本，单机桶只在**单进程**内有效。',
      '',
      '## 取令牌',
      '',
      F + 'js',
      'function take(bucket, n) {',
      '  var now = Date.now();',
      '  refill(bucket, now);            // 按 elapsed 补桶',
      '  if (bucket.tokens < n) return false;',
      '  bucket.tokens -= n;',
      '  return true;',
      '}',
      F,
      '',
      '> 注意：refill 必须先补桶再判断，否则空桶永远拿不到令牌。',
      '',
      '## 参数',
      '',
      '| 参数 | 含义 | 默认 |',
      '| --- | --- | --- |',
      '| ' + Q + 'capacity' + Q + ' | 桶容量 | 100 |',
      '| ' + Q + 'rate' + Q + ' | 每秒补充 | 20 |',
      '',
      '## 压测结论',
      '',
      '1. 单进程 P99 从 42ms 降到 18ms；',
      '2. 两副本打同一桶，命中率掉到 61%，所以必须走 Redis；',
      '3. 超时时间别按平均值留，要按 P99 留。',
      '',
      '收尾：改完记得同步 grafana 面板的阈值。',
      ''
    ].join('\\n');

    Editor.load(src, '/Users/fw/网关限流.md', '网关限流.md');
    await sleep(320);

    // 进源码模式：整篇变成带行号与高亮的 textarea
    Editor.toggleSource(true);
    await sleep(320);

    // 把光标放在 refill 那一行，截图里能看到真实光标而不是空选区
    var ta = document.getElementById('source-area');
    var idx = ta.value.indexOf('refill(bucket, now)');
    if (idx >= 0) ta.setSelectionRange(idx, idx);
    await sleep(160);

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
