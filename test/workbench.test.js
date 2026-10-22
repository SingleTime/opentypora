// workbench.test.js —— 工作区纯函数：模糊匹配 / 文章分组 / 相对路径 / 时间格式
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'app/js/workbench.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

console.log('模糊匹配');
{
  ok('空 query 全匹配', W.fuzzyScore('', 'anything') > 0);
  ok('子序列命中', W.fuzzyScore('ab', 'axbxx') > 0);
  ok('连续命中优于分散', W.fuzzyScore('ab', 'abxxx') > W.fuzzyScore('ab', 'axbxx'));
  ok('词首加分', W.fuzzyScore('gm', 'github.md') > W.fuzzyScore('gm', 'xxgxxm'));
  ok('缺字符不匹配', W.fuzzyScore('abc', 'acb') === 0);
  ok('大小写不敏感', W.fuzzyScore('ABC', 'aBc') > 0);
  ok('中文按字匹配', W.fuzzyScore('笔记', '我的笔记.md') > 0);
}

console.log('文章分组');
{
  const list = [
    { name: 'b.md', folder: 'x', mtime: 10, size: 5 },
    { name: 'a.md', folder: '', mtime: 30, size: 1 },
    { name: 'c.md', folder: 'x', mtime: 20, size: 9 }
  ];
  const byTime = W.groupArticles(list, 'none', 'mtime');
  eq('不分组只有一组', byTime.length, 1);
  eq('按时间倒序', byTime[0].items.map(function (n) { return n.name; }).join(','), 'a.md,c.md,b.md');
  const byName = W.groupArticles(list, 'none', 'name');
  eq('按名称', byName[0].items.map(function (n) { return n.name; }).join(','), 'a.md,b.md,c.md');
  const bySize = W.groupArticles(list, 'none', 'size');
  eq('按大小', bySize[0].items.map(function (n) { return n.name; }).join(','), 'c.md,b.md,a.md');
  const grouped = W.groupArticles(list, 'folder', 'name');
  ok('按文件夹分组', grouped.length === 2, JSON.stringify(grouped.map(function (g) { return g.folder; })));
  eq('根目录组名', grouped[0].folder, '（根目录）');
}

console.log('相对链接解析');
{
  eq('同目录', W.resolveLink('a.md', '/d/note.md', '/d'), '/d/a.md');
  eq('上一级', W.resolveLink('../a.md', '/d/sub/note.md', '/d'), '/d/a.md');
  eq('多级回退', W.resolveLink('../../x/y.md', '/a/b/c/n.md', '/a'), '/a/x/y.md');
  eq('带锚点', W.resolveLink('a.md#sec', '/d/note.md', '/d'), '/d/a.md');
  eq('绝对路径', W.resolveLink('/tmp/a.md', '/d/n.md', '/d'), '/tmp/a.md');
  eq('外链不处理', W.resolveLink('https://x.com/a.md', '/d/n.md', '/d'), '');
  eq('无当前文件时用根', W.resolveLink('a.md', null, '/d'), '/d/a.md');
  eq('当前目录', W.resolveLink('./a.md', '/d/n.md', '/d'), '/d/a.md');
}

console.log('最近时间格式');
{
  eq('刚刚', W.timeAgo(Date.now()), '刚刚');
  eq('分钟', W.timeAgo(Date.now() - 5 * 60 * 1000), '5 分钟前');
  eq('小时', W.timeAgo(Date.now() - 3 * 3600 * 1000), '3 小时前');
  ok('天', W.timeAgo(Date.now() - 5 * 86400 * 1000) === '5 天前');
}

console.log('最近文件：固定到列表');
{
  const base = [
    { path: '/a.md', name: 'a.md', ts: 300 },
    { path: '/b.md', name: 'b.md', ts: 200 },
    { path: '/c.md', name: 'c.md', ts: 100 }
  ];
  const paths = function (arr) { return arr.map(function (x) { return x.path; }).join(','); };

  eq('默认按时间倒序', paths(W.sortedRecent(base)), '/a.md,/b.md,/c.md');
  eq('固定后置顶', paths(W.sortedRecent(W.togglePinned(base, '/c.md', 1000))), '/c.md,/a.md,/b.md');
  eq('固定时间更晚的排更前',
    paths(W.sortedRecent(W.togglePinned(W.togglePinned(base, '/b.md', 1000), '/c.md', 2000))),
    '/c.md,/b.md,/a.md');
  eq('再点一次取消固定', W.isPinned(W.togglePinned(W.togglePinned(base, '/c.md', 1), '/c.md', 2), '/c.md'), false);
  eq('取消固定后回到时间序', paths(W.togglePinned(W.togglePinned(base, '/c.md', 1), '/c.md', 2)),
    '/a.md,/b.md,/c.md');
  eq('不在列表里的路径不会凭空加入', W.togglePinned(base, '/zzz.md', 1).length, 3);

  // 老数据没有 pinned 字段也要能读
  const legacy = [{ path: '/x.md', name: 'x.md', ts: 5 }];
  eq('老数据补默认字段', JSON.stringify(W.normRecent(legacy)),
    JSON.stringify([{ path: '/x.md', name: 'x.md', ts: 5, pinned: false, pinTs: 0 }]));
  eq('重复路径去重', W.normRecent([{ path: '/x.md', ts: 1 }, { path: '/x.md', ts: 9 }]).length, 1);
  eq('没有 path 的条目丢掉', W.normRecent([{ name: 'n' }, { path: '/y.md' }]).length, 1);

  // 上限只淘汰未固定的
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ path: '/n' + i + '.md', name: 'n' + i + '.md', ts: 1000 - i });
  many[39].pinned = true; many[39].pinTs = 1;
  const capped = W.capRecent(many);
  eq('封顶 30 条', capped.length, 30);
  eq('固定项没被淘汰', W.isPinned(capped, '/n39.md'), true);
  eq('固定项在第一位', capped[0].path, '/n39.md');
  ok('未固定的按时间取前 29', capped[1].path === '/n0.md');

  // 打开已固定文件：保留固定状态、时间戳刷新
  const afterTouch = W.touchRecent(W.togglePinned(base, '/c.md', 500), '/c.md', 'c.md', 9999);
  eq('重新打开后仍然固定', W.isPinned(afterTouch, '/c.md'), true);
  eq('重新打开刷新时间', afterTouch.filter(function (x) { return x.path === '/c.md'; })[0].ts, 9999);
  eq('重新打开后仍置顶', afterTouch[0].path, '/c.md');
  eq('touch 不产生重复', afterTouch.length, 3);
  eq('touch 一个全新文件', W.touchRecent(base, '/d.md', 'd.md', 400)[0].path, '/d.md');
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
