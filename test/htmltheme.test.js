/* HTML 导出「导出主题」：前端归一化 + 与 app.css 的一致性 + 原生注入（真跑 Swift）
 *
 * Swift 部分不是 mock：native/webexport.swift 与测试一起编译，验证样式注入的
 * 位置、顺序、转义和缺 </head> 的兜底。编译产物缓存到 build/htmlthemetest。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Export = require(path.join(ROOT, 'app', 'js', 'export.js'));
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'app', 'js', 'ui.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'app', 'js', 'bridge.js'), 'utf8');

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      期望 ' + JSON.stringify(String(want)) + '\n      实际 ' + JSON.stringify(String(got))); }
}
function group(n) { console.log('\n' + n); }

/* ---------------------------------------------- 主题表与 app.css */
group('内置主题表与 app.css 的变量块对齐');
{
  const ids = Export.themes.map(t => t.id);
  eq('六套内置主题', ids.join(','), 'github,night,newsprint,pixyll,whitey,gothic');
  eq('顺序与下拉一致（默认第一个是 GitHub）', ids[0], 'github');
  const inCss = [...CSS.matchAll(/html\[data-theme="([a-z0-9-]+)"\]/g)].map(m => m[1]);
  const uniq = [...new Set(inCss)].sort();
  const missing = ids.filter(id => uniq.indexOf(id) < 0);
  ok('每个主题在 app.css 里都有变量块', missing.length === 0, '缺 ' + missing.join(','));
  const orphan = uniq.filter(id => ids.indexOf(id) < 0);
  ok('app.css 里没有主题表之外的主题', orphan.length === 0, '多出 ' + orphan.join(','));
  Export.themes.forEach(t => {
    ok(t.label.length > 0 && t.label !== t.id, '主题 ' + t.id + ' 有显示名');
  });
}

/* ---------------------------------------------- 归一化 */
group('themePick 归一化');
{
  eq('默认跟当前主题（github）', Export.themePick(undefined, undefined).id, 'github');
  eq('给了内置主题就照用', Export.themePick('night', 'github').id, 'night');
  eq('未知主题回落 github', Export.themePick('solarized', undefined).id, 'github');
  eq('大小写不敏感', Export.themePick('Night', undefined).id, 'night');
  eq('前后空格忽略', Export.themePick('  whitey  ', undefined).id, 'whitey');
  eq('空串回落到 base', Export.themePick('', 'pixyll').id, 'pixyll');
  eq('自定义主题叠在 base 上', Export.themePick('user:mine.css', 'newsprint').id, 'newsprint');
  eq('自定义主题文件名', Export.themePick('user:mine.css', 'newsprint').file, 'mine.css');
  eq('自定义主题的原始值', Export.themePick('user:mine.css', 'night').raw, 'user:mine.css');
  eq('没有自定义主题时 raw 就是 id', Export.themePick('gothic', undefined).raw, 'gothic');
  eq('base 也未知时回落 github', Export.themePick('user:x.css', 'nosuch').id, 'github');
}

group('自定义主题文件名挡路径穿越');
{
  eq('斜杠被去掉', Export.themePick('user:../../etc/passwd.css').file, 'etcpasswd.css');
  eq('反斜杠被去掉', Export.themePick('user:..\\win.css').file, 'win.css');
  eq('前导点被去掉', Export.themePick('user:...hidden.css').file, 'hidden.css');
  eq('绝对路径退化成文件名', Export.themePick('user:/tmp/x.css').file, 'tmpx.css');
}

group('htmlOptions 带上主题字段');
{
  const d = Export.htmlOptions();
  eq('默认主题 github', d.theme, 'github');
  eq('默认没有自定义主题文件', d.themeFile, '');
  eq('夜间主题', Export.htmlOptions({ theme: 'night' }).theme, 'night');
  eq('自定义主题走 base', Export.htmlOptions({ theme: 'user:a.css', base: 'gothic' }).theme, 'gothic');
  eq('自定义主题文件名', Export.htmlOptions({ theme: 'user:a.css', base: 'gothic' }).themeFile, 'a.css');
  ok('其余字段没被挤掉', d.styles === true && d.embed === false && d.width === true);
}

/* ---------------------------------------------- 文档壳 */
group('htmlDoc 输出 data-theme 与 opentypora-export');
{
  const gh = Export.htmlDoc('<p>x</p>', { title: 'T' });
  ok('默认写 data-theme="github"', gh.indexOf('<html data-theme="github" class="opentypora-export">') >= 0,
    gh.slice(0, 120));
  ok('body 也带 opentypora-export', gh.indexOf('<body class="opentypora-export">') >= 0);
  const nt = Export.htmlDoc('<p>x</p>', { title: 'T', theme: 'night' });
  ok('切夜间写 data-theme="night"', nt.indexOf('<html data-theme="night"') >= 0);
  ok('只有一个 <html', (nt.match(/<html/g) || []).length === 1);
  ok('DOCTYPE 在最前', nt.indexOf('<!DOCTYPE html>') === 0);
  ok('主题不合法时回落 github',
    Export.htmlDoc('', { theme: '"><script>' }).indexOf('data-theme="github"') >= 0);
  ok('head 片段仍排在 </head> 之前',
    (() => {
      const h = Export.htmlDoc('', { title: 'T', head: '<link rel="x">' });
      return h.indexOf('<link rel="x">') > 0 && h.indexOf('<link rel="x">') < h.indexOf('</head>');
    })());
}

