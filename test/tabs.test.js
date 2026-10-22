/* 标签页状态机：纯函数（tabs.js）
 *
 * 这一层只管「列表 + 当前是谁」怎么变，不碰 DOM，也不碰编辑器。
 * 真 WKWebView 里「切过去内容还在、撤销栈还在、滚动位置还在」在 tabsdom.test.js。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Tabs = require(path.join(ROOT, 'app', 'js', 'tabs.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      期望 ' + JSON.stringify(String(want)) + '\n      实际 ' + JSON.stringify(String(got))); }
}
function group(n) { console.log('\n' + n); }

function add(s, name, p) {
  return Tabs.add(s, Tabs.create(name, p));
}

/* ---------------------------------------------------------------- 基本增删 */
group('列表 · 新建与激活');

let s = Tabs.make();
eq('空状态没有活动标签', Tabs.count(s), 0);
eq('空状态 active 是 null', s.active, null);

let r = add(s, 'a.md', '/ws/a.md');
s = r.state;
eq('加一个 → 数量 1', Tabs.count(s), 1);
eq('新加的自动成为活动页', Tabs.activeTab(s).name, 'a.md');
eq('id 从 t1 开始', Tabs.activeTab(s).id, 't1');
ok('不是复用', !r.reused);

let s2 = add(s, 'b.md', '/ws/b.md').state;
eq('再加一个 → 数量 2', Tabs.count(s2), 2);
eq('活动页跟着新标签走', Tabs.activeTab(s2).name, 'b.md');
eq('顺序保持加入次序', Tabs.order(s2).join(','), 't1,t2');

eq('按路径找得到', Tabs.findByPath(s2, '/ws/a.md').id, 't1');
eq('找不到就 null', Tabs.findByPath(s2, '/ws/zzz.md'), null);
eq('按 id 找得到', Tabs.find(s2, 't2').name, 'b.md');
eq('找不存在的 id 是 null', Tabs.find(s2, 't99'), null);

/* ---------------------------------------------------------------- 同路径复用 */
group('同路径 · 不重复开');

let dup = add(s2, 'a-again.md', '/ws/a.md');
eq('同一个路径不新建', Tabs.count(dup.state), 2);
ok('标成复用', dup.reused);
eq('复用的是原来那个 id', dup.tab.id, 't1');
eq('内容/名字没被后来的覆盖', Tabs.find(dup.state, 't1').name, 'a.md');
eq('复用会切过去', dup.state.active, 't1');

// 路径里的多余斜杠归一化后再比
let dup2 = add(s2, 'a.md', '/ws//a.md');
ok('路径归一化后仍算同一个', dup2.reused && dup2.tab.id === 't1');

// 未命名（path 为 null）永远新建
let u1 = add(Tabs.make(), null, null).state;
let u2 = add(u1, null, null).state;
eq('未命名开两个 → 两个标签', Tabs.count(u2), 2);
eq('未命名第二个名字带序号', Tabs.activeTab(u2).name, '未命名 2.md');
eq('未命名第一个还是原名', Tabs.find(u2, 't1').name, '未命名.md');
let u3 = add(u2, null, null).state;
eq('未命名第三个', Tabs.activeTab(u3).name, '未命名 3.md');
eq('untitled() 算下一个可用名', Tabs.untitled(u3), '未命名 4.md');
eq('有文件的同名不算冲突', Tabs.untitled(add(Tabs.make(), '未命名.md', '/ws/未命名.md').state), '未命名.md');

/* ---------------------------------------------------------------- 关闭 */
group('关闭 · 关掉之后激活谁');

// 三个标签，活动在中间
let t3 = add(add(add(Tabs.make(), 'a.md', '/ws/a.md').state, 'b.md', '/ws/b.md').state, 'c.md', '/ws/c.md').state;
t3 = Tabs.activate(t3, 't2');
eq('活动在中间', Tabs.activeTab(t3).name, 'b.md');

let c1 = Tabs.close(t3, 't2');
eq('关掉中间 → 剩 2 个', Tabs.count(c1.state), 2);
eq('关掉中间 → 激活右边那个', c1.nextId, 't3');
ok('标成「关的是活动页」', c1.closedActive);
eq('关掉的那个还回来了', c1.tab.name, 'b.md');

let c2 = Tabs.close(add(add(Tabs.make(), 'a.md', '/ws/a.md').state, 'b.md', '/ws/b.md').state, 't2');
eq('关最后一个 → 激活左边', c2.nextId, 't1');

let c3 = Tabs.close(add(Tabs.make(), 'a.md', '/ws/a.md').state, 't1');
eq('只剩一个时关掉 → active 变 null', c3.nextId, null);
eq('列表也空了', Tabs.count(c3.state), 0);

