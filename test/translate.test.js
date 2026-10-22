// 生成翻译功能的测试页：把 app/index.html 复制一份，注入 mock 桥 + 断言脚本
// index.html 的 DOM 会随产品演进，用注入而不是另写一份，避免测试和真实界面脱节。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__tr_harness.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.__mockMode = 'ok';
window.__trCalls = [];
// 测试里固定源语言为 en，绕开脚本检测（检测本身另有专门的用例覆盖）
window.__trSource = 'en';
window.Bridge = {
  available: true,
  translate: function (text, target, source) {
    window.__trCalls.push({ text: text, target: target, source: source });
    return new Promise(function (res) {
      // 注意：锁屏/遮挡窗口下 WebKit 会把 setTimeout 节流到 ~1 次/秒，
      // 测试里少用定时器，这里直接异步返回。
      setTimeout(function () {
        if (window.__mockMode === 'notInstalled') {
          res({ error: 'notInstalled', message: '中文语言包尚未下载', canDownload: true });
        } else {
          res({ text: 'MOCK-TRANSLATION(' + target + ')', sourceLang: source || 'en', targetLang: target });
        }
      }, 120);
    });
  },
  prepareTranslation: function () { window.__prepared = true; return Promise.resolve({ ok: true }); },
  translationStatus: function (t) { return Promise.resolve({ status: 'supported', target: t, languages: [] }); },
  openTranslationSettings: function () { window.__openedSettings = true; return Promise.resolve(null); },
  copy: function (s) { window.__copied = s; return Promise.resolve(null); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  confirm: function () { return Promise.resolve(true); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); }
};
</script>
`;

const TEST = `
<script>
(function () {
  var R = [], t0 = Date.now();
  function ok(name, cond, extra) { R.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function blkBy(re) {
    var bs = document.querySelectorAll('#editor .blk');
    for (var i = 0; i < bs.length; i++) if (re.test(bs[i].textContent)) return bs[i];
    return null;
  }
  function count() { return document.querySelectorAll('#editor .blk').length; }
  function selectEl(el) {
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  function out() { return document.getElementById('tr-out').textContent || ''; }
  function panelShown() { return document.getElementById('tr-panel').classList.contains('show'); }

  async function run() {
    await sleep(400);
    var watchdog = setTimeout(function () { if (!window.__report) { R.push('WATCHDOG 超时，停在上述步骤'); report(); } }, 90000);

    R.push('STEP 1 默认语言');
    ok('默认目标语言为中文简体', document.getElementById('tr-target').value === 'zh-Hans',
       document.getElementById('tr-target').value);

    R.push('STEP 2-5 选区/浮标/面板/插入/替换');
    var first = blkBy(/从零开始写的 Markdown 编辑器/);
    ok('找到可测试段落', !!first);
    if (first) {
      // 2. 选中文本 → 出现浮动「翻译」按钮
      selectEl(first);
      await sleep(120);
      var bar = document.getElementById('sel-bar');
      ok('选中后出现浮动翻译按钮', bar.classList.contains('show'));
      var br = bar.getBoundingClientRect();
      ok('浮动按钮位于可视区内', br.top >= 0 && br.left >= 0 && br.bottom <= window.innerHeight + 1,
         Math.round(br.left) + ',' + Math.round(br.top));

      // 3. 点击浮标 → 面板出现并完成翻译
      document.getElementById('sel-translate').click();
      ok('打开后立即进入加载态', out().indexOf('正在') >= 0);
      await sleep(420);
      ok('译文渲染到面板', out().indexOf('MOCK-TRANSLATION(zh-Hans)') >= 0, out().slice(0, 40));
      ok('底部标注来源与目标语言',
         (document.getElementById('tr-note').textContent || '').indexOf('中文（简体）') >= 0,
         document.getElementById('tr-note').textContent);
      ok('译文就绪后「复制」可用', !document.getElementById('tr-copy').disabled);
    }

    // 4. 插入下方
    var before = count();
    document.getElementById('tr-insert').click();
    await sleep(80);
    ok('插入下方：块数 +1', count() === before + 1, before + ' → ' + count());
    ok('插入下方：内容写入文档',
       (document.getElementById('editor').textContent || '').indexOf('MOCK-TRANSLATION(zh-Hans)') >= 0);
    ok('插入后自动关闭面板', !panelShown());

    // 5. 替换原文（块内唯一匹配）
    var target = blkBy(/从零开始写的 Markdown 编辑器/);
    var beforeText = target ? target.textContent : '';
    selectEl(target);
    await sleep(120);
    document.getElementById('sel-translate').click();
    await sleep(420);
    var canReplace = !document.getElementById('tr-replace').disabled;
    ok('可精确定位原文时「替换原文」可用', canReplace);
    if (canReplace) {
      document.getElementById('tr-replace').click();
      await sleep(120);
      var after = blkBy(/从零开始写的 Markdown 编辑器/);
      var raws = Editor.getState().model.blocks.map(function (b) { return b.raw; });
      ok('替换原文生效（raw 精确替换）',
         !after && raws.indexOf('MOCK-TRANSLATION(zh-Hans)') >= 0,
         after ? 'still-there' : 'replaced');
    }

    R.push('STEP 6 快捷键');
    // 6. 键盘快捷键 ⌘⇧Y
    var kb = blkBy(/字节级无损|空行数量/);
    if (kb) {
      selectEl(kb);
      await sleep(100);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', metaKey: true, shiftKey: true, bubbles: true }));
      await sleep(420);
      ok('⌘⇧Y 可触发翻译', panelShown() && out().indexOf('MOCK-TRANSLATION') >= 0, out().slice(0, 30));
      document.getElementById('tr-close').click();
    } else {
      ok('⌘⇧Y 可触发翻译', false, '找不到快捷键测试块');
    }

    R.push('STEP 6.5 源码模式');
    // 6.5 源码模式：选区翻译 + 替换
    Editor.toggleSource(true);
    var sta = document.getElementById('source-area');
    var sv = sta.value;
    var si = sv.indexOf('专注模式会把无关段落调暗');
    if (si >= 0) {
      sta.focus();
      sta.setSelectionRange(si, si + 12);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(120);
      document.getElementById('sel-translate').click();
      await sleep(420);
      ok('源码模式选区可翻译', out().indexOf('MOCK-TRANSLATION') >= 0, out().slice(0, 30));
      var canSrc = !document.getElementById('tr-replace').disabled;
      ok('源码模式替换可用', canSrc);
      if (canSrc) {
        document.getElementById('tr-replace').click();
        await sleep(100);
        ok('源码模式替换生效', sta.value.indexOf('MOCK-TRANSLATION') >= 0);
      }
    } else {
      ok('源码模式选区可翻译', false, '找不到源码测试文本');
    }
    Editor.toggleSource(false);
    await sleep(150);

    R.push('STEP 7 语言包');
    // 7. 语言包未安装 → 提示 + 下载按钮
    window.__mockMode = 'notInstalled';
    var lp = blkBy(/任务清单/);
    var dl = null;
    if (lp) {
      selectEl(lp);
      await sleep(100);
      document.getElementById('sel-translate').click();
      await sleep(420);
      dl = document.getElementById('tr-download');
      ok('未装语言包时给出下载入口', !!dl && out().indexOf('语言包') >= 0, out().slice(0, 40));
    } else {
      ok('未装语言包时给出下载入口', false, '找不到测试块');
    }
    if (dl) {
      dl.click();
      R.push('STEP 7b 已点下载');
      await sleep(420);
      R.push('STEP 7c sleep 完成 out=' + out().slice(0, 24));
      ok('点下载后自动重试（mock 成功）', out().indexOf('MOCK-TRANSLATION') >= 0 || window.__prepared === true);
    }
    window.__mockMode = 'ok';

    R.push('STEP 8 切语言');
    // 8. 切换目标语言会重新翻译（先把面板重新打开）
    var reblk = blkBy(/代码块带高亮|任务清单/);
    R.push('STEP 8a reblk=' + !!reblk);
    if (reblk) {
      selectEl(reblk);
      await sleep(100);
      R.push('STEP 8b 点击浮标');
      document.getElementById('sel-translate').click();
      await sleep(420);
      R.push('STEP 8c 面板=' + panelShown() + ' out=' + out().slice(0, 26));
    }
    document.getElementById('tr-target').value = 'ja';
    document.getElementById('tr-target').dispatchEvent(new Event('change'));
    R.push('STEP 8d change 已派发');
    await sleep(420);
    R.push('STEP 8e sleep 完成');
    ok('切换目标语言后重译', out().indexOf('MOCK-TRANSLATION(ja)') >= 0, out().slice(0, 40));
    ok('目标语言记忆到 localStorage',
       (function () { try { return localStorage.getItem('opentypora.translateTarget') === 'ja'; } catch (e) { return false; } })());

    R.push('STEP 9 复制');
    // 9. 复制
    document.getElementById('tr-copy').click();
    await sleep(80);
    ok('复制调用原生剪贴板', window.__copied === 'MOCK-TRANSLATION(ja)', String(window.__copied).slice(0, 30));

    R.push('STEP 10 源语言随请求下发');
    ok('源语言随请求传给原生', (window.__trCalls[0] || {}).source === 'en',
       JSON.stringify(window.__trCalls[0] || null));

    R.push('STEP 11 同语言短路');
    // 恢复脚本检测（不再强制 en），选一段中文、目标也是中文
    window.__trSource = '';
    document.getElementById('tr-target').value = 'zh-Hans';
    document.getElementById('tr-target').dispatchEvent(new Event('change'));
    await sleep(400);
    var zhBlk = blkBy(/直接在任意段落里点一下即可编辑/);
    if (zhBlk) {
      selectEl(zhBlk);
      await sleep(100);
      var callsBefore = window.__trCalls.length;
      document.getElementById('sel-translate').click();
      await sleep(400);
      ok('中文文本 + 中文目标：不再调用系统', window.__trCalls.length === callsBefore,
         'calls ' + callsBefore + '→' + window.__trCalls.length);
      ok('同语言时提示并给出改译入口',
         out().indexOf('不需要翻译') >= 0 && !!document.getElementById('tr-alt'), out().slice(0, 40));
      var altBtn = document.getElementById('tr-alt');
      if (altBtn) {
        altBtn.click();
        await sleep(400);
        ok('改译为英文生效', document.getElementById('tr-target').value === 'en' &&
           out().indexOf('MOCK-TRANSLATION(en)') >= 0, out().slice(0, 40));
      } else {
        ok('改译为英文生效', false, '没有改译按钮');
      }
    } else {
      ok('中文文本 + 中文目标：不再调用系统', false, '找不到中文测试块');
    }
    window.__trSource = 'en';

    clearTimeout(watchdog);
    report();
  }

  function report() {
    var fails = R.filter(function (l) { return l.indexOf('FAIL') === 0; }).length;
    var line = (R.length - fails) + '/' + R.length + (fails ? ' 失败 ' + fails : ' 全绿');
    var box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:999;margin:0;padding:8px 12px;' +
      'background:#0b0f14;color:#7ee787;font:11.5px/1.5 Menlo,monospace;border-radius:8px;' +
      'max-width:640px;max-height:64vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.45)';
    box.textContent = 'TRANSLATION ' + line + '\\n' + R.join('\\n');
    document.body.appendChild(box);
    window.__report = 'TRANSLATION ' + line + '\\n' + R.join('\\n');
    document.documentElement.setAttribute('data-report', window.__report);
    document.title = 'TR ' + line;
  }

  window.addEventListener('load', function () {
    window.onerror = function (msg, src, line) {
      R.push('JS错误 ' + msg + ' @' + line);
      if (!window.__report) report();
    };
    window.onunhandledrejection = function (e) {
      R.push('未处理的Promise拒绝 ' + (e && e.reason ? e.reason : ''));
      if (!window.__report) report();
    };
    run().catch(function (e) {
      R.push('FAIL 测试脚本异常 | ' + (e && e.message ? e.message : e) + (e && e.stack ? ' | ' + String(e.stack).split('\\n')[1] : ''));
      report();
    });
  });
})();
</script>
`;

const DEMO = `
<script>
window.addEventListener('load', function () {
  try { localStorage.clear(); } catch (e) {}
  setTimeout(function () {
    var bs = document.querySelectorAll('#editor .blk');
    var el = null;
    for (var i = 0; i < bs.length; i++) {
      if (/从零开始写的 Markdown 编辑器/.test(bs[i].textContent)) { el = bs[i]; break; }
    }
    if (!el) return;
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    setTimeout(function () { document.getElementById('sel-translate').click(); }, 400);
  }, 600);
});
</script>
`;

const DEMO_MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  translate: function (text, target) {
    return Promise.resolve({
      text: '一个从零编写的 Markdown 编辑器：块级所见即所得——光标落进哪个区块，哪个区块就显示出源码；移开光标立刻恢复排版。',
      sourceLang: 'en', targetLang: target
    });
  },
  prepareTranslation: function () { return Promise.resolve({ ok: true }); },
  translationStatus: function (t) { return Promise.resolve({ status: 'supported', target: t }); },
  openTranslationSettings: function () { return Promise.resolve(null); },
  copy: function () { return Promise.resolve(null); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  save: function () { return Promise.resolve({ path: '/tmp/__x.md' }); },
  confirm: function () { return Promise.resolve(true); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); },
  openThemeFolder: function () { return Promise.resolve(null); }
};
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
if (process.env.DEMO) {
  html = html.replace('<script src="js/bridge.js"></script>',
    '<script src="js/bridge.js"></script>\n' + DEMO_MOCK);
html = html.replace('</body>', function () { return DEMO + '\n</body>'; });
} else {
  html = html.replace('<script src="js/bridge.js"></script>',
    '<script src="js/bridge.js"></script>\n' + MOCK);
html = html.replace('</body>', function () { return TEST + '\n</body>'; });
}
fs.writeFileSync(OUT, html);
console.log('harness →', OUT);
