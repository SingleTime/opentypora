// spell.demo.js —— 渲染态拼写波浪线 + 右键建议菜单
// 出两张图：docs/opentypora-spell.png（github）与 -night.png。
//
// 注意：demo 跑在 build/shot 的裸 WKWebView 里，没有原生桥，所以词典用桩
// （只认图上出现的几个错词）。真机上这一层走 NSSpellChecker，判定与
// textarea 的原生红波浪线一致 —— 见 native/spell.swift。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'index.html');
const OUT = path.join(ROOT, 'app', '__spell_demo.html');
const THEME = process.argv[2] || 'github';

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

  var BAD = { coloumn: 1, recieve: 1, seperate: 1, arguement: 1, occured: 1 };
  var SUG = {
    recieve: ['receive', 'relieve'],
    coloumn: ['column', 'columnar'],
    seperate: ['separate'],
    arguement: ['argument'],
    occured: ['occurred']
  };

  async function run() {
    await sleep(420);
    if ('${THEME}' !== 'github') { try { Editor.setTheme('${THEME}'); } catch (e) {} }

    var src = [
      '# 写完再回头看拼写',
      '',
      '渲染态的块是一堆 div，系统的拼写检查只认 textarea，所以把光标挪出去之后' +
      '红线就全没了 —— 这正是这一轮要补的洞。',
      '',
      '现在每个块都会被切词，批量问一次系统词典，命中的词画一条波浪线；' +
      '点右键能拿到建议词，也能把这类专有名词加进忽略表。',
      '',
      'A paragraph with a few typical mistakes: the coloumn width is wrong, ' +
      'we recieve the siggnals late, and the results occured in two seperate runs.',
      '',
      '\\u0060inline code\\u0060 里的词不参与检查 —— 那里面的标识符本来就不是英文单词。',
      '',
      '\\u0060\\u0060\\u0060js',
      'const recieve = fetch(url);   // 围栏代码块同样跳过',
      '\\u0060\\u0060\\u0060',
      '',
      '中文段落里夹一个 arguement 也只标那个词，其余照常读。',
      '',
      '## 右键建议',
      '',
      '在带波浪线的词上点右键，菜单里是系统词典给的候选词，' +
      '最下面一项是「忽略此词」，会写进偏好，下次打开也不再标。',
      ''
    ].join('\\n');

    Editor.load(src, '/Users/fw/拼写.md', '拼写.md');
    await sleep(300);

    Spell.setEngine(function (words, ignore) {
      var out = [];
      words.forEach(function (w, i) {
        if (BAD[w.toLowerCase()] && (ignore || []).indexOf(w.toLowerCase()) < 0) out.push(i);
      });
      return Promise.resolve(out);
    });
    Spell.setGuesses(function (w) { return Promise.resolve(SUG[w] || []); });
    Spell.setEnabled(true);
    await sleep(400);

    // 把菜单开在第二个波浪线上（recieve），位置取它的真实矩形
    var list = Array.prototype.slice.call(document.querySelectorAll('#editor .spell-bad'));
    var target = list.filter(function (s) { return s.textContent === 'recieve'; })[0] || list[1];
    if (target) {
      var r = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.bottom)
      }));
    }
    await sleep(260);
    window.__demoReady = true;
  }
  window.addEventListener('load', function () { setTimeout(run, 60); });
})();
</script>
`;

let html = fs.readFileSync(SRC, 'utf8');
html = html.replace('</body>', function () { return MOCK + DEMO + '\n</body>'; });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (theme=' + THEME + ')');