let c4 = Tabs.close(t3, 't1');
eq('关非活动页 → 活动页不动', c4.state.active, 't2');
ok('标成「关的不是活动页」', !c4.closedActive);
eq('关非活动页 → 数量 -1', Tabs.count(c4.state), 2);

let c5 = Tabs.close(t3, 'nope');
eq('关不存在的 id → 什么都没变', Tabs.count(c5.state), 3);
eq('关不存在的 id → 返回 null', c5.tab, null);

/* ---------------------------------------------------------------- 切换 */
group('切换 · 循环');

eq('下一个：t1 → t2', Tabs.cycle(Tabs.activate(t3, 't1'), 1).active, 't2');
eq('下一个到头绕回', Tabs.cycle(Tabs.activate(t3, 't3'), 1).active, 't1');
eq('上一个绕回', Tabs.cycle(Tabs.activate(t3, 't1'), -1).active, 't3');
eq('只有一个标签时不动', Tabs.cycle(add(Tabs.make(), 'a.md', '/ws/a.md').state, 1).active, 't1');
eq('空列表不炸', Tabs.cycle(Tabs.make(), 1).active, null);

/* ---------------------------------------------------------------- 改字段 */
group('patch · 只动一个');

let p = Tabs.patch(t3, 't2', { dirty: true, name: 'b2.md' });
eq('改过的值生效', Tabs.find(p, 't2').name, 'b2.md');
ok('脏标记生效', Tabs.find(p, 't2').dirty === true);
eq('别的不受影响', Tabs.find(p, 't1').name, 'a.md');
eq('活动页不变', p.active, 't2');
ok('不改入参', Tabs.find(t3, 't2').name === 'b.md');

let pa = Tabs.patchAll(t3, { dirty: false });
eq('patchAll 全清脏', pa.list.filter(x => x.dirty).length, 0);
ok('patchAll 不改入参', t3.list.filter(x => x.dirty).length === 0);

let pmiss = Tabs.patch(t3, 'nope', { dirty: true });
eq('patch 不存在的 id → 原样返回', Tabs.count(pmiss), 3);

/* ---------------------------------------------------------------- 上限 */
group('上限 · 24 个');

let many = Tabs.make();
for (let i = 0; i < Tabs.MAX; i++) many = add(many, 'f' + i + '.md', '/ws/f' + i + '.md').state;
eq('到上限了', Tabs.count(many), Tabs.MAX);
let over = add(many, 'x.md', '/ws/x.md');
ok('超上限被拒', over.full);
eq('超上限时状态不变', Tabs.count(over.state), Tabs.MAX);
eq('超上限时不返回标签', over.tab, null);
let overDup = add(many, 'again', '/ws/f3.md');
ok('满了也还能切到已有的', overDup.reused && overDup.tab.id === Tabs.findByPath(many, '/ws/f3.md').id);

/* ---------------------------------------------------------------- 显示 */
group('显示 · 名字与圆点');

eq('label 用名字', Tabs.label({ name: 'x.md' }), 'x.md');
eq('label 兜底', Tabs.label({}), '未命名.md');
eq('不脏就没有圆点', Tabs.title({ name: 'x.md' }), 'x.md');
eq('脏了前面带圆点', Tabs.title({ name: 'x.md', dirty: true }), '● x.md');
eq('baseName 取最后一段', Tabs.baseName('/a/b/c.md'), 'c.md');
eq('baseName 空值', Tabs.baseName(null), '');
eq('create 用路径推名字', Tabs.create(null, '/x/y/z.md').name, 'z.md');
eq('create 归一化路径', Tabs.create(null, '/x//y.md').path, '/x/y.md');
eq('paths 只列有文件的', Tabs.paths(t3).join(','), '/ws/a.md,/ws/b.md,/ws/c.md');
eq('paths 跳过未命名', Tabs.paths(add(Tabs.make(), null, null).state).length, 0);

/* ---------------------------------------------------------------- 会话 */
group('会话 · 存盘形状（只认有落点的标签）');

eq('空状态没有 path', Tabs.sessionOf(Tabs.make()).paths.length, 0);
eq('版本号跟着写进去', Tabs.sessionOf(Tabs.make()).v, Tabs.SESSION_VERSION);

let sv = add(add(add(Tabs.make(), 'a.md', '/ws/a.md').state, '未命名.md', null).state, 'b.md', '/ws/b.md').state;
let sess = Tabs.sessionOf(sv);
eq('未命名标签不进去', sess.paths.join(','), '/ws/a.md,/ws/b.md');
eq('active 记活动标签的 path', sess.active, '/ws/b.md');
Tabs.activate(sv, Tabs.findByPath(sv, '/ws/a.md').id);
eq('切走之后 active 跟着变', Tabs.sessionOf(Tabs.activate(sv, Tabs.findByPath(sv, '/ws/a.md').id)).active, '/ws/a.md');

