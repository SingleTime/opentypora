// flow.test.js —— 第七轮：flowchart.js 图表渲染（解析 / 布局 / SVG）
// 纯 Node，不需要 WKWebView。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Flow = require(path.join(ROOT, 'app/js/flow.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'got: ' + JSON.stringify(actual) + '  want: ' + JSON.stringify(expect));
}
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + '  → 没抛错'); }
  catch (e) {
    if (!re || re.test(String(e.message))) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + e.message); }
  }
}

const BASIC = [
  'st=>start: 开始',
  'op=>operation: 处理数据',
  'cond=>condition: 是否通过?',
  'io=>inputoutput: 写入结果',
  'sub=>subroutine: 子流程',
  'e=>end: 结束',
  '',
  'st->op->cond',
  'cond(yes)->io->e',
  'cond(no)->op',
  'io->sub'
].join('\n');

/* ============================================================ 解析 */
console.log('flowchart：解析');
const g = Flow.parse(BASIC);
eq('节点数', g.order.length, 6);
eq('边数', g.edges.length, 6);
eq('st 形状', g.nodes.st.shape, 'start');
eq('cond 形状', g.nodes.cond.shape, 'condition');
eq('sub 形状', g.nodes.sub.shape, 'subroutine');
eq('标签保留', g.nodes.op.label, '处理数据');
eq('链式边拆开', g.edges.filter(e => e.from === 'st' || e.to === 'op').length, 2);
eq('(yes) 分支标签', g.edges.filter(e => e.from === 'cond' && e.label === 'yes').length, 1);
eq('无标签边 label 为 null', g.edges[0].label, null);
eq('声明序保持', g.order[0], 'st');

console.log('flowchart：解析错误');
throws('未知类型', () => Flow.parse('a=>weird: x'), /未知节点类型/);
throws('重复声明', () => Flow.parse('a=>start: 1\na=>end: 2'), /重复声明/);
throws('边引用未定义节点', () => Flow.parse('a=>start: 1\na->ghost'), /未定义的节点「ghost」/);
throws('完全无法解析的行', () => Flow.parse('这是一段中文'), /无法解析/);
throws('空图', () => Flow.parse(''), /没有节点/);
throws('只有空行', () => Flow.parse('\n\n  \n'), /没有节点/);

console.log('flowchart：边标签写法');
const g2 = Flow.parse('a=>start: A\nb=>end: B\na:是->b');
eq('冒号标签', g2.edges[0].label, '是');
const g3 = Flow.parse('a=>start: A\nb=>end: B\na(|管道|)->b');
eq('管道标签', g3.edges[0].label, '管道');
const g4 = Flow.parse('a=>start: A\nb=>end: B\nc=>end: C\na->b->c');
eq('三链拆成两边', g4.edges.length, 2);
eq('中间节点既入又出', g4.edges.filter(e => e.to === 'b' || e.from === 'b').length, 2);

console.log('flowchart：标签缺省与空白');
const g5 = Flow.parse('a=>start\nb=>end');
eq('缺省标签用 id', g5.nodes.a.label, 'a');
eq('标签去除首尾空白', Flow.parse('a=>operation:   前后空白  ').nodes.a.label, '前后空白');

/* ============================================================ 布局 */
console.log('flowchart：布局');
const m = Flow.layout(g);
eq('层数', m.maxLayer + 1, 5);           // st(0) op(1) cond(2) io(3) / sub、e(4/3)
eq('st 在第 0 层', m.layer.st, 0);
eq('cond 在第 2 层', m.layer.cond, 2);
eq('sub 在 io 之后一层', m.layer.sub > m.layer.io, true);
ok('st 在 cond 上方', m.pos.st.y < m.pos.cond.y);
ok('宽度为正', m.width > 100);
ok('高度为正', m.height > 100);
ok('节点不越界', Object.keys(m.pos).every(k =>
  m.pos[k].x >= 0 && m.pos[k].y >= 0 &&
  m.pos[k].x + m.size[k].w <= m.width && m.pos[k].y + m.size[k].h <= m.height));
// 同层节点水平不重叠
(function () {
  var byL = {};
  m.order.forEach(n => { (byL[m.layer[n]] || (byL[m.layer[n]] = [])).push(n); });
  var bad = [];
  for (var L in byL) {
    var list = byL[L].sort((a, b) => m.pos[a].x - m.pos[b].x);
    for (var i = 1; i < list.length; i++) {
      if (m.pos[list[i]].x < m.pos[list[i - 1]].x + m.size[list[i - 1]].w) bad.push(L + ':' + list[i - 1] + '/' + list[i]);
    }
  }
  ok('同层节点不重叠', bad.length === 0, bad.join(','));
})();
// 菱形比矩形宽（同标签）
var mCond = Flow.layout(Flow.parse('a=>condition: 一样长的标签文字'));
var mOp = Flow.layout(Flow.parse('a=>operation: 一样长的标签文字'));
ok('菱形更宽', mCond.size.a.w > mOp.size.a.w, mCond.size.a.w + ' vs ' + mOp.size.a.w);

console.log('flowchart：环不死循环');
const cyc = Flow.parse('a=>start: A\nb=>operation: B\nc=>operation: C\na->b->c->a');
const mc = Flow.layout(cyc);
ok('环有分层', mc.maxLayer >= 0 && isFinite(mc.width) && isFinite(mc.height));

