/* 渲染态拼写波浪线：切词/分段/替换定位 + 接线一致性 + 原生词典（真跑 Swift）
 *
 * 三个部分：
 *   1. spell.js 的纯函数 —— Node 里直接 require，不碰 DOM；
 *   2. 接线 —— CSS 变量、脚本顺序、编辑器钩子、桥方法、build.sh 有没有漏；
 *   3. 原生 —— native/spell.swift 与 test/spell/main.swift 一起编译成命令行程序，
 *      断言的是真词典（NSSpellChecker）的判定，不是桩。
 *
 * DOM 层（真包 span、真量波浪线）在 test/spelldom.test.js，走 build/shot。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Spell = require(path.join(ROOT, 'app', 'js', 'spell.js'));
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const EDITOR = fs.readFileSync(path.join(ROOT, 'app', 'js', 'editor.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'app', 'js', 'ui.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'app', 'js', 'bridge.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'native', 'main.swift'), 'utf8');
const BUILD = fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8');

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

/* ---------------------------------------------- 候选词判定 */
group('isCandidate 卡边界');
{
  eq('单字母不查（a）', Spell.isCandidate('a'), false);
  eq('单字母不查（I）', Spell.isCandidate('I'), false);
  eq('两个字母就查（as）', Spell.isCandidate('as'), true);
  eq('40 字以内照查', Spell.isCandidate('a'.repeat(40)), true);
  eq('超长串不查（41）', Spell.isCandidate('a'.repeat(41)), false);
  eq('空串不查', Spell.isCandidate(''), false);
  eq('null 不查', Spell.isCandidate(null), false);
  eq('纯数字不查', Spell.isCandidate('123'), false);
  eq('全大写要查（缩写交给词典判断）', Spell.isCandidate('API'), true);
  eq('常量与实现一致', Spell.MAXLEN, 40);
}

/* ---------------------------------------------- 切词 */
group('tokenize：切得准、偏移对得上、别乱切');
{
  const t = Spell.tokenize('Hello, world!');
  eq('两个词', t.length, 2);
  eq('第一个词', t[0].word, 'Hello');
  eq('第一个词的区间', t[0].start + '-' + t[0].end, '0-5');
  eq('第二个词', t[1].word, 'world');
  eq('逗号后的偏移', t[1].start + '-' + t[1].end, '7-12');

  const cjk = Spell.tokenize('中文 mixed 中文');
  eq('中文被跳过（只留英文词）', cjk.map(x => x.word).join(','), 'mixed');

  const num = Spell.tokenize('v2 与 2024 以及 x86');
  eq('数字粘着的碎片不查', num.map(x => x.word).join(','), '');

  const apos = Spell.tokenize("don't don’t");
  eq('直撇号算一个词', apos[0].word, "don't");
  eq('弯撇号也算一个词', apos[1].word, 'don’t');
  eq('撇号词整体长度', apos[0].word.length, 5);
  eq('撇号后不切断（偏移连续）', apos[0].end, 5);

  const hy = Spell.tokenize('well-known');
  eq('连字符切成两半', hy.map(x => x.word).join(','), 'well,known');

  const us = Spell.tokenize('foo_bar');
  eq('下划线切成两段', us.map(x => x.word).join(','), 'foo,bar');

  const one = Spell.tokenize('a I b');
  eq('单字母一个都不收', one.length, 0);

  const empty = Spell.tokenize('');
  eq('空文本没有 token', empty.length, 0);
  eq('null 不炸', Spell.tokenize(null).length, 0);

  // 每个 token 的区间必须真的框住自己
  const doc = 'The coloumn recieve teh siggnals.';
  const toks = Spell.tokenize(doc);
  ok('每个区间都框住了对应的词',
    toks.every(t => doc.slice(t.start, t.end) === t.word),
    JSON.stringify(toks));
  eq('那句切出 5 个词', toks.length, 5);
}

/* ---------------------------------------------- 待查词去重/缓存 */
group('pending：去重、跳过已判过的');
{
  const toks = Spell.tokenize('the the coloumn coloumn the');
  eq('去重后两个', Spell.pending(toks, {}).join(','), 'the,coloumn');
  eq('缓存里有的跳过', Spell.pending(toks, { the: 0 }).join(','), 'coloumn');
  eq('错词在缓存里也跳过', Spell.pending(toks, { the: 1, coloumn: 1 }).join(','), '');
  eq('保持首次出现顺序', Spell.pending(Spell.tokenize('bb aa bb aa'), {}).join(','), 'bb,aa');
  eq('空 token 列表', Spell.pending([], {}).length, 0);
  eq('null 不炸', Spell.pending(null, null).length, 0);
}

