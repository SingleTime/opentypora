// caret.demo.js —— 专注模式（按光标块 + 近邻衰减）与打字机（按光标行居中）
// 出两张图：docs/opentypora-focus-typewriter.png（github）与 -night.png。
// 一张图里要同时看得出：光标行被钉在垂直中央、近邻块略淡、远景块明显变淡、
// 光标行底下有一条淡淡的强调色底。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__caret_demo.html');

const MOCK = `
<script>
try { localStorage.clear(); } catch (e) {}
window.Bridge = {
  available: true,
  ready: function () { return Promise.resolve({ file: null, content: '' }); },
  setTitle: function () { return Promise.resolve(null); },
  status: function () { return Promise.resolve(null); },
  setFile: function () { return Promise.resolve(null); },
  copy: function () { return Promise.resolve(null); },
  reveal: function () { return Promise.resolve(null); },
  openUrl: function () { return Promise.resolve(null); },
  listThemes: function () { return Promise.resolve({ dir: '/tmp/themes', themes: [] }); },
  readTheme: function () { return Promise.resolve({ css: '' }); }
};
</script>
`;

const DEMO = `
<script>
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function run() {
    await sleep(420);

    // 光标块必须落得够靠下，否则「居中」会被 scrollTop=0 夹住，
    // 截图里就成了「光标行在屏幕上方」—— 那不是失效，是没有余量。
    var src = [
      '# 写作时的注意力',
      '',
      '这一段在光标的上方，应该明显变淡。它离光标隔了好几块，属于远景。',
      '',
      '## 背景',
      '',
      '写长文档时最难受的不是没有素材，而是屏幕上同时有太多东西，' +
      '眼睛一直在找「我刚才写到哪了」。专注模式就是把无关的部分压下去，' +
      '只留下光标这一块和它的前后各一块。',
      '',
      '把非当前内容压到同一个透明度也不行，读起来会失去方位感 —— ' +
      '前后各留一块做过渡，视线才有落点。',
      '',
      '## 做法',
      '',
      '紧挨着光标的前一段，亮度居中偏淡 —— 这是近邻档。',
      '',
      '把光标放在这一段中间，正文会整体滚上来，让这一行的中心落在视口正中。' +
      '段落本身有点长，折成好几行之后，居中要按行来算而不是按整块算，' +
      '否则后半段的行会一路往下漂，写着写着就跑到屏幕底部去了。' +
      '这一段故意写长一些，就是为了把折行这件事暴露出来。' +
      '再补一句，让它稳定地占满四到五行，截图里能看出光标行的位置。',
      '',
      '这是光标下面紧挨着的一段，同样是近邻档。',
      '',
      '再往下就进入远景，读到的时候自然会把注意力收回来。',
      '',
      '## 为什么按行算',
      '',
      '整块居中在多行块里会失效：块首落在中间，块尾就跑到屏幕下方。',
      '',
      '## 为什么分三档',
      '',
      '一刀切把非当前内容压到同一个透明度，读起来会失去方位感；',
      '前后各留一块做过渡，视线才有落点。',
      '',
      '最后一段，收尾。',
      ''
    ].join('\\n');

    Editor.load(src, '/Users/fw/注意力.md', '注意力.md');
    await sleep(300);

    Editor.setFocus(true);
    Editor.setTypewriter(true);
    await sleep(120);

    // 找到那段长文（它现在排在若干小节之后），光标放在第二句之后
    var li = 0;
    for (var i = 0; i < Editor.blockCount(); i++) {
      if (Editor.getRaw(i).indexOf('把光标放在这一段中间') >= 0) { li = i; break; }
    }
    var raw = Editor.getRaw(li);
    var off = raw.indexOf('段落本身有点长');
    Editor.enterEdit(li, off > 0 ? off + 6 : Math.floor(raw.length / 2));
    await sleep(400);

    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT));