console.log('flowchart：孤立节点');
const iso = Flow.parse('a=>start: A\nb=>end: B');
const mi = Flow.layout(iso);
eq('孤立节点同层', mi.layer.a === mi.layer.b, true);
ok('孤立节点水平排开', mi.pos.b.x > mi.pos.a.x + mi.size.a.w);

console.log('flowchart：长标签换行');
const long = Flow.layout(Flow.parse('a=>operation: 这是一个特别特别特别特别特别特别特别长的中文标签需要自动换行处理'));
ok('长标签折成多行', long.size.a.lines.length > 1, long.size.a.lines.join('/'));
ok('折行后不超宽', long.size.a.w <= 220, String(long.size.a.w));
eq('显式 \\n 折行', Flow.layout(Flow.parse('a=>operation: 上\\n下')).size.a.lines.join('|'), '上|下');

/* ============================================================ SVG */
console.log('flowchart：SVG 输出');
const s = Flow.svg(BASIC);
ok('是 svg', /^<svg xmlns/.test(s));
ok('有 viewBox', /viewBox="0 0 \d+ \d+"/.test(s));
ok('有箭头 marker', /id="flow-arrow"/.test(s));
ok('起止节点是圆角矩形', /rx="\d+(\.\d+)?"[^>]*\/>/.test(s) || /rx="22"/.test(s));
ok('菱形用 polygon', /<polygon/.test(s));
ok('平行四边形用 polygon', (s.match(/<polygon/g) || []).length >= 2);
ok('子流程有双侧线', (s.match(/<line/g) || []).length >= 2);
ok('边是 path', /<path d="M[\d.,\sL]+"/.test(s));
ok('边标签有文字', s.indexOf('>yes<') > 0);
ok('中文正常输出', s.indexOf('处理数据') > 0);
ok('深色配色可切', Flow.svg(BASIC, { dark: true }).indexOf('#161b22') > 0);
ok('浅色配色默认', s.indexOf('#ffffff') > 0);
throws('SVG 也校验语法', () => Flow.svg('坏行'), /无法解析/);

console.log('flowchart：SVG 转义');
const esc1 = Flow.svg('a=>operation: <script>&"\'');
ok('尖括号被转义', esc1.indexOf('<script>') < 0 && esc1.indexOf('&lt;script&gt;') > 0);
ok('引号被转义', esc1.indexOf('&quot;') > 0);

console.log('flowchart：缓存');
const c1 = Flow.svg('a=>start: 缓存');
const c2 = Flow.svg('a=>start: 缓存');
eq('同源同输出', c1, c2);

/* ============================================================ 边走线不变量 */
console.log('flowchart：走线不变量');
const ROUTE_DOC = [
  'st=>start: 开始',
  'input=>inputoutput: 读取输入',
  'op=>operation: 处理数据',
  'cond=>condition: 校验通过?',
  'fix=>operation: 记录错误',
  'sub=>subroutine: 调用子流程',
  'io=>inputoutput: 写入结果',
  'e=>end: 结束',
  'st->input->op->cond',
  'cond(yes)->sub->io->e',
  'cond(no)->fix',
  'fix->input'
].join('\n');
const rm = Flow.layout(Flow.parse(ROUTE_DOC));
eq('回边存在', rm.routes.filter(r => rm.layer[r.to] < rm.layer[r.from]).length, 1);

// 水平/垂直线段不得穿过任何节点内部（端点贴边不算）
function segHits(p1, p2, r) {
  if (p1[1] === p2[1]) {
    var y = p1[1], x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
    return y > r.y + 1 && y < r.y + r.h - 1 && x1 > r.x + 1 && x0 < r.x + r.w - 1;
  }
  if (p1[0] === p2[0]) {
    var x = p1[0], y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
    return x > r.x + 1 && x < r.x + r.w - 1 && y1 > r.y + 1 && y0 < r.y + r.h - 1;
  }
  return false;
}
(function () {
  var boxes = {};
  rm.order.forEach(function (n) {
    boxes[n] = { x: rm.pos[n].x, y: rm.pos[n].y, w: rm.size[n].w, h: rm.size[n].h };
  });
  var bad = [];
  rm.routes.forEach(function (r) {
    for (var i = 1; i < r.pts.length; i++) {
      var a = r.pts[i - 1], b = r.pts[i];
      if (a[0] !== b[0] && a[1] !== b[1]) continue;   // 只查正交段
      for (var k in boxes) {
        if (k === r.from || k === r.to) continue;
        if (segHits(a, b, boxes[k])) bad.push(r.from + '->' + r.to + ' 第' + i + '段穿 ' + k);
      }
    }
  });
  ok('正交段不穿其他节点', bad.length === 0, bad.join(';'));
})();
(function () {
  // 画布必须包住所有走线点和标签（回边伸到画布外时不能裁掉）
  var bad = [];
  rm.routes.forEach(function (r) {
    r.pts.forEach(function (p) {
      if (p[0] < 0 || p[1] < 0 || p[0] > rm.width || p[1] > rm.height) bad.push(JSON.stringify(p));
    });
    if (r.label) {
      var lw = Math.max(10, r.label.length * 9 + 10);
      if (r.labelPos[0] - lw / 2 < 0 || r.labelPos[0] + lw / 2 > rm.width) bad.push('label ' + r.label);
    }
  });
  ok('画包包住全部走线', bad.length === 0, bad.join(';'));
})();
ok('回边走了右侧通道', rm.routes.some(r => r.pts.some(p => p[0] > rm.width - 40 || p[0] < 40)));

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
