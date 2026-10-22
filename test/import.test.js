/* Node 单测：docx / html → Markdown 导入
 *
 * docx 用的是**手工构造的 Word 风格 zip**（deflate 压缩，和真 Word 一致），
 * 不是我们自己导出的 store 包 —— 真文档走的是 deflate 分支，得单独锁住。
 * 另外用「md → docx → md」往返验证本项目的导出结果能被自己读回来。
 */
const assert = require('assert');
const MD = require('../app/js/md.js');
const Docx = require('../app/js/docx.js');
const I = require('../app/js/importer.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e).split('\n')[0]); }
}

const { buildDeflateZip, sampleDocx } = require('./fixtures.js');

/* ---------------------------------------------------------- HTML */
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>导入测试</title>
<style>body{color:red}</style><script>alert(1)</script></head><body>
<h1>大标题</h1>
<p>一段有 <strong>粗</strong>、<em>斜</em>、<code>code|span</code>、<del>删</del>、<u>下划线</u> 的文字，
还有 &lt;标签&gt; 与 &amp; 符号。</p>
<p>第一行<br>第二行</p>
<h2>小节</h2>
<ul><li>苹果</li><li>香蕉<ul><li>小米蕉</li></ul></li></ul>
<ol start="3"><li>第三</li><li>第四</li></ol>
<blockquote><p>引文<b>加粗</b></p><blockquote><p>嵌套引文</p></blockquote></blockquote>
<pre><code class="language-js">function a() {
  return 1;
}</code></pre>
<table>
  <tr><th align="left">名称</th><th align="right">价格</th></tr>
  <tr><td>苹果|红</td><td>3</td></tr>