let onlyUntitled = add(Tabs.make(), '未命名.md', null).state;
eq('只有未命名 → paths 空', Tabs.sessionOf(onlyUntitled).paths.length, 0);
eq('未命名在活动页 → active 是 null', Tabs.sessionOf(onlyUntitled).active, null);

// 手工构造重复（正常流程进不来，防的是外部改过的 localStorage）
let dupState = { list: [
  { id: 't1', path: '/ws/a.md', name: 'a.md', dirty: false, doc: null },
  { id: 't2', path: '/ws//a.md', name: 'a.md', dirty: false, doc: null },
  { id: 't3', path: '/ws/b.md', name: 'b.md', dirty: false, doc: null }
], active: 't3', seq: 3 };
eq('重复 path 只留一条', Tabs.sessionOf(dupState).paths.join(','), '/ws/a.md,/ws/b.md');

let many2 = Tabs.make();
for (let k = 1; k <= Tabs.MAX + 6; k++) many2 = Tabs.add(many2, Tabs.create('f' + k + '.md', '/ws/f' + k + '.md')).state;
eq('超过上限就截断', Tabs.sessionOf(many2).paths.length, Tabs.MAX);

let sessBefore = JSON.stringify(sv);
Tabs.sessionOf(sv);
eq('sessionOf 不改入参', JSON.stringify(sv), sessBefore);

group('会话 · 读回（坏一条丢一条）');

eq('空串当没有', Tabs.parseSession(''), null);
eq('坏 JSON 当没有', Tabs.parseSession('{oops'), null);
eq('不是对象当没有', Tabs.parseSession('[]'), null);
eq('没有 paths 当没有', Tabs.parseSession('{"v":1}'), null);
eq('paths 不是数组当没有', Tabs.parseSession('{"paths":"a"}'), null);
eq('全被丢掉就返回 null', Tabs.parseSession('{"paths":["rel/a.md", 3]}'), null);

let ps = Tabs.parseSession('{"v":1,"paths":["/ws/a.md","/ws/b.md"],"active":"/ws/a.md"}');
eq('正常读回路径', ps.paths.join(','), '/ws/a.md,/ws/b.md');
eq('正常读回活动页', ps.active, '/ws/a.md');
eq('顺带把对象喂进去也认', Tabs.parseSession({ paths: ['/ws/x.md'] }).paths.join(','), '/ws/x.md');

eq('active 不在列表里 → 落到第一个', Tabs.parseSession('{"paths":["/ws/a.md","/ws/b.md"],"active":"/ws/zz.md"}').active, '/ws/a.md');
eq('没有 active → 第一个', Tabs.parseSession('{"paths":["/ws/a.md","/ws/b.md"]}').active, '/ws/a.md');

let rel = Tabs.parseSession('{"paths":["/ws/a.md","rel/b.md","./c.md"],"active":"/ws/a.md"}');
eq('相对路径被丢掉', rel.paths.join(','), '/ws/a.md');
eq('丢了几条也报出来', rel.dropped, 2);

eq('重复路径去重', Tabs.parseSession('{"paths":["/ws/a.md","/ws//a.md"]}').paths.length, 1);
eq('非字符串项丢掉', Tabs.parseSession('{"paths":["/ws/a.md",null,7]}').paths.length, 1);
eq('读回也守 24 上限', Tabs.parseSession(JSON.stringify({ paths: many2.list.map(t => t.path) })).paths.length, Tabs.MAX);
eq('`//` 会归一化', Tabs.parseSession('{"paths":["/ws//a.md"]}').paths[0], '/ws/a.md');

let back = Tabs.parseSession(JSON.stringify(Tabs.sessionOf(sv)));
eq('存 → 读往返一致', back.paths.join(','), '/ws/a.md,/ws/b.md');
eq('往返后 active 也一致', back.active, Tabs.activeTab(sv).path);

/* ---------------------------------------------------------------- 不可变 */
group('不可变 · 都不改入参');

let base = add(add(Tabs.make(), 'a.md', '/ws/a.md').state, 'b.md', '/ws/b.md').state;
let before = JSON.stringify(base);
Tabs.add(base, Tabs.create('c.md', '/ws/c.md'));
Tabs.activate(base, 't1');
Tabs.close(base, 't1');
Tabs.patch(base, 't1', { dirty: true });
Tabs.cycle(base, 1);
eq('一通操作之后原状态没变', JSON.stringify(base), before);

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