group('mark：按判定挑 token');
{
  const toks = Spell.tokenize('good bad good');
  const rs = Spell.mark(toks, w => w === 'bad');
  eq('只挑出被判坏的', rs.length, 1);
  eq('挑出来的是 bad', rs.map(r => r.word).join(','), 'bad');
  eq('区间保留', rs[0].start + '-' + rs[0].end, '5-8');
  eq('同一个词出现两次就挑两次', Spell.mark(toks, w => w === 'good').length, 2);
  eq('判定函数返回假值就空', Spell.mark(toks, () => false).length, 0);
}

/* ---------------------------------------------- 分段 */
group('segments：拼回去必须等于原文');
{
  const text = 'the coloumn here';
  const segs = Spell.segments(text, [{ start: 4, end: 11 }]);
  eq('分三段', segs.length, 3);
  eq('第一段是前缀', segs[0].text, 'the ');
  eq('第二段是坏词', segs[1].text + '/' + segs[1].bad, 'coloumn/true');
  eq('第三段是尾巴', segs[2].text, ' here');
  eq('拼回去等于原文', segs.map(s => s.text).join(''), text);

  const none = Spell.segments(text, []);
  eq('没有区间就一整段', none.length, 1);
  eq('一整段不是坏词', none[0].bad, false);

  const clip = Spell.segments(text, [{ start: -5, end: 3 }, { start: 14, end: 99 }]);
  eq('越界区间被夹住', clip.map(s => s.text).join(''), text);
  ok('夹住后仍有坏词段', clip.some(s => s.bad));

  // 重叠区间的正确语义是「并集」：两段都算坏，但文字一份不多一分不少
  const overlap = Spell.segments(text, [{ start: 0, end: 6 }, { start: 3, end: 9 }]);
  eq('重叠区间不重复输出', overlap.map(s => s.text).join(''), text);
  eq('重叠区间的坏标记是并集',
    overlap.filter(s => s.bad).map(s => s.text).join(''), 'the colou');

  const dup = Spell.segments(text, [{ start: 2, end: 2 }]);
  eq('空区间丢掉', dup.filter(s => s.bad).length, 0);
  eq('空区间也不丢文本', dup.map(s => s.text).join(''), text);

  const empty = Spell.segments('', []);
  eq('空文本给出一个空段', empty.length, 1);
}

group('wrapHTML：转义与包裹');
{
  eq('普通包裹', Spell.wrapHTML('a bad z', [{ start: 2, end: 5 }]),
    'a <span class="spell-bad">bad</span> z');
  const esc = Spell.wrapHTML('<b>x</b>', [{ start: 3, end: 4 }]);
  ok('尖括号被转义', esc.indexOf('&lt;b&gt;') === 0 && esc.indexOf('&lt;/b&gt;') > 0, esc);
  ok('坏词上的转义也照做', esc.indexOf('<span class="spell-bad">x</span>') > 0, esc);
  eq('& 被转义', Spell.escHTML('a & b'), 'a &amp; b');
  eq('引号被转义', Spell.escHTML('"q"'), '&quot;q&quot;');
  eq('null 变空串', Spell.escHTML(null), '');
  eq('没有坏词时原样返回', Spell.wrapHTML('plain', []), 'plain');
}

/* ---------------------------------------------- 替换定位 */
group('nearest / fixAt：data-s 算偏了也能找回那一处');
{
  const text = 'the coloumn here, coloumn again';
  eq('nearest 找最近的', Spell.nearest(text, 'coloumn', 0), 4);
  eq('nearest 后半段', Spell.nearest(text, 'coloumn', 20), 18);
  eq('nearest 找不到给 -1', Spell.nearest(text, 'nope', 0), -1);
  eq('nearest 空词给 -1', Spell.nearest(text, '', 3), -1);

  eq('fixAt 位置对就照用', Spell.fixAt(text, 'coloumn', 4), 4);
  eq('fixAt 差一个字符能修回来', Spell.fixAt(text, 'coloumn', 5), 4);
  eq('fixAt 差两个字符也能修', Spell.fixAt(text, 'coloumn', 2), 4);
  eq('fixAt 差太远退回全篇搜索', Spell.fixAt(text, 'coloumn', 22), 18);
  eq('fixAt 位置是 null 时全篇找', Spell.fixAt(text, 'coloumn', null), 4);
  eq('fixAt 词不在正文里给 -1', Spell.fixAt(text, 'absent', 0), -1);

  // 链接里的 data-s 指向 `[`，实测会差 1 —— 模拟一下
  const linked = 'see [coloumn](http://x) ok';
  const at = linked.indexOf('[');      // data-s 给的是 [ 的位置
  eq('链接里的词靠微调找回', Spell.fixAt(linked, 'coloumn', at), at + 1);
}

