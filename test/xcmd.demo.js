// xcmd.demo.js —— 自定义导出命令演示页（出 docs/opentypora-xcmd.png）
// 两张：偏好面板里的命令列表 + 导出菜单末尾的自定义组。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
// shot 的第 5 个参数是主题名，传不了 hash —— 所以每个视图各生成一个页面
const OUTS = {
  prefs: path.join(ROOT, 'app', '__xcmd_demo_prefs.html'),
  menu: path.join(ROOT, 'app', '__xcmd_demo_menu.html')
};

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__PRESET = [
  { id: 'a', name: 'ICML（InDesign）', cmd: 'pandoc -f markdown -t icml --resource-path="{dir}" "{src}" -o "{out}"', ext: 'icml' },
  { id: 'b', name: 'DocBook 5', cmd: 'pandoc -f markdown -t docbook5 --resource-path="{dir}" "{src}" -o "{out}"', ext: 'xml' },
  { id: 'c', name: 'AsciiDoc', cmd: 'pandoc -f markdown -t asciidoc --resource-path="{dir}" "{src}" -o "{out}"', ext: 'adoc' }
];
try { localStorage.setItem('opentypora.prefs', JSON.stringify({ exportCmds: window.__PRESET })); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  confirm: function () { return Promise.resolve(true); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  translate: function () { return Promise.resolve({ text: 'x' }); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); },
  runExport: function () { return Promise.resolve(null); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function run() {
    await sleep(400);
    var mode = __MODE__;
    // 主题变量挂在 html[data-theme]，不设的话所有 var(--x) 都是空值
    document.documentElement.setAttribute('data-theme', 'github');
    Editor.load([
      '# 季度技术评审', '',
      '把这一节交给 InDesign 排版：正文、表格、脚注都在。', '',
      '| 项目 | 负责人 | 状态 |',
      '| --- | ---: | --- |',
      '| 网关 | FW | 完成 |',
      '| 日志 | LJ | 进行中 |', '',
      '## 备注', '',
      '自定义导出命令走 /bin/sh，占位符见偏好面板。', ''
    ].join('\\n'), '/Users/fw/季度评审.md', '季度评审.md');
    await sleep(300);

    if (mode === 'prefs') {
      OpenTyporaCmd.preferences();
      await sleep(400);
      // 滚到「自定义导出命令」那组（直接设 scrollTop，scrollIntoView 会把整页带歪）
      var g = Array.prototype.slice.call(document.querySelectorAll('.prefs-group'))
        .filter(function (x) { return x.textContent.indexOf('自定义导出命令') >= 0; })[0];
      var body = document.querySelector('.prefs-body');
      if (g && body) {
        body.scrollTop = Math.max(0, g.offsetTop - body.offsetTop - 8);
      }
      await sleep(200);
      var box = document.getElementById('xcmd-list');
      if (box) {
        box.style.cssText += ';box-shadow:0 0 0 2px #0969da;border-radius:8px';
      }
    } else {
      OpenTyporaCmd.exportMenu();
      await sleep(400);
      var pop = document.querySelector('.xpop');
      if (pop) {
        pop.style.cssText += ';box-shadow:0 0 0 2px #0969da';
        var first = pop.querySelector('.xpop-item[data-kind^="cmd:"]');
        if (first) first.scrollIntoView({ block: 'center' });
      }
    }
    await sleep(200);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

Object.keys(OUTS).forEach(function (mode) {
  let html = fs.readFileSync(SRC, 'utf8');
  // 先拼好整段脚本再插进页面，避免 replace 的 callback 重复求值
  const demo = DEMO.replace('__MODE__', JSON.stringify(mode));
  html = html.replace('</body>', function () { return MOCK + demo + '\n</body>'; });
  fs.writeFileSync(OUTS[mode], html);
  console.log('wrote ' + path.relative(ROOT, OUTS[mode]));
});
