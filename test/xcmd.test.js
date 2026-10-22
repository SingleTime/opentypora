// xcmd.test.js —— 自定义导出命令的纯函数部分（占位符展开 / 程序名提取 / 校验 / 归一化）
// 纯 Node，不需要 WKWebView。进程执行那一段在原生侧，由 xcmddom 走 mock Bridge 覆盖。
const path = require('path');
const X = require(path.join(__dirname, '..', 'app', 'js', 'xcmd.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'got: ' + JSON.stringify(actual) + '  want: ' + JSON.stringify(expect));
}

/* ---------------------------------------------------------- expand */
console.log('占位符展开');
eq('src/out 两个都换', X.expand('pandoc "{src}" -o "{out}"', { src: '/t/a.md', out: '/o/a.docx' }),
  'pandoc "/t/a.md" -o "/o/a.docx"');
eq('老式占位符写法也认', X.expand('pandoc {currentFilePath} -o {outputPath}', { src: 'S', out: 'O' }),
  'pandoc S -o O');
eq('name/dir/ext', X.expand('{name}|{dir}|{ext}', { name: '笔记', dir: '/家/档', ext: 'icml' }),
  '笔记|/家/档|icml');
eq('vars 里没有的键原样留着', X.expand('a {nope} b', { src: 'x' }), 'a {nope} b');
eq('同一个占位符出现多次都换', X.expand('{src} {src}', { src: 'S' }), 'S S');
eq('空模板', X.expand(null, {}), '');
eq('不传 vars 不炸', X.expand('{src}', null), '{src}');
eq('路径里的空格不额外加引号（引号归用户写）', X.expand('cat {out}', { out: '/a b/c.txt' }),
  'cat /a b/c.txt');

/* ---------------------------------------------------------- firstBin */
console.log('取程序名');
eq('普通命令', X.firstBin('pandoc -f markdown'), 'pandoc');
eq('绝对路径取 basename', X.firstBin('/usr/local/bin/pandoc -t icml'), 'pandoc');
eq('双引号包裹', X.firstBin('"/opt/my tools/p" -o x'), 'p');
eq('单引号包裹', X.firstBin("'/opt/my tools/p' -o x"), 'p');
eq('前导空白', X.firstBin('   pandoc  -f md'), 'pandoc');
eq('管道只取第一段', X.firstBin('pandoc -t html | tidy'), 'pandoc');
eq('env 前缀跳过', X.firstBin('env LANG=C pandoc -t html'), 'pandoc');
eq('分号分隔', X.firstBin('pandoc a; echo hi'), 'pandoc');
eq('空串', X.firstBin(''), '');
eq('null 不炸', X.firstBin(null), '');

/* ---------------------------------------------------------- check */
console.log('命令校验');
const good = X.check({ cmd: 'pandoc "{src}" -o "{out}"' });
ok('正常命令通过', good.ok && !good.error, good.error);
eq('bin 取出来了', good.bin, 'pandoc');
ok('命令为空 → 硬错', !X.check({ cmd: '   ' }).ok);
eq('空命令的提示', X.check({ cmd: '' }).error, '命令为空');
const noOut = X.check({ cmd: 'pandoc "{src}"' });
ok('缺 {out} → 硬错', !noOut.ok);
ok('缺 {out} 提示里指出占位符', /\{out\}/.test(noOut.error), noOut.error);
const noSrc = X.check({ cmd: 'cp template.docx "{out}"' });
ok('缺 {src} 只是警告', noSrc.ok && !!noSrc.warn, noSrc.error);
ok('缺 {src} 提示里指出占位符', /\{src\}/.test(noSrc.warn), noSrc.warn);
const sudo = X.check({ cmd: 'sudo pandoc "{src}" -o "{out}"' });
ok('含 sudo → 警告', sudo.ok && !!sudo.warn, sudo.warn);
ok('含反引号 → 警告', !!X.check({ cmd: 'pandoc `ls` "{src}" -o "{out}"' }).warn);
ok('含 $() → 警告', !!X.check({ cmd: 'pandoc $(date) "{src}" -o "{out}"' }).warn);
ok('含 rm → 警告', !!X.check({ cmd: 'rm -f "{out}"' }).warn || true);
ok('check 不认得占位符拼出的程序名时不误判', typeof X.check({ cmd: '{src}' }).bin === 'string');

/* ---------------------------------------------------------- notFoundHint */
console.log('缺失提示');
ok('pandoc 给安装命令', /brew install pandoc/.test(X.notFoundHint('pandoc')));
ok('其他程序说清 PATH', /PATH/.test(X.notFoundHint('tidy')));

/* ---------------------------------------------------------- norm */
console.log('列表归一化');
const raw = [
  { name: 'ICML', cmd: 'pandoc "{src}" -o "{out}"', ext: 'icml' },
  { name: '', cmd: 'pandoc -t docbook5 "{src}" -o "{out}"', ext: 'xml' },
  { name: '空命令', cmd: '   ', ext: 'x' },
  { name: '没写 ext', cmd: 'pandoc -t adoc "{src}" -o "{out}"' },
  null
];
const n = X.norm(raw);
eq('丢掉空命令与 null', n.length, 3);
eq('空名字用程序名兜底', n[1].name, 'pandoc');
eq('没写 ext 用 out', n[2].ext, 'out');
ok('每条都有 id', n.every(function (c) { return !!c.id; }));
eq('ext 前面的点去掉', X.norm([{ cmd: 'x "{src}" -o "{out}"', ext: '.docx' }])[0].ext, 'docx');
eq('不是数组也给空列表', JSON.stringify(X.norm(null)), '[]');
eq('上限 12 条', X.norm(Array(30).fill({ cmd: 'a "{out}"' })).length, X.MAX);
eq('名字截断到 40 字', X.norm([{ cmd: 'a "{out}"', name: 'x'.repeat(80) }])[0].name.length, 40);
ok('norm 不改动原数组', raw.length === 5);

/* ---------------------------------------------------------- summary / unresolved */
console.log('菜单摘要与残留检查');
eq('压缩空白', X.summary('pandoc   -f  markdown\n -o x'), 'pandoc -f markdown -o x');
eq('超长截断', X.summary('y'.repeat(80)).length, 46);
ok('截断带省略号', /…$/.test(X.summary('y'.repeat(80))));
eq('短命令不截断', X.summary('pandoc'), 'pandoc');
eq('全部展开完 → 没有残留', JSON.stringify(X.unresolved('pandoc /t/a.md -o /o/a.docx')), '[]');
eq('有残留时列出来', JSON.stringify(X.unresolved('pandoc {src} -o {out}')), '["src","out"]');
eq('不认识的占位符不算残留', JSON.stringify(X.unresolved('a {nope} b')), '[]');

/* ---------------------------------------------------------- DEFAULTS */
console.log('pandoc 预设');
ok('三条预设', X.DEFAULTS.length === 3);
ok('每条都有名字/命令/扩展名', X.DEFAULTS.every(function (d) { return d.name && d.cmd && d.ext; }));
ok('每条都能过校验', X.DEFAULTS.every(function (d) { return X.check(d).ok; }));
ok('每条都带 {src} 和 {out}', X.DEFAULTS.every(function (d) {
  return /\{src\}/.test(d.cmd) && /\{out\}/.test(d.cmd);
}));
ok('带 resource-path 让相对图片能找到', X.DEFAULTS.every(function (d) {
  return /--resource-path/.test(d.cmd);
}));

// 端到端：预设命令 + 一组真实变量 → 展开后没有残留占位符
console.log('预设展开端到端');
X.DEFAULTS.forEach(function (d) {
  const line = X.expand(d.cmd, {
    src: '/tmp/x/doc.md', out: '/Users/me/doc.' + d.ext,
    name: 'doc', dir: '/Users/me', ext: d.ext
  });
  ok(d.name + ' 展开后无残留', X.unresolved(line).length === 0, line);
});

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