group('chunkList：分片');
{
  eq('5 个词按 2 分片', JSON.stringify(Spell.chunkList([1, 2, 3, 4, 5], 2)),
    JSON.stringify([[1, 2], [3, 4], [5]]));
  eq('整除时没空片', Spell.chunkList([1, 2, 3, 4], 2).length, 2);
  eq('空数组没有片', Spell.chunkList([], 10).length, 0);
  eq('size 非法时按 1 片', Spell.chunkList([1, 2], 0).length, 2);
  eq('单次请求上限', Spell.CHUNK, 1200);
}

/* ---------------------------------------------- 接线 */
group('接线：CSS / 脚本顺序 / 编辑器钩子 / 桥 / 构建');
{
  ['github', 'night', 'newsprint', 'pixyll', 'whitey', 'gothic'].forEach(id => {
    const block = new RegExp('html\\[data-theme="' + id + '"\\] \\{([\\s\\S]*?)\\}').exec(CSS);
    ok('主题 ' + id + ' 定义了 --spell', !!block && block[1].indexOf('--spell:') > 0);
  });
  ok(':root 有 --spell 兜底', /:root \{[\s\S]*?--spell:/.test(CSS));
  ok('.spell-bad 画波浪线', /\.spell-bad \{[^}]*text-decoration: underline wavy var\(--spell/.test(CSS));
  ok('关掉 skip-ink（不然 g/y 的下摆会咬断线）', /\.spell-bad \{[^}]*text-decoration-skip-ink: none/.test(CSS));
  ok('波浪线不接鼠标事件以外的东西（不占布局）', CSS.indexOf('.spell-bad {\n  text-decoration') > 0);
  ok('右键菜单有样式', CSS.indexOf('.spell-menu {') > 0 && CSS.indexOf('.spell-menu-ignore') > 0);
  ok('菜单层级压过正文', /\.spell-menu \{[^}]*z-index: 12/.test(CSS));

  const iSpell = HTML.indexOf('js/spell.js');
  const iEditor = HTML.indexOf('js/editor.js');
  ok('index.html 载入 spell.js', iSpell > 0);
  ok('spell.js 排在 editor.js 之前', iSpell > 0 && iEditor > 0 && iSpell < iEditor);

  ok('render() 之后上色', /decorate\(\);[\s\S]{0,160}Spell\.paint\(ED\)/.test(EDITOR));
  ok('退出编辑只重画那一块', /replaceChild\(node, el\);[\s\S]{0,200}Spell\.paint\(node\)/.test(EDITOR));

  ok('偏好里有忽略表', UI.indexOf('spellIgnore: []') > 0);
  ok('applyPrefs 灌忽略表并开关', UI.indexOf('Spell.setIgnore(') > 0 && UI.indexOf('Spell.setEnabled(') > 0);
  ok('boot 里接原生引擎', UI.indexOf('Bridge.spellCheck') > 0);
  ok('boot 里接建议词', UI.indexOf('Bridge.spellGuesses') > 0);
  ok('忽略后写回偏好', UI.indexOf('pref.spellIgnore = list') > 0);

  ok('bridge 有 spellCheck', BRIDGE.indexOf('spellCheck: function') > 0);
  ok('bridge 有 spellGuesses', BRIDGE.indexOf('spellGuesses: function') > 0);
  ok('原生接住 spellCheck', MAIN.indexOf('case "spellCheck"') > 0);
  ok('原生接住 spellGuesses', MAIN.indexOf('case "spellGuesses"') > 0);
  ok('判定跑在后台队列（不卡主线程）', MAIN.indexOf('SpellCheck.offload') > 0);
  ok('build.sh 编译 spell.swift', BUILD.indexOf('native/spell.swift') > 0);
}

/* ---------------------------------------------- 原生 */
group('原生词典（真跑 Swift + NSSpellChecker）');
{
  const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (swiftc.status !== 0) {
    skip++; console.log('  - SKIP 没有 swiftc，跳过原生部分');
  } else {
    const bin = path.join(ROOT, 'build', 'spelltest');
    const srcs = [path.join(ROOT, 'native', 'spell.swift'), path.join(ROOT, 'test', 'spell', 'main.swift')];
    const stale = !fs.existsSync(bin) ||
      srcs.some(s => !fs.existsSync(s) || fs.statSync(s).mtimeMs > fs.statSync(bin).mtimeMs);
    if (stale) {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      const cc = spawnSync('swiftc', ['-O', '-o', bin, srcs[0], srcs[1]], { cwd: ROOT, encoding: 'utf8' });
      if (cc.status !== 0) {
        fail++; console.log('  ✗ 编译 spelltest 失败\n' + (cc.stderr || '').slice(0, 800));
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
