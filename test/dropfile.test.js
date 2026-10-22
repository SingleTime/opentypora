// dropfile.test.js —— 拖文件插入链接的纯函数：路径解析 / 插入计划 / 链接转义
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'app/js/dropfile.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function dt(payload) {
  return { getData: function (t) { return payload[t] == null ? '' : payload[t]; } };
}

console.log('pathsFrom：从 dataTransfer 捞绝对路径');
{
  const a = D.pathsFrom(dt({ 'text/uri-list': 'file:///Users/fw/notes/a.md' }));
  eq('uri-list 的 file:// 被剥掉并解码', a['a.md'], '/Users/fw/notes/a.md');

  const b = D.pathsFrom(dt({ 'text/uri-list': 'file:///Users/fw/%E7%AC%94%E8%AE%B0.md' }));
  ok('百分号编码被解码', !!b['笔记.md'], JSON.stringify(Object.keys(b)));

  const c = D.pathsFrom(dt({ 'text/plain': '/tmp/x/y.md' }));
  eq('text/plain 里的裸路径也认', c['y.md'], '/tmp/x/y.md');

  const d = D.pathsFrom(dt({ 'text/uri-list': 'file:///a/1.md\r\nfile:///b/2.md' }));
  eq('多行 uri-list 全部收下', Object.keys(d).length, 2);
  eq('多行里第一条', d['1.md'], '/a/1.md');

  eq('http 链接不算路径', Object.keys(D.pathsFrom(dt({ 'text/plain': 'https://x.com/a.md' }))).length, 0);
  eq('相对路径不算路径', Object.keys(D.pathsFrom(dt({ 'text/plain': 'notes/a.md' }))).length, 0);
  eq('目录（结尾斜杠）丢掉', Object.keys(D.pathsFrom(dt({ 'text/uri-list': 'file:///Users/fw/notes/' }))).length, 0);
  eq('别处同名不覆盖第一份',
    D.pathsFrom(dt({ 'text/uri-list': 'file:///a/a.md\nfile:///b/a.md' }))['a.md'], '/a/a.md');
  eq('没有 dataTransfer 时返回空表', Object.keys(D.pathsFrom(null)).length, 0);
  eq('getData 抛错也不炸',
    Object.keys(D.pathsFrom({ getData: function () { throw new Error('x'); } })).length, 0);
  eq('同一条路径出现两次只留一份（按文件名去重）',
    Object.keys(D.pathsFrom(dt({ 'text/uri-list': 'file:///a/a.md', 'text/plain': '/a/a.md' }))).length, 1);
}

console.log('plan：决定链接目标');
{
  const rel = function (from, to) { return to.replace(from + '/', ''); };

  eq('有路径 + 有文档目录 + 有 rel 函数 → 相对',
    D.plan({ name: 'a.md', path: '/ws/n/a.md', docDir: '/ws', rel: rel }).kind, 'rel');
  eq('相对路径的值来自注入的 rel 函数',
    D.plan({ name: 'a.md', path: '/ws/n/a.md', docDir: '/ws', rel: rel }).target, 'n/a.md');
  eq('有路径但没 rel 函数 → 绝对',
    D.plan({ name: 'a.md', path: '/ws/a.md', docDir: '/ws' }).kind, 'abs');
  eq('有路径但文档还没存过 → 绝对',
    D.plan({ name: 'a.md', path: '/ws/a.md', docDir: '', rel: rel }).kind, 'abs');
  eq('没路径但有文本 + 可落盘 → 复制',
    D.plan({ name: 'a.md', text: 'x', docDir: '/ws', canCopy: true }).kind, 'copy');
  eq('没路径且不能落盘 → 只有文件名',
    D.plan({ name: 'a.md', text: 'x', docDir: '/ws', canCopy: false }).kind, 'name');
  eq('二进制文件（没有文本）→ 只有文件名',
    D.plan({ name: 'a.pdf', text: null, docDir: '/ws', canCopy: true }).kind, 'name');
  eq('没有文档目录时即便有文本也复制不了',
    D.plan({ name: 'a.md', text: 'x', docDir: '', canCopy: true }).kind, 'name');
  eq('空参数不抛错', D.plan().kind, 'name');
}

console.log('linkText：Markdown 链接转义');
{
  eq('普通文件名', D.linkText('a.md', 'a.md'), '[a.md](a.md)');
  eq('空格转 %20', D.linkText('my note.md', 'my note.md'), '[my note.md](my%20note.md)');
  eq('圆括号转义（否则链接会提前闭合）',
    D.linkText('a(1).md', 'a(1).md'), '[a(1).md](a%281%29.md)');
  eq('中文原样保留', D.linkText('笔记.md', '笔记.md'), '[笔记.md](笔记.md)');
  eq('方括号在标签里转义', D.linkText('a[b].md', 'x.md'), '[a\\[b\\].md](x.md)');
  eq('相对目录', D.linkText('a.md', 'notes/a.md'), '[a.md](notes/a.md)');
  eq('null 目标为空', D.linkText('a.md', null), '[a.md]()');
  eq('null 名字为空标签', D.linkText(null, 'x'), '[](x)');
}

console.log('isImage');
{
  ok('image/png 认', D.isImage({ type: 'image/png' }) === true);
  ok('text/markdown 不认', D.isImage({ type: 'text/markdown' }) === false);
  ok('没有 type 不认', D.isImage({}) === false);
  ok('null 不抛错', D.isImage(null) === false);
}

console.log('\n' + (fail ? '✗ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