</table>
<p><img src="assets/pic.png" alt="示例 图" width="240" height="120"></p>
<details><summary>折叠</summary><p>里面的内容</p></details>
<hr>
<p><a href="https://example.com/x(y)" title="提示">带括号的链接</a></p>
</body></html>`;

(async function main() {
  console.log('\n[1] HTML → Markdown');
  const h = I.mdFromHTML(HTML);
  const md = h.markdown;

  await t('标题用 # 级数表达', () => {
    assert.ok(md.indexOf('# 大标题') === 0, '开头不是 h1：' + md.slice(0, 40));
    assert.ok(md.indexOf('## 小节') > 0, '缺少 h2');
  });

  await t('行内样式映射成 md 语法', () => {
    assert.ok(md.indexOf('**粗**') > 0, '缺粗体');
    assert.ok(md.indexOf('*斜*') > 0, '缺斜体');
    assert.ok(md.indexOf('`code|span`') > 0, '缺行内代码');
    assert.ok(md.indexOf('~~删~~') > 0, '缺删除线');
    assert.ok(md.indexOf('下划线') > 0, '下划线文字丢了');
    assert.strictEqual(md.indexOf('<u>'), -1, '不该把 <u> 源码留在正文里');
  });

  await t('实体解码后再按 md 规则转义', () => {
    assert.ok(md.indexOf('\\<标签> 与 & 符号') > 0, '实体/转义不对：' + md.slice(0, 400));
  });

  await t('<br> 变成硬换行（两个空格 + 换行）', () => {
    assert.ok(/第一行 {2}\n第二行/.test(md), '没有变成硬换行');
  });

  await t('嵌套列表缩进正确', () => {
    assert.ok(md.indexOf('- 苹果\n- 香蕉\n  - 小米蕉') > 0, '嵌套结构不对：' +
      JSON.stringify(md.slice(md.indexOf('- 苹果'), md.indexOf('- 苹果') + 40)));
  });

  await t('有序列表尊重 start', () => {
    assert.ok(md.indexOf('3. 第三\n4. 第四') > 0, '起始编号丢了');
  });

  await t('引用与嵌套引用', () => {
    assert.ok(md.indexOf('> 引文**加粗**') > 0, '引用首行不对');
    assert.ok(md.indexOf('> > 嵌套引文') > 0, '嵌套引用不对');
  });

  await t('代码块保留语言与换行', () => {
    assert.ok(md.indexOf('```js\nfunction a() {\n  return 1;\n}\n```') > 0, '代码块不对');
  });

  await t('表格对齐与竖线转义', () => {
    assert.ok(md.indexOf('| 名称') > 0, '缺表头');
    assert.ok(/\| :-+ \|/.test(md), '左对齐没写：' + (/^\|.*$/m.exec(md) || [''])[0]);
    assert.ok(md.indexOf('---:') > 0, '右对齐没写');
    assert.ok(md.indexOf('苹果\\|红') >= 0, '单元格里的 | 没转义');
  });

  await t('图片带尺寸变成 =WxH', () => {
    assert.ok(md.indexOf('![示例 图](assets/pic.png =240x120)') > 0, '图片语法不对：' +
      (/!\[[^\]]*\]\([^)]*\)/.exec(md) || [''])[0]);
  });

  await t('无法表达的元素保留成 HTML（details）', () => {
    assert.ok(md.indexOf('<details><summary>折叠</summary><p>里面的内容</p></details>') > 0, 'details 没保留');
  });

  await t('script / style / head 全部丢弃', () => {
    assert.ok(md.indexOf('alert(1)') === -1, 'script 内容漏进来了');
    assert.ok(md.indexOf('color:red') === -1, 'style 内容漏进来了');
    assert.ok(md.indexOf('导入测试') === -1, 'title 漏进正文');
    assert.strictEqual(h.title, '导入测试');
  });

  await t('hr 变成 ---', () => {
    assert.ok(/^---$/m.test(md), '缺分隔线');
  });

  await t('带括号的链接用尖括号包住', () => {
    assert.ok(md.indexOf('[带括号的链接](<https://example.com/x(y)> "提示")') > 0, '链接语法不对：' +
      (/\[带括号[^\n]*/.exec(md) || [''])[0]);
  });

  await t('转换结果能被自己的解析器无损往返', () => {
    assert.strictEqual(MD.serialize(MD.parse(md)), md, '往返不一致');
  });

  console.log('\n[2] DOCX → Markdown（真 Word 结构 + deflate）');
  const d = await I.fromDocx(sampleDocx(), { assetDir: 'assets/test-media/' });
  const dm = d.markdown;
  console.log('      ---- 转出的 Markdown ----');
  dm.split('\n').forEach((l) => console.log('      ' + l));

  await t('heading 样式名（"heading 1"）识别成一级标题', () => {
    assert.ok(dm.indexOf('# 第一章 标题') === 0, '没识别成标题：' + dm.slice(0, 30));
  });

  await t('粗/斜/删/上标/行内代码', () => {
    assert.ok(dm.indexOf('**粗体**') > 0, '缺粗体');
    assert.ok(dm.indexOf('*斜体*') > 0, '缺斜体');
    assert.ok(dm.indexOf('`行内代码`') > 0, '缺行内代码（字符样式要认）');
    assert.ok(dm.indexOf('~~删除线~~') > 0, '缺删除线');
    assert.ok(dm.indexOf('²') > 0, '上标没映射成 Unicode：' + dm.split('\n')[2]);
  });

  await t('无序 / 有序列表分开且缩进正确', () => {
    assert.ok(dm.indexOf('- 无序一\n- 无序二\n  - 无序二·嵌套') > 0, '无序列表不对：' +
      JSON.stringify(dm.slice(dm.indexOf('- 无序一'), dm.indexOf('- 无序一') + 60)));
    assert.ok(dm.indexOf('1. 有序一\n2. 有序二') > 0, '有序列表不对');
  });

  await t('Quote 样式 → 引用，且不再重复包一层斜体', () => {
    assert.ok(dm.indexOf('> 引用的一段话') > 0, '引用没成立');
    assert.ok(dm.indexOf('> *引用的一段话*') === -1, '引用里多了一层斜体');
  });

  await t('CodeBlock 样式的连续段落合成一个围栏', () => {
    assert.ok(dm.indexOf('```\nconst a = 1;\nconsole.log(a);\n```') > 0, '代码块不对：' +
      JSON.stringify(dm.slice(dm.indexOf('const a'), dm.indexOf('const a') + 60)));
  });

  await t('下边框空段落 → 分隔线', () => {
    assert.ok(/^---$/m.test(dm), '缺分隔线');
  });

  await t('内嵌图片按 extent 换算像素并登记资源', () => {
    assert.ok(dm.indexOf('![](assets/test-media/image1.png =200x100)') > 0, '图片语法不对：' +
      (/!\[[^\]]*\]\([^)]*\)/.exec(dm) || [''])[0]);
    assert.strictEqual(d.assets.length, 1);
    assert.strictEqual(d.assets[0].path, 'assets/test-media/image1.png');
    assert.ok(d.assets[0].bytes.length > 0, '资源没有字节');
  });

  await t('超链接走 rels 里的 URL', () => {
    assert.ok(dm.indexOf('[示例站点](https://example.com/a?b=1)') > 0, '链接不对');
  });

  await t('表格：对齐、表头加粗、gridSpan 补空格', () => {
    assert.ok(dm.indexOf('| **名称**') > 0, '表头没出来');
    assert.ok(/\|\s*:---/.test(dm), '左对齐没保留');
    assert.ok(dm.indexOf('---:') > 0, '右对齐没保留');
    const row = dm.split('\n').filter((l) => l.indexOf('合并两列') >= 0)[0] || '';
    assert.ok(row.indexOf('|') === 0, '合并行没成为表格行：' + row);
    assert.strictEqual((row.match(/\|/g) || []).length, 3, '列数不对：' + row);
  });

  await t('脚注引用与定义成对出现', () => {
    assert.ok(dm.indexOf('[^1]') > 0, '缺脚注引用');
    assert.ok(dm.indexOf('[^1]: 这是脚注正文') > 0, '缺脚注定义');
  });

  await t('转换结果能被自己的解析器无损往返', () => {
    assert.strictEqual(MD.serialize(MD.parse(dm)), dm, '往返不一致');
  });

  await t('没有 zip / 缺 document.xml 时报错清楚', async () => {
    await assert.rejects(() => I.fromDocx(new Uint8Array([1, 2, 3])), /zip|docx/i);
    const z = buildDeflateZip([{ name: 'word/styles.xml', data: '<w:styles xmlns:w="x"/>' }]);
    await assert.rejects(() => I.fromDocx(z), /document\.xml/);
  });

  console.log('\n[3] 往返：本项目导出的 docx 能被自己读回来');
  const src = [
    '# 标题一', '',
    '正文 **粗** 与 *斜*，`代码`，[链接](https://example.com)。', '',
    '- 甲', '- 乙', '  - 丙', '',
    '1. 一', '2. 二', '',
    '> 引用', '',
    '| a | b |', '| :-- | --: |', '| 1 | 2 |', '',
    '---', '',
    '收尾'
  ].join('\n');
  const built = await Docx.build(src, { title: 'roundtrip' });
  const back = await I.fromDocx(built.bytes);
  console.log('      ---- 往返结果 ----');
  back.markdown.split('\n').forEach((l) => console.log('      ' + l));

  await t('标题 / 段落 / 列表 / 引用 / 表格 / 分隔线都还在', () => {
    const m2 = back.markdown;
    assert.ok(m2.indexOf('# 标题一') === 0, '标题丢了');
    assert.ok(m2.indexOf('**粗**') > 0 && m2.indexOf('*斜*') > 0, '行内样式丢了');
    assert.ok(m2.indexOf('`代码`') > 0, '行内代码丢了');
    assert.ok(m2.indexOf('- 甲\n- 乙\n  - 丙') > 0, '列表结构变了：' +
      JSON.stringify(m2.slice(m2.indexOf('- 甲'), m2.indexOf('- 甲') + 40)));
    assert.ok(m2.indexOf('1. 一\n2. 二') > 0, '有序列表变了');
    assert.ok(m2.indexOf('> 引用') > 0, '引用丢了');
    assert.ok(m2.indexOf('| a') > 0 || m2.indexOf('| **a**') > 0, '表格丢了');
    assert.ok(/^---$/m.test(m2), '分隔线丢了');
    assert.ok(m2.trim().endsWith('收尾'), '结尾段落丢了');
  });

  console.log('\n[4] convert 门面');
  await t('html 通过 base64 走通（含 UTF-8 中文）', async () => {
    const b64 = Buffer.from('<p>中文<strong>粗</strong></p>', 'utf8').toString('base64');
    const r = await I.convert('html', b64, {});
    assert.strictEqual(r.markdown.trim(), '中文**粗**');
  });

  await t('docx 通过 base64 走通，资源也转成 base64', async () => {
    const b64 = Buffer.from(sampleDocx()).toString('base64');
    const r = await I.convert('docx', b64, { assetDir: 'assets/demo-media/' });
    assert.ok(r.markdown.indexOf('# 第一章 标题') === 0);
    assert.strictEqual(r.assets.length, 1);
    assert.strictEqual(typeof r.assets[0].base64, 'string');
    assert.ok(r.assets[0].base64.length > 0);
    assert.strictEqual(r.assets[0].path, 'assets/demo-media/image1.png');
  });

  await t('md / txt 原样透传（去 BOM）', async () => {
    const src2 = '\ufeff# 已有\n\n正文\n';
    const r = await I.convert('md', Buffer.from(src2, 'utf8').toString('base64'), {});
    assert.strictEqual(r.markdown.indexOf('\ufeff'), -1, 'BOM 没去掉');
    assert.ok(r.markdown.indexOf('# 已有') === 0);
  });

  await t('不认识的扩展名报错', async () => {
    await assert.rejects(() => I.convert('pdf', 'AAAA', {}), /不支持/);
  });

  console.log('\n[5] GBK 编码的 HTML');
  await t('meta charset=gbk 的页面按 GBK 解码', async () => {
    let iconv;
    try { iconv = new TextDecoder('gbk'); } catch (e) { return; }
    // 「中文」的 GBK 字节
    const bytes = Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]);
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="gbk"></head><body><p>', 'ascii'),
      bytes,
      Buffer.from('</p></body></html>', 'ascii')
    ]);
    const r = await I.convert('html', html.toString('base64'), {});
    assert.ok(r.markdown.indexOf('中文') === 0, 'GBK 没解对：' + JSON.stringify(r.markdown));
  });

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('❌ 未捕获异常：' + (e && e.stack || e));
  process.exit(1);
});
