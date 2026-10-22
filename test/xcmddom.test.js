// 生成「自定义导出命令」集成测试页（WKWebView）。
// 纯函数部分由 xcmd.test.js 覆盖；这里验证真实 DOM 链路：
// 偏好面板增删编辑 → 导出菜单列项 → 点击 → Bridge.runExport 参数 → 成功/失败提示。
// 真正的 /bin/sh 执行在原生侧，这里用 mock Bridge 断言「传出去的命令是对的」。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__xcmd_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
// 预置两条命令：一条正常，一条缺 {out}（用来验证校验拦截）
window.__PRESET = [
  { id: 'a', name: 'ICML', cmd: 'pandoc -f markdown "{src}" -o "{out}"', ext: 'icml' },
  { id: 'b', name: '坏命令', cmd: 'pandoc "{src}"', ext: 'icml' }
];
try {
  localStorage.setItem('opentypora.prefs', JSON.stringify({ exportCmds: window.__PRESET }));
} catch (e) {}
window.__calls = { runExport: [], reveal: [] };
window.__nextResult = { path: '/Users/me/笔记.icml', log: '' };
window.__nextError = null;

function __mockBridge() {
  window.Bridge = {
    available: true,
    ready: function () { return Promise.resolve({ file: null, content: '' }); },
    setTitle: function () { return Promise.resolve(null); },
    status: function () { return Promise.resolve(null); },
    setFile: function () { return Promise.resolve(null); },
    save: function () { return Promise.resolve({ path: '/Users/me/笔记.md' }); },
    saveAs: function () { return Promise.resolve({ path: '/Users/me/笔记.md' }); },
    openFile: function () { return Promise.resolve(null); },
    openFolder: function () { return Promise.resolve(null); },
    confirm: function () { return Promise.resolve(true); },
    copy: function () { return Promise.resolve(null); },
    reveal: function (p) { window.__calls.reveal.push(p); return Promise.resolve(null); },
    openUrl: function () { return Promise.resolve(null); },
    translate: function () { return Promise.resolve({ text: 'x' }); },
    listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
    readTheme: function () { return Promise.resolve({ css: '' }); },
    openThemeFolder: function () { return Promise.resolve(null); },
    runExport: function (o) {
      window.__calls.runExport.push(o);
      if (window.__nextError) return Promise.reject(new Error(window.__nextError));
      return Promise.resolve(window.__nextResult);
    }
  };
}
__mockBridge();
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
  function $(id) { return document.getElementById(id); }
  function rows() { return document.querySelectorAll('#xcmd-list .xcmd-row'); }
  function toastText() { return $('toast').textContent; }
  function toastAct() { return document.querySelector('#toast .toast-act'); }
  function openMenu() {
    OpenTyporaCmd.exportMenu();
    return document.querySelector('.xpop');
  }
  function menuItems() {
    return Array.prototype.slice.call(document.querySelectorAll('.xpop .xpop-item'));
  }
  function clickKind(kind) {
    var b = document.querySelector('.xpop .xpop-item[data-kind="' + kind + '"]');
    if (!b) return false;
    b.click();
    return true;
  }
  function report() {
    var asserts = R.filter(function (s) { return /^\\d+\\. (PASS|FAIL) /.test(s); });
    var n = asserts.filter(function (s) { return s.indexOf('PASS ') >= 0; }).length;
    window.__report = 'XCMD ' + n + '/' + asserts.length + '\\n' + R.join('\\n');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;background:#0b0f14;color:#7ee787;' +
      'font:11.5px/1.5 Menlo,monospace;padding:8px 12px;border-radius:8px;max-width:680px;max-height:78vh;overflow:auto';
    box.textContent = window.__report;
    document.body.appendChild(box);
  }

  async function run() {
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时'); report(); } }, 60000);
    await sleep(400);

    /* ---------- STEP 1 文档与初始状态 ---------- */
    R.push('STEP 1 初始状态');
    Editor.load('# 标题\\n\\n正文一段。', '/Users/me/笔记.md', '笔记.md');
    await sleep(120);
    ok('文档加载了', Editor.getText().indexOf('# 标题') >= 0);
    ok('Xcmd 模块在', !!window.Xcmd);
    ok('预置命令读进 prefs', OpenTyporaCmd.preferences && true);

    /* ---------- STEP 2 偏好面板渲染 ---------- */
    R.push('STEP 2 偏好面板');
    OpenTyporaCmd.preferences();
    await sleep(200);
    ok('偏好面板打开了', $('prefs').classList.contains('show'));
    ok('渲染出 2 行命令', rows().length === 2, String(rows().length));
    ok('第一行名称是 ICML', rows()[0].querySelector('.xcmd-name').value === 'ICML');
    ok('第二行是坏命令', rows()[1].querySelector('.xcmd-name').value === '坏命令');
    ok('命令框里带占位符', rows()[0].querySelector('[data-f="cmd"]').value.indexOf('{src}') >= 0);
    ok('ext 框是 icml', rows()[0].querySelector('[data-f="ext"]').value === 'icml');

    /* ---------- STEP 3 编辑命令落进 prefs ---------- */
    R.push('STEP 3 编辑保存');
    var nameEl = rows()[0].querySelector('.xcmd-name');
    nameEl.value = 'ICML 出片';
    nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);
    var saved = JSON.parse(localStorage.getItem('opentypora.prefs')).exportCmds;
    ok('改名写进了 prefs', saved[0].name === 'ICML 出片', saved[0].name);
    ok('id 保持不变', saved[0].id === 'a', saved[0].id);

    /* ---------- STEP 4 添加与删除 ---------- */
    R.push('STEP 4 添加与删除');
    $('xcmd-add').click();
    await sleep(150);
    ok('添加后 3 行', rows().length === 3, String(rows().length));
    var newCmd = rows()[2].querySelector('[data-f="cmd"]').value;
    ok('新命令有默认模板', /\\{src\\}/.test(newCmd) && /\\{out\\}/.test(newCmd), newCmd);

    rows()[2].querySelector('.xcmd-del').click();
    await sleep(150);
    ok('删除后回到 2 行', rows().length === 2, String(rows().length));

    /* ---------- STEP 5 pandoc 预设 ---------- */
    R.push('STEP 5 pandoc 预设');
    $('xcmd-pandoc').click();
    await sleep(200);
    ok('预设填进来后 5 行', rows().length === 5, String(rows().length));
    var names = Array.prototype.slice.call(rows()).map(function (r) { return r.querySelector('.xcmd-name').value; });
    ok('预设名字都在', names.join('|').indexOf('ICML（InDesign）') >= 0 &&
      names.join('|').indexOf('DocBook 5') >= 0 && names.join('|').indexOf('AsciiDoc') >= 0, names.join('|'));
    $('xcmd-pandoc').click();
    await sleep(200);
    ok('重复点不重复添加', rows().length === 5, String(rows().length));

    /* ---------- STEP 6 导出菜单列出自定义命令 ---------- */
    R.push('STEP 6 导出菜单');
    document.getElementById('prefs-close').click();
    await sleep(120);
    var pop = openMenu();
    await sleep(120);
    ok('菜单弹出来了', !!pop);
    var kinds = menuItems().map(function (b) { return b.getAttribute('data-kind'); });
    ok('菜单里有自定义组', kinds.some(function (k) { return k.indexOf('cmd:') === 0; }));
    ok('自定义项和命令数一致', kinds.filter(function (k) { return k.indexOf('cmd:') === 0; }).length === 5,
      String(kinds.filter(function (k) { return k.indexOf('cmd:') === 0; }).length));
    var first = document.querySelector('.xpop .xpop-item[data-kind="cmd:a"]');
    ok('第一项标题是改后的名字', first && first.querySelector('.xpop-t').textContent === 'ICML 出片',
      first ? first.querySelector('.xpop-t').textContent : 'null');
    ok('副标题是命令摘要', first && first.querySelector('.xpop-d').textContent.indexOf('pandoc') === 0,
      first ? first.querySelector('.xpop-d').textContent : 'null');

    /* ---------- STEP 7 点击调用 Bridge.runExport ---------- */
    R.push('STEP 7 触发导出');
    ok('点得到自定义项', clickKind('cmd:a'));
    await sleep(250);
    ok('runExport 被调用', window.__calls.runExport.length === 1,
      String(window.__calls.runExport.length));
    var c = window.__calls.runExport[0];
    ok('传出的 cmd 未展开（占位符留给原生）', c && c.cmd.indexOf('{src}') >= 0 && c.cmd.indexOf('{out}') >= 0,
      c ? c.cmd : 'null');
    ok('ext 是 icml', c && c.ext === 'icml', c ? c.ext : 'null');
    ok('name 是文档主名（去掉 .md）', c && c.name === '笔记', c ? c.name : 'null');
    ok('dir 是文档所在目录', c && c.dir === '/Users/me', c ? c.dir : 'null');
    ok('content 带上了正文', c && c.content.indexOf('# 标题') >= 0, c ? String(c.content).slice(0, 20) : 'null');
    ok('成功后 toast 报文件名', toastText().indexOf('已导出 笔记.icml') >= 0, toastText().slice(0, 30));

    /* ---------- STEP 8 成功后的「在 Finder 中显示」 ---------- */
    R.push('STEP 8 Finder 按钮');
    ok('出现 Finder 按钮', !!toastAct() && toastAct().textContent === '在 Finder 中显示');
    toastAct().click();
    await sleep(150);
    ok('reveal 收到输出路径', window.__calls.reveal.length === 1 &&
      window.__calls.reveal[0] === '/Users/me/笔记.icml', JSON.stringify(window.__calls.reveal));

    /* ---------- STEP 9 校验拦截：缺 {out} 的命令不执行 ---------- */
    R.push('STEP 9 校验拦截');
    var before = window.__calls.runExport.length;
    openMenu();
    await sleep(120);
    ok('点得到坏命令', clickKind('cmd:b'));
    await sleep(200);
    ok('坏命令没有调用原生', window.__calls.runExport.length === before,
      String(window.__calls.runExport.length));
    ok('toast 提示缺 {out}', toastText().indexOf('缺少 {out}') >= 0, toastText().slice(0, 40));

    /* ---------- STEP 10 pandoc 缺失（原生拒绝） ---------- */
    R.push('STEP 10 命令不存在');
    window.__nextError = '找不到程序「pandoc」\\n先装一下：brew install pandoc';
    openMenu();
    await sleep(120);
    clickKind('cmd:a');
    await sleep(250);
    ok('失败时 toast 带错误文案', toastText().indexOf('导出失败') >= 0, toastText().slice(0, 30));
    ok('错误信息里给了安装提示', toastText().indexOf('brew install pandoc') >= 0, toastText().slice(0, 60));

    /* ---------- STEP 11 取消保存面板 ---------- */
    R.push('STEP 11 取消');
    window.__nextError = null;
    window.__nextResult = null;
    openMenu();
    await sleep(120);
    clickKind('cmd:a');
    await sleep(250);
    ok('取消时提示已取消', toastText().indexOf('已取消') >= 0, toastText().slice(0, 20));
    window.__nextResult = { path: '/Users/me/笔记.icml', log: '' };

    /* ---------- STEP 12 空文档与未命名文档 ---------- */
    R.push('STEP 12 空文档');
    var n2 = window.__calls.runExport.length;
    Editor.load('', null, '未命名.md');
    await sleep(120);
    openMenu();
    await sleep(120);
    clickKind('cmd:a');
    await sleep(200);
    ok('空文档不出命令', window.__calls.runExport.length === n2, String(window.__calls.runExport.length));
    ok('提示文档是空的', toastText().indexOf('文档是空的') >= 0, toastText().slice(0, 20));

    Editor.load('# 未命名\\n\\n内容。', null, '未命名.md');
    await sleep(120);
    openMenu();
    await sleep(120);
    clickKind('cmd:a');
    await sleep(250);
    var last = window.__calls.runExport[window.__calls.runExport.length - 1];
    ok('未保存文档 name 仍取主名', last && last.name === '未命名', last ? last.name : 'null');
    ok('未保存文档 dir 传空串（原生用上次目录）', last && last.dir === '', JSON.stringify(last && last.dir));

    /* ---------- STEP 13 清空命令后菜单不再显示自定义组 ---------- */
    R.push('STEP 13 清空');
    OpenTyporaCmd.preferences();
    await sleep(150);
    var guard = 0;
    while (rows().length && guard++ < 20) rows()[0].querySelector('.xcmd-del').click();
    await sleep(200);
    ok('全部删完', rows().length === 0, String(rows().length));
    ok('空列表有引导文案', !!document.querySelector('#xcmd-list .xcmd-empty'));
    document.getElementById('prefs-close').click();
    await sleep(120);
    openMenu();
    await sleep(120);
    var kinds2 = menuItems().map(function (b) { return b.getAttribute('data-kind'); });
    ok('没有命令时菜单不显示自定义组', !kinds2.some(function (k) { return k.indexOf('cmd:') === 0; }));

    clearTimeout(watchdog);
    report();
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (e) {
        R.push('THROW ' + (e && e.message) + ' @ ' + (e && e.stack ? e.stack.split('\\n')[1] : ''));
        report();
      });
    }, 60);
  });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + TEST + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