group('app.css 为导出摘掉外壳滚动限制');
{
  ok('有 html.opentypora-export 规则', CSS.indexOf('html.opentypora-export') >= 0);
  ok('导出里没有 height:100% 的死锁',
    /html\.opentypora-export,\s*body\.opentypora-export\s*\{[^}]*height:\s*auto/.test(CSS));
  ok('导出里没有 overflow:hidden',
    /html\.opentypora-export,\s*body\.opentypora-export\s*\{[^}]*overflow:\s*visible/.test(CSS));
  // 应用外壳本身的行为不能被改掉
  ok('外壳仍是 overflow:hidden', /html,\s*body\s*\{[^}]*overflow:\s*hidden/.test(CSS));
}

/* ---------------------------------------------- 接线 */
group('接线：桥 + 对话框 + 偏好');
{
  ok('bridge 多传一个 themeCss', BRIDGE.indexOf('themeCss: themeCss ||') >= 0);
  ok('对话框有导出主题下拉', UI.indexOf('id="html-theme"') >= 0);
  ok('下拉里同时有内置与自定义', UI.indexOf('function themeOptionsHtml') >= 0 &&
    UI.indexOf('value="user:\' + esc(t.id)') >= 0 && UI.indexOf('BUILTIN_THEMES.forEach') >= 0);
  ok('不导出样式时把主题下拉灰掉', UI.indexOf('themeSel.disabled = !stylesBox.checked') >= 0);
  ok('偏好记住主题选择', UI.indexOf('htmlTheme:') >= 0 && UI.indexOf('pref.htmlTheme =') >= 0);
  ok('导出时把主题塞进载荷', UI.indexOf('theme: themeSel.value') >= 0);
  ok('自定义主题的 CSS 在导出前读出来', UI.indexOf('window.Bridge.readTheme(o.themeFile)') >= 0);
  ok('原生 exportHTML 走 WebExport.inject', fs.readFileSync(path.join(ROOT, 'native', 'main.swift'), 'utf8')
    .indexOf('WebExport.inject') >= 0);
  const themesFn = (fs.readFileSync(path.join(ROOT, 'native', 'main.swift'), 'utf8')
    .match(/func themesDir\(\)[\s\S]*?\n    \}/) || [''])[0];
  ok('主题目录只认 OpenTypora 的，不回退到 Typora',
    /"OpenTypora\/themes"/.test(themesFn) && !/"Typora\/themes"/.test(themesFn),
    themesFn.slice(0, 120));
}

/* ---------------------------------------------- 原生 */
group('原生字符串注入（真跑 Swift）');
{
  const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (swiftc.status !== 0) {
    skip++; console.log('  - SKIP 没有 swiftc，跳过原生部分');
  } else {
    const bin = path.join(ROOT, 'build', 'htmlthemetest');
    const srcs = [path.join(ROOT, 'native', 'webexport.swift'), path.join(ROOT, 'test', 'htmltheme', 'main.swift')];
    const stale = !fs.existsSync(bin) ||
      srcs.some(s => !fs.existsSync(s) || fs.statSync(s).mtimeMs > fs.statSync(bin).mtimeMs);
    if (stale) {
      const cc = spawnSync('swiftc', ['-O', '-o', bin, srcs[0], srcs[1]], { cwd: ROOT, encoding: 'utf8' });
      if (cc.status !== 0) {
        fail++; console.log('  ✗ 编译 htmlthemetest 失败\n' + (cc.stderr || '').slice(0, 800));
        console.log('\n✗ ' + pass + ' passed, ' + fail + ' failed');
        process.exit(1);
      }
    }
    const run = spawnSync(bin, [], { encoding: 'utf8', timeout: 120000 });
    const lines = (run.stdout || '').split('\n').filter(l => /^(PASS|FAIL) /.test(l));
    lines.forEach(l => ok('swift: ' + l.slice(5), l.startsWith('PASS')));
    const sum = /SUMMARY (\d+) (\d+)/.exec(run.stdout || '');
    ok('swift 用例数与汇总一致', !!sum && +sum[1] === lines.length,
      sum ? '汇总 ' + sum[1] + '，实际 ' + lines.length : '没有 SUMMARY');
    ok('swift 进程正常退出', run.status === 0, 'exit ' + run.status);
  }
}

console.log('\n' + (fail ? '✗ ' : '✅ ') + pass + ' passed, ' + fail + ' failed' + (skip ? '（' + skip + ' 项跳过）' : ''));
process.exit(fail ? 1 : 0);
