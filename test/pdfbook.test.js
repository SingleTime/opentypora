/* PDF 书签：前端大纲抽取（纯函数）+ 原生 PDFKit 挂载（真跑 Swift 测试）
 *
 * Swift 部分不是 mock：native/pdfbook.swift 与测试一起编译，造真 PDF、挂书签、
 * 再用 PDFDocument 读回来验层级与落页。编译产物缓存到 build/pdfbooktest，
 * 源码更新才重编；没有 swiftc 时 SKIP 掉一半，不让整条回归链挂掉。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Export = require(path.join(ROOT, 'app', 'js', 'export.js'));

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
function titles(list) { return list.map(x => x.level + ':' + x.text).join(' | '); }

/* -------------------------------------------------- 大纲抽取 */
group('标题抽取');
{
  const src = [
    '# 第一章', '正文', '## 1.1 小节', '### 1.1.1 细节',
    '#### H4', '##### H5', '###### H6'
  ].join('\n');
  eq('六级标题都认', titles(Export.pdfOutline(src)),
    '1:第一章 | 2:1.1 小节 | 3:1.1.1 细节 | 4:H4 | 5:H5 | 6:H6');
  eq('空文档', Export.pdfOutline('').length, 0);
  eq('null 不炸', Export.pdfOutline(null).length, 0);
  eq('没有标题', Export.pdfOutline('正文\n\n更多正文').length, 0);
  eq('# 后面没空格不算标题', Export.pdfOutline('#没有空格').length, 0);
  eq('七个 # 不算标题', Export.pdfOutline('####### 七个').length, 0);
  eq('行首缩进的标题不算', Export.pdfOutline('  # 缩进').length, 0);
}

group('围栏里的 # 不当标题');
{
  const src = ['# 真标题', '```python', '# 这是注释', '```', '~~~', '# 也不是标题', '~~~'].join('\n');
  eq('围栏内跳过、围栏外照收', titles(Export.pdfOutline(src)), '1:真标题');
  eq('未闭合围栏之后都不算',
    titles(Export.pdfOutline('# A\n```\n# B\n# C')), '1:A');
}

group('标题文字去掉行内标记（原生要拿它去 PDF 里搜）');
{
  eq('粗体', Export.pdfOutline('## **粗**标题')[0].text, '粗标题');
  eq('斜体', Export.pdfOutline('## *斜*标题')[0].text, '斜标题');
  eq('行内代码', Export.pdfOutline('## 用 `code` 收尾')[0].text, '用 code 收尾');
  eq('链接', Export.pdfOutline('## 见[文档](https://x/y)')[0].text, '见文档');
  eq('引用式链接', Export.pdfOutline('## 见[文档][ref]')[0].text, '见文档');
  eq('图片取 alt', Export.pdfOutline('## ![图](a.png) 说明')[0].text, '图 说明');
  eq('脚注引用剥掉', Export.pdfOutline('## 论点[^1]')[0].text, '论点');
  eq('删除线', Export.pdfOutline('## ~~旧~~新')[0].text, '旧新');
  eq('行内 HTML', Export.pdfOutline('## 标题<br>换行')[0].text, '标题换行');
  eq('转义符号', Export.pdfOutline('## 1\\. 不是列表')[0].text, '1. 不是列表');
  eq('尾部 ### 去掉', Export.pdfOutline('## 标题 ###')[0].text, '标题');
  eq('多空格归一', Export.pdfOutline('##   a    b  ')[0].text, 'a b');
  eq('中文与 emoji 原样', Export.pdfOutline('## 中文🙂标题')[0].text, '中文🙂标题');
  eq('纯标记的空标题被丢掉', Export.pdfOutline('## **')[0], undefined);
}

/* -------------------------------------------------- 原生挂载 */
group('原生 PDFKit（真跑 Swift）');
{
  const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (swiftc.status !== 0) {
    skip++; console.log('  - SKIP 没有 swiftc，跳过原生部分');
  } else {
    const bin = path.join(ROOT, 'build', 'pdfbooktest');
    const srcs = [path.join(ROOT, 'native', 'pdfbook.swift'), path.join(ROOT, 'test', 'pdfbook', 'main.swift')];
    const stale = !fs.existsSync(bin) ||
      srcs.some(s => !fs.existsSync(s) || fs.statSync(s).mtimeMs > fs.statSync(bin).mtimeMs);
    if (stale) {
      const cc = spawnSync('swiftc', ['-O', '-o', bin, srcs[0], srcs[1], '-framework', 'PDFKit', '-framework', 'AppKit'],
        { cwd: ROOT, encoding: 'utf8' });
      if (cc.status !== 0) {
        fail++; console.log('  ✗ 编译 pdfbooktest 失败\n' + (cc.stderr || '').slice(0, 800));
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
    ok('swift 进程正常退出', run.status === 0, 'exit ' + run.status + '\n' + (run.stderr || '').slice(0, 400));
  }
}

/* -------------------------------------------------- 接进导出的开关 */
group('选项与导出链');
{
  eq('书签默认开', Export.pdfOptions({}).bookmarks, true);
  eq('显式关掉', Export.pdfOptions({ bookmarks: false }).bookmarks, false);
  eq('假值也关', Export.pdfOptions({ bookmarks: 0 }).bookmarks, false);
  eq('只保留已知字段', Object.keys(Export.pdfOptions({ outline: [1], x: 1 })).sort().join(','),
    'bookmarks,h1page,headerFooter,margin,paper');
  const hasCall = fs.readFileSync(path.join(ROOT, 'native', 'main.swift'), 'utf8')
    .indexOf('PDFBookmarks.attach(to: url, headings: heads)') >= 0;
  ok('原生 renderPDF 里调用了挂书签', hasCall);
  const ui = fs.readFileSync(path.join(ROOT, 'app', 'js', 'ui.js'), 'utf8');
  ok('导出时把 outline 塞进载荷', ui.indexOf('o.outline = (o.bookmarks') >= 0);
  ok('对话框有书签开关', ui.indexOf('id="pdf-book"') >= 0);
}

console.log('\n' + (fail ? '✗ ' : '✅ ') + pass + ' passed, ' + fail + ' failed' + (skip ? '（' + skip + ' 项跳过）' : ''));
process.exit(fail ? 1 : 0);
