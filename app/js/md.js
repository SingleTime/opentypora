/* ============================================================
 * md.js — Markdown 解析与渲染核心（无 DOM 依赖，可 Node 单测）
 * 输出 HTML 字符串。块级元素带 data-i（块序号），
 * 行内文本片段带 data-s（在整篇源码中的绝对偏移），
 * 供编辑引擎做「点击渲染内容 → 精确定位源码光标」。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CUR_DEFS = {};      // 当前渲染文档的引用式链接定义表（renderBlock 每块刷新）
  var CODE_LINENO = false;  // 代码块行号（偏好项，Editor.setTyping 打开）
  // 严格模式：只认「基础 Markdown」，关掉高亮 / 上下标 / Emoji / [[wiki]] / Callout
  // 这类扩展语法（表格、脚注、任务列表、数学、[TOC] 保留 —— 这些已是通用基础设施）。
  var STRICT = false;
  var EMOJI_NAMES = null;   // emojiNames() 的缓存（表不变，算一次就够）
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; }); }

  /* ---------------------------------------------------------- 行工具 */
  function splitLines(src) {
    var out = [], start = 0;
    for (var i = 0; i < src.length; i++) {
      if (src.charCodeAt(i) === 10) { out.push({ text: src.slice(start, i), start: start }); start = i + 1; }
    }
    out.push({ text: src.slice(start), start: start });
    return out;
  }
  function indentWidth(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === ' ') n += 1;
      else if (s[i] === '\t') n += 4;
      else break;
    }
    return n;
  }
  var RE_BLANK = /^[ \t]*$/;
  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  /* 开围栏判定：反引号围栏的 info string 里不能再有反引号（CommonMark）。
   * 少了这一条，` ```` ```flow ```` `（用四个反引号包住三个反引号的内联代码）会被当成
   * 开围栏，把后面整篇吞进代码块里 —— README 的 LaTeX 导出就是这样整段变成 verbatim 的。 */
  function fenceOf(line) {
    var m = RE_FENCE.exec(line);
    if (!m) return null;
    if (m[1].charAt(0) === '`' && m[2].indexOf('`') >= 0) return null;
    return m;
  }
  var RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
  // 容错档：`#` 后不强制空格（关闭严格模式时的行为）。
  // (?!#) 挡住 `#######x` 这种七个以上 # 的行——CommonMark 里它不是标题。
  var RE_ATX_LOOSE = /^ {0,3}(#{1,6})(?!#)[ \t]*(.*?)[ \t]*$/;
  // 严格模式：标题必须在 # 后放空白（###Header 不算标题）；
  // 关闭严格模式时容错（###Header 也是标题）。两档都返回同样的分组结构。
  function atxOf(text) {
    return (STRICT ? RE_ATX : RE_ATX_LOOSE).exec(text);
  }
  var RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)([\s\S]*)$/;
  var RE_SETEQ1 = /^ {0,3}=+[ \t]*$/;
  var RE_SETEQ2 = /^ {0,3}-+[ \t]*$/;
  var RE_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
  var RE_MATH_FENCE = /^ {0,3}\$\$[ \t]*$/;
  // 单行写法 $$E=mc^2$$（两种写法都认；这里要求整行只有这一条公式）
  var RE_MATH_ONELINE = /^ {0,3}\$\$(?!\s*$)([\s\S]*?)\$\$[ \t]*$/;
  // 只认「完整标签」开头的 HTML 块，避免把 <https://x.com> 误判为 HTML
  var RE_HTML = /^ {0,3}(?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<!--|<!\[CDATA\[|<\?)/;
  var RE_FM = /^---[ \t]*$/;
  // [TOC] 目录占位块（独占一行，大小写不敏感）
  var RE_TOC = /^ {0,3}\[toc\][ \t]*$/i;
  // 脚注定义 [^id]: 内容
  var RE_FOOTDEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
  // 引用式链接定义 [id]: url "title"（id 不能以 ^ 开头，那是脚注）
  var RE_LINKDEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;

  /* ---------------------------------------------------------- Emoji
   * GitHub 风格的 :shortcode:。表只收录写作里常见的，够用且不必联网。
   * 别名（+1 / -1 / thumbsup…）与主名一起查。
   */
  var EMOJI = {
    smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', laughing: '😆', sweat_smile: '😅',
    joy: '😂', rofl: '🤣', slightly_smiling_face: '🙂', upside_down_face: '🙃', wink: '😉',
    blush: '😊', innocent: '😇', heart_eyes: '😍', kissing_heart: '😘', yum: '😋',
    stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜', zany_face: '🤪',
    thinking: '🤔', raised_eyebrow: '🤨', neutral_face: '😐', expressionless: '😑',
    no_mouth: '😶', smirk: '😏', unamused: '😒', roll_eyes: '🙄', grimacing: '😬',
    relieved: '😌', pensive: '😔', sleepy: '😪', sleeping: '😴', mask: '😷',
    face_with_thermometer: '🤒', nauseated_face: '🤢', sneezing_face: '🤧', dizzy_face: '😵',
    cold_sweat: '😰', sweat: '😓', sob: '😭', cry: '😢', scream: '😱', confounded: '😖',
    persevere: '😣', disappointed: '😞', angry: '😠', rage: '😡', pout: '😡',
    triumph: '😤', confetti_ball: '🎊', tada: '🎉', sparkles: '✨', star: '⭐',
    star2: '🌟', zap: '⚡', fire: '🔥', boom: '💥', collision: '💥', droplet: '💧',
    wave: '👋', raised_hand: '✋', ok_hand: '👌', v: '✌️', crossed_fingers: '🤞',
    metal: '🤘', call_me_hand: '🤙', point_left: '👈', point_right: '👉',
    point_up: '☝️', point_down: '👇', thumbsup: '👍', '+1': '👍', thumbsdown: '👎',
    '-1': '👎', fist: '✊', fist_raised: '✊', punch: '👊', clap: '👏', pray: '🙏',
    handshake: '🤝', muscle: '💪', eyes: '👀', eye: '👁️', brain: '🧠',
    heart: '❤️', broken_heart: '💔', two_hearts: '💕', sparkling_heart: '💖',
    blue_heart: '💙', green_heart: '💚', yellow_heart: '💛', purple_heart: '💜',
    black_heart: '🖤', white_heart: '🤍', orange_heart: '🧡', hundred: '💯',
    check: '✔️', heavy_check_mark: '✔️', white_check_mark: '✅', x: '❌',
    negative_squared_cross_mark: '❎', question: '❓', exclamation: '❗',
    warning: '⚠️', no_entry: '⛔', no_entry_sign: '🚫', stop_sign: '🛑',
    info: 'ℹ️', bulb: '💡', memo: '📝', pencil: '📝', pencil2: '✏️', pen: '🖊️',
    book: '📖', books: '📚', bookmark: '🔖', newspaper: '📰', clipboard: '📋',
    file_folder: '📁', open_file_folder: '📂', page_facing_up: '📄', paperclip: '📎',
    pushpin: '📌', round_pushpin: '📍', link: '🔗', lock: '🔒', unlock: '🔓',
    key: '🔑', mag: '🔍', mag_right: '🔎', hammer: '🔨', wrench: '🔧',
    gear: '⚙️', toolbox: '🧰', shield: '🛡️', package: '📦', inbox_tray: '📥',
    rocket: '🚀', airplane: '✈️', car: '🚗', bike: '🚲', train: '🚆',
    hourglass: '⌛', alarm_clock: '⏰', stopwatch: '⏱️', calendar: '📅',
    date: '📅', clock1: '🕐', timer_clock: '⏲️', hourglass_flowing_sand: '⏳',
    computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️', iphone: '📱',
    phone: '☎️', telephone: '☎️', battery: '🔋', electric_plug: '🔌', cd: '💿',
    floppy_disk: '💾', save: '💾', email: '📧', envelope: '✉️', incoming_envelope: '📨',
    outbox_tray: '📤', printer: '🖨️', camera: '📷', video_camera: '📹',
    tv: '📺', radio: '📻', microphone: '🎤', headphones: '🎧', musical_note: '🎵',
    notes: '🎶', art: '🎨', clapper: '🎬', game_die: '🎲', dart: '🎯',
    trophy: '🏆', medal_sports: '🏅', first_place: '🥇', second_place: '🥈',
    third_place: '🥉', soccer: '⚽', basketball: '🏀', football: '🏈',
    tennis: '🎾', golf: '⛳', skiing: '⛷️', swimming: '🏊', runner: '🏃',
    sun: '☀️', sunny: '☀️', cloud: '☁️', cloud_with_rain: '🌧️', umbrella: '☔',
    snowflake: '❄️', snowman: '⛄', rainbow: '🌈', ocean: '🌊', earth: '🌍',
    globe_with_meridians: '🌐', moon: '🌙', crescent_moon: '🌙', full_moon: '🌕',
    seedling: '🌱', evergreen_tree: '🌲', deciduous_tree: '🌳', palm_tree: '🌴',
    cactus: '🌵', tulip: '🌷', rose: '🌹', sunflower: '🌻', cherry_blossom: '🌸',
    four_leaf_clover: '🍀', maple_leaf: '🍁', fallen_leaf: '🍂', leaf: '🍃',
    coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷',
    cocktail: '🍸', pizza: '🍕', hamburger: '🍔', fries: '🍟', sushi: '🍣',
    cake: '🍰', birthday: '🎂', cookie: '🍪', chocolate_bar: '🍫', candy: '🍬',
    apple: '🍎', green_apple: '🍏', banana: '🍌', grapes: '🍇', watermelon: '🍉',
    lemon: '🍋', peach: '🍑', cherry: '🍒', strawberry: '🍓', corn: '🌽',
    bread: '🍞', cheese: '🧀', egg: '🥚', rice: '🍚', noodles: '🍜',
    cat: '🐱', dog: '🐶', mouse: '🐭', hamster: '🐹', rabbit: '🐰', fox: '🦊',
    bear: '🐻', panda_face: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁',
    cow: '🐮', pig: '🐷', frog: '🐸', monkey: '🐵', chicken: '🐔', penguin: '🐧',
    bird: '🐦', baby_chick: '🐤', duck: '🦆', eagle: '🦅', owl: '🦉', bat: '🦇',
    wolf: '🐺', boar: '🐗', horse: '🐴', unicorn: '🦄', bee: '🐝', bug: '🐛',
    butterfly: '🦋', snail: '🐌', beetle: '🪲', ant: '🐜', spider: '🕷️',
    turtle: '🐢', snake: '🐍', lizard: '🦎', octopus: '🐙', fish: '🐟',
    tropical_fish: '🐠', whale: '🐳', dolphin: '🐬', shark: '🦈', crocodile: '🐊',
    dragon: '🐉', '100': '💯', ok: '🆗', new: '🆕', free: '🆓', up: '🆙',
    cool: '🆒', soon: '🔜', top: '🔝', arrow_up: '⬆️', arrow_down: '⬇️',
    arrow_left: '⬅️', arrow_right: '➡️', arrows_counterclockwise: '🔄',
    recycle: '♻️', white_circle: '⚪', black_circle: '⚫', red_circle: '🔴',
    large_blue_circle: '🔵', large_green_circle: '🟢', large_yellow_circle: '🟡',
    heavy_plus_sign: '➕', heavy_minus_sign: '➖', heavy_multiplication_x: '✖️',
    heavy_division_sign: '➗', infinity: '♾️', copyright: '©️', registered: '®️',
    tm: '™️', hash: '＃', asterisk: '＊', zero: '0️⃣', one: '1️⃣', two: '2️⃣',
    three: '3️⃣', four: '4️⃣', five: '5️⃣', six: '6️⃣', seven: '7️⃣', eight: '8️⃣',
    nine: '9️⃣', keycap_ten: '🔟'
  };
  var RE_EMOJI = /^:([a-zA-Z0-9_+\-]+):/;

  // 语言选择器（只保留写作里最常出现的）
  var CODE_LANGS = [
    ['text', 'Plain Text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
    ['css', 'CSS'], ['diff', 'Diff'], ['flow', 'Flowchart'],
    ['go', 'Go'], ['html', 'HTML'], ['java', 'Java'],
    ['javascript', 'JavaScript'], ['json', 'JSON'], ['jsx', 'JSX'], ['kotlin', 'Kotlin'],
    ['latex', 'LaTeX'], ['lua', 'Lua'], ['markdown', 'Markdown'], ['mermaid', 'Mermaid'],
    ['objectivec', 'Objective-C'], ['php', 'PHP'], ['python', 'Python'], ['r', 'R'],
    ['ruby', 'Ruby'], ['rust', 'Rust'], ['scss', 'SCSS'], ['shell', 'Shell'], ['sql', 'SQL'],
    ['swift', 'Swift'], ['toml', 'TOML'], ['tsx', 'TSX'], ['typescript', 'TypeScript'],
    ['xml', 'XML'], ['yaml', 'YAML']
  ];

  /* 代码围栏里写的语言常常是别名（`js` / `py` / `sh` / `yml`…）。
   * 高亮器本来就有别名兜底，但下拉要把「当前语言」选中就得先归一，
   * 否则 ```js 块的下拉会掉回 Plain Text —— 看着像语言丢了。 */
  var LANG_ALIAS = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    sh: 'bash', zsh: 'bash', shell: 'bash', yml: 'yaml',
    'c++': 'cpp', 'c#': 'csharp', 'objc': 'objectivec', md: 'markdown'
  };

  function langKey(l) {
    var n = String(l == null ? '' : l).toLowerCase();
    return LANG_ALIAS[n] || n;
  }

  var CALLOUT = {
    note: { title: 'Note', icon: 'ℹ' },
    tip: { title: 'Tip', icon: '💡' },
    important: { title: 'Important', icon: '❗' },
    warning: { title: 'Warning', icon: '⚠' },
    caution: { title: 'Caution', icon: '🛑' }
  };

  /* ---------------------------------------------------------- HTML 块
   * 判块边界只看两件事：这个标签是不是「容器」，以及它有没有配对闭合。
   * 容器（div/table/details…）一路找到配平为止，内部允许空行 ——
   * 否则 <div> … 空行 … </div> 会被切成三个互不相干的块。
   */
  var HTML_CONTAINER = {
    div: 1, center: 1, section: 1, article: 1, aside: 1, header: 1, footer: 1, main: 1,
    nav: 1, figure: 1, figcaption: 1, details: 1, summary: 1, blockquote: 1,
    table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1, caption: 1, colgroup: 1,
    dl: 1, dt: 1, dd: 1, ol: 1, ul: 1, li: 1, form: 1, fieldset: 1, legend: 1,
    iframe: 1, video: 1, audio: 1, canvas: 1, svg: 1, math: 1, object: 1, picture: 1,
    p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, address: 1, ruby: 1
  };

  // 返回 HTML 块的结束行（不含）；-1 表示「判不出」，交给空行规则
  function htmlEndLine(lines, i) {
    var t = lines[i].text;

    // 注释：一直收到 -->
    var ci = t.indexOf('<!--');
    if (ci >= 0) {
      if (t.indexOf('-->', ci + 4) >= 0) return i + 1;
      for (var k = i + 1; k < lines.length; k++) {
        if (lines[k].text.indexOf('-->') >= 0) return k + 1;
      }
      return -1;
    }

    // 内容原样收的标签：里面有 < > 也有空行，只能按闭合标签截
    var rm = /^ {0,3}<(script|style|textarea|pre)\b/i.exec(t);
    if (rm) {
      var close = '</' + rm[1].toLowerCase();
      for (var k2 = i; k2 < lines.length; k2++) {
        var s2 = lines[k2].text.toLowerCase();
        var at = s2.indexOf(close);
        if (at >= 0 && (k2 > i || at > 4)) return k2 + 1;
      }
      return -1;
    }

    var om = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?>/.exec(t);
    if (!om) return -1;
    var tag = om[1].toLowerCase();
    if (!HTML_CONTAINER[tag]) return -1;             // 叶子标签走空行规则
    if (/\/[ \t]*>$/.test(om[0])) return i + 1;      // <div …/> 自闭合

    // 同名标签配对计数（按行内出现顺序算，避免 </div><div> 这种算反）
    var tagRe = new RegExp('<(/?)' + tag + '(?=[\\s/>])[^<>]*?(/?)>', 'gi');
    var depth = 0;
    for (var j = i; j < lines.length; j++) {
      var line = lines[j].text, m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line))) {
        if (m[1]) depth--;
        else if (!m[2]) depth++;
        if (depth <= 0) return j + 1;
      }
    }
    return -1;
  }

  /* 干净的 HTML 子集：去掉脚本与事件属性。
   * 这不是安全沙箱（本地编辑器打开本地文档），目的是别让文档把编辑器自己带崩：
   * <script> 会污染 window，onerror/onclick 会在渲染时执行。 */
  function cleanHTML(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
    s = s.replace(/<script\b[^>]*>/gi, '');
    s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/\s(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
    return s;
  }

  /* 让浏览器把标签配平：作者写了没闭合的 <div> 会吞掉后面所有块。
   * DOMParser 建的是惰性文档 —— 不加载图片、不执行脚本，只借它的容错能力。 */
  function balanceHTML(html) {
    if (typeof DOMParser === 'undefined') return html;
    try {
      var doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
      return doc.body ? doc.body.innerHTML : html;
    } catch (e) { return html; }
  }

  /* 转成别的格式（docx / ePub / LaTeX）时没有「HTML 节点」这回事，只留文字。
   * 换行标签先变成 \n，否则 <div>a<br>b</div> 会粘成 "ab"。 */
  function htmlText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|figure|pre|table)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------------------------------------------------------- 行内渲染 */

  // 生成一个带源码定位的文本片段
  function tx(text, off) {
    if (!text) return '';
    return '<span data-s="' + off + '">' + esc(text) + '</span>';
  }

  /* ---------------------------------------------------------- 图片
   * 支持图片尺寸写法：`![alt](a.png =300x200)` / `=300x` / `=x200`，
   * 以及 `<带 空格 的路径.png>` 和 "title"。用扫描而不是一条大正则：
   * 路径里可能出现括号（转义），正则很容易在这里截断。
   */
  function readImage(str, i) {
    if (str[i] !== '!' || str[i + 1] !== '[') return null;
    var k = str.indexOf(']', i + 2);
    if (k < 0 || str[k + 1] !== '(') return null;
    var alt = str.slice(i + 2, k);
    var j = k + 2, depth = 1, buf = '';
    for (; j < str.length; j++) {
      var ch = str[j];
      if (ch === '\\' && j + 1 < str.length) { buf += ch + str[j + 1]; j++; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (!depth) break; }
      buf += ch;
    }
    if (depth !== 0) return null;

    var inner = buf.trim(), path = '', title = '', w = 0, h = 0;
    if (inner[0] === '<') {
      var gt = inner.indexOf('>');
      if (gt < 0) return null;
      path = inner.slice(1, gt);
      inner = inner.slice(gt + 1).trim();
    } else {
      var sp = inner.search(/\s/);
      if (sp < 0) { path = inner; inner = ''; }
      else { path = inner.slice(0, sp); inner = inner.slice(sp).trim(); }
    }
    if (!path) return null;

    var tm = /^(["'])([\s\S]*?)\1/.exec(inner);
    if (tm) { title = tm[2]; inner = inner.slice(tm[0].length).trim(); }

    var sm = /^=\s*(\d*)\s*[xX]\s*(\d*)\s*$/.exec(inner);
    if (sm) {
      w = parseInt(sm[1] || '0', 10) || 0;
      h = parseInt(sm[2] || '0', 10) || 0;
      if (!w && !h) { w = 0; h = 0; }
    } else {
      var sw = /^=\s*(\d+)\s*$/.exec(inner);
      if (sw) w = parseInt(sw[1], 10) || 0;
    }

    return { raw: str.slice(i, j + 1), alt: alt, src: path, title: title, w: w, h: h };
  }

  function imgSizeStyle(w, h) {
    if (!w && !h) return '';
    if (w && h) return 'width:' + w + 'px;height:' + h + 'px';
    if (w) return 'width:' + w + 'px;height:auto';
    return 'height:' + h + 'px;width:auto';
  }

  /* wiki 链接 [[目标]] / [[目标|显示文字]]
   * - 目标以 # 开头 → 指向本文内的标题（[[#小节]]）
   * - 管道可以用 \| 转义，目标里本来就有 | 时靠它区分
   * 返回的 labelStart 是「显示文字」在 src 里的相对偏移，行内样式还能继续解析。 */
  function readWiki(str, i) {
    if (str[i] !== '[' || str[i + 1] !== '[') return null;
    var j = i + 2, buf = '';
    for (; j < str.length; j++) {
      var ch = str[j];
      if (ch === '\\' && j + 1 < str.length) { buf += ch + str[j + 1]; j++; continue; }
      if (ch === '\n') return null;                       // 不许跨行
      if (ch === ']' && str[j + 1] === ']') break;
      buf += ch;
    }
    if (j >= str.length || !buf.trim()) return null;

    var cut = -1;
    for (var k = 0; k < buf.length; k++) {
      if (buf[k] === '|' && buf[k - 1] !== '\\') { cut = k; break; }
    }
    var tRaw = cut < 0 ? buf : buf.slice(0, cut);
    var lRaw = cut < 0 ? buf : buf.slice(cut + 1);
    var target = tRaw.replace(/\\\|/g, '|').trim();
    var label = lRaw.replace(/\\\|/g, '|').trim();
    if (!target) return null;
    if (!label) label = target;

    var lead = 0;
    while (lRaw[lead] === ' ' || lRaw[lead] === '\t') lead++;
    var labelStart = cut < 0 ? lead : cut + 1 + lead;

    // [[#小节]] 显示成「小节」：锚点符号是语法，不是标题的一部分
    if (target.charAt(0) === '#' && cut < 0) {
      label = target.slice(1);
      labelStart = lead + 1;
    }

    return {
      raw: str.slice(i, j + 2), target: target, label: label,
      labelStart: labelStart, anchor: target.charAt(0) === '#'
    };
  }

  /* 目标 → href：没有扩展名的补 .md，纯锚点原样 */
  function wikiHref(target) {
    var t = String(target == null ? '' : target);
    if (!t || t.charAt(0) === '#') return t;
    var hash = t.indexOf('#');
    var path = hash < 0 ? t : t.slice(0, hash);
    var tail = hash < 0 ? '' : t.slice(hash);
    var seg = path.slice(path.lastIndexOf('/') + 1);
    if (seg && seg.indexOf('.') < 0) path += '.md';
    return path + tail;
  }

  /* ---------------------------------------------------------- 引用式链接
   * `[文字][id]` / `[文字][]` / `[文字]` 都按 id 查定义表；定义行本身不渲染。
   * 定义在全文范围生效，所以先扫一遍再解析块 —— 引用可以出现在定义之前。
   */
  // 行首是行内标签（<span>/<u>/<kbd>…）时按段落处理，交给行内解析器
  function isHtmlBlock(t) {
    if (!RE_HTML.test(t)) return false;
    var m = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)/.exec(t);
    if (m) {
      var n = m[1].toLowerCase();
      if (INLINE_TAGS[n] || VOID_TAGS[n]) return false;
    }
    return true;
  }

  function scanLinkDefs(src) {
    var defs = {};
    var lines = splitLines(String(src == null ? '' : src));
    for (var i = 0; i < lines.length; i++) {
      var m = RE_LINKDEF.exec(lines[i].text);
      if (!m) continue;
      var id = m[1].trim().toLowerCase();
      if (!id) continue;
      defs[id] = { href: m[2], title: m[3] || m[4] || m[5] || '' };
    }
    return defs;
  }

  /* 裸 URL / www. 自动链接。行尾标点不算链接的一部分；右括号要成对。 */
  function readBareUrl(str, i) {
    var prev = i > 0 ? str[i - 1] : '';
    if (prev && /[A-Za-z0-9@._\-\/&]/.test(prev)) return null;
    var m = /^(https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+)/i.exec(str.slice(i));
    var text = '', href = '';
    if (m) { text = m[1]; href = m[1]; }
    else {
      var w = /^www\.[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+/i.exec(str.slice(i));
      if (!w) return null;
      if (!/^www\.[^.\s/]+\.[a-z]{2,}/i.test(w[0])) return null;
      text = w[0]; href = 'http://' + text;
    }
    var t = text;
    for (; t.length; ) {
      var last = t[t.length - 1];
      if (/[.,;:!?'"”’]/.test(last)) { t = t.slice(0, -1); continue; }
      if (last === ')') {
        var open = (t.match(/\(/g) || []).length, close = (t.match(/\)/g) || []).length;
        if (close > open) { t = t.slice(0, -1); continue; }
      }
      break;
    }
    if (!t || t === 'http://' || t === 'https://') return null;
    if (!href || href === text || /^https?:\/\/$/.test(href)) href = t;
    return { raw: t, href: href };
  }

  /* ---------------------------------------------------------- 行内 HTML
   * 只放行排版类标签，事件属性与 javascript: 一律剥掉（同 HTML 块的消毒口径）。
   */
  var INLINE_TAGS = {
    a: 1, abbr: 1, b: 1, bdi: 1, bdo: 1, cite: 1, code: 1, del: 1, dfn: 1, em: 1,
    font: 1, i: 1, ins: 1, kbd: 1, mark: 1, q: 1, s: 1, samp: 1, small: 1, span: 1,
    strike: 1, strong: 1, sub: 1, sup: 1, time: 1, tt: 1, u: 1, var: 1
  };
  var VOID_TAGS = { br: 1, wbr: 1 };

  function sanitizeAttrs(attrStr) {
    var out = '', re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, m;
    while ((m = re.exec(attrStr))) {
      var name = m[1].toLowerCase();
      var val = m[3] != null ? m[3] : (m[4] != null ? m[4] : m[5] || '');
      if (/^on/.test(name)) continue;
      if (name === 'style' && /expression|javascript:|url\s*\(/i.test(val)) continue;
      if ((name === 'href' || name === 'src') && /^\s*(javascript|vbscript|data:text\/html):/i.test(val)) continue;
      out += ' ' + name + '="' + esc(val) + '"';
    }
    return out;
  }

  // 在 src[i] 处读一个行内标签；返回 {tag, attrs, void, raw} 或 null
  function readInlineTag(src, i) {
    var m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*?)?)(\/?)>/.exec(src.slice(i));
    if (!m) return null;
    var name = m[2].toLowerCase();
    if (!INLINE_TAGS[name] && !VOID_TAGS[name]) return null;
    return { close: m[1] === '/', tag: name, attrs: m[3] || '', selfClose: !!m[4], raw: m[0] };
  }

  function imgTag(im, off) {
    var sz = imgSizeStyle(im.w, im.h);
    return '<img data-s="' + off + '" src="' + esc(im.src) + '" alt="' + esc(im.alt) + '"' +
      (im.title ? ' title="' + esc(im.title) + '"' : '') +
      (sz ? ' style="' + sz + '" data-w="' + im.w + '" data-h="' + im.h + '"' : '') + '>';
  }

  function renderInline(src, base, defs) {
    base = base || 0;
    defs = defs || CUR_DEFS || (CUR_DEFS = {});
    var out = '';
    var i = 0;
    var buf = '', bufStart = 0;

    function flush() {
      if (buf) { out += tx(buf, base + bufStart); buf = ''; }
    }
    function push(html) { flush(); out += html; }

    while (i < src.length) {
      var c = src[i];

      // 反斜杠转义
      if (c === '\\' && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!~>|=<$%]/.test(src[i + 1])) {
        if (!buf) bufStart = i;
        buf += src[i + 1]; i += 2; continue;
      }
      // 行内代码
      if (c === '`') {
        var m = /^(`+)([\s\S]*?)\1/.exec(src.slice(i));
        if (m) {
          push('<code data-s="' + (base + i) + '">' + esc(m[2].replace(/^ (.*) $/, '$1')) + '</code>');
          i += m[0].length; continue;
        }
      }
      // 图片（支持 =WxH 尺寸写法）
      if (c === '!' && src[i + 1] === '[') {
        var im = readImage(src, i);
        if (im) {
          push(imgTag(im, base + i));
          i += im.raw.length; continue;
        }
        // 引用式图片 ![alt][id] / ![alt][]
        var rim = /^!\[([^\]]*)\]\[([^\]]*)\]/.exec(src.slice(i));
        if (rim) {
          var rid = (rim[2] || rim[1]).trim().toLowerCase();
          var rdef = defs[rid];
          if (rdef) {
            push(imgTag({ src: rdef.href, alt: rim[1], title: rdef.title, w: 0, h: 0 }, base + i));
            i += rim[0].length; continue;
          }
        }
      }
      // wiki 链接 [[目标|显示文字]]（排在脚注与普通链接之前：[[ 会被 [text] 规则拆坏）
      if (!STRICT && c === '[' && src[i + 1] === '[') {
        var wk = readWiki(src, i);
        if (wk) {
          push('<a class="wiki-link" data-s="' + (base + i) + '" data-wiki="' + esc(wk.target) +
            '"' + (wk.anchor ? ' data-wiki-anchor="1"' : '') +
            ' href="' + esc(wikiHref(wk.target)) + '">' +
            renderInline(wk.label, base + i + wk.labelStart, defs) + '</a>');
          i += wk.raw.length; continue;
        }
      }
      // 脚注引用 [^id]（必须排在普通链接前面：普通链接要求 ]( 紧跟）
      if (c === '[' && src[i + 1] === '^') {
        var fnm = /^\[\^([^\]\s]+)\]/.exec(src.slice(i));
        if (fnm) {
          push('<sup class="fn-ref" data-fn="' + esc(fnm[1]) + '" data-s="' + (base + i) + '">' +
            esc(fnm[1]) + '</sup>');
          i += fnm[0].length; continue;
        }
      }
      // 链接
      if (c === '[') {
        var lm = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src.slice(i));
        if (lm) {
          push('<a data-s="' + (base + i) + '" href="' + esc(lm[2]) + '"' +
            (lm[3] ? ' title="' + esc(lm[3]) + '"' : '') + '>' + renderInline(lm[1], base + i + 1, defs) + '</a>');
          i += lm[0].length; continue;
        }
        // 引用式链接 [text][id] / [text][] / [text]
        var rl = /^\[([^\]]*)\](?:\[([^\]]*)\])?/.exec(src.slice(i));
        if (rl) {
          var label = rl[1];
          var lid = (rl[2] == null || rl[2] === '' ? label : rl[2]).trim().toLowerCase();
          var ldef = lid ? defs[lid] : null;
          if (ldef) {
            push('<a data-s="' + (base + i) + '" href="' + esc(ldef.href) + '"' +
              (ldef.title ? ' title="' + esc(ldef.title) + '"' : '') + '>' +
              renderInline(label, base + i + 1, defs) + '</a>');
            i += rl[0].length; continue;
          }
        }
      }
      // 自动链接 <http://...>
      if (c === '<') {
        var am = /^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/.exec(src.slice(i));
        if (am) {
          push('<a data-s="' + (base + i) + '" href="' + esc(am[1]) + '">' + esc(am[1]) + '</a>');
          i += am[0].length; continue;
        }
        // 行内 HTML：放行排版标签，内容继续按 Markdown 解析
        var it = readInlineTag(src, i);
        if (it) {
          if (it.close) { i += it.raw.length; continue; }   // 孤立的闭合标签，丢掉
          var attrs = sanitizeAttrs(it.attrs);
          if (it.tag === 'br' || it.tag === 'wbr') {
            push('<' + it.tag + '>'); i += it.raw.length; continue;
          }
          var openEnd = i + it.raw.length;
          var closeRe = new RegExp('</' + it.tag + '\\s*>', 'i');
          var rest = src.slice(openEnd);
          var cm2 = closeRe.exec(rest);
          if (cm2) {
            var innerHTML = renderInline(rest.slice(0, cm2.index), base + openEnd, defs);
            push('<' + it.tag + attrs + ' data-s="' + (base + i) + '">' + innerHTML + '</' + it.tag + '>');
            i = openEnd + cm2.index + cm2[0].length; continue;
          }
          // 没闭合：当普通文本，别吞掉后面内容
        }
        var hm = /^<\/?[a-zA-Z][^>]*>/.exec(src.slice(i));
        if (hm) { push('<span data-s="' + (base + i) + '" class="raw-html">' + esc(hm[0]) + '</span>'); i += hm[0].length; continue; }
      }
      // 行内公式 $...$（不跨行）
      if (c === '$' && src[i + 1] !== '$') {
        var mm = /^\$([^$\n]+?)\$/.exec(src.slice(i));
        if (mm) {
          push('<span class="math-inline" data-s="' + (base + i) + '">' + texToHTML(mm[1], false) + '</span>');
          i += mm[0].length; continue;
        }
      }
      // 强调族
      var em2 = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(src.slice(i));
      if (em2) {
        push('<strong data-s="' + (base + i) + '">' + renderInline(em2[2], base + i + 2, defs) + '</strong>');
        i += em2[0].length; continue;
      }
      var st2 = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src.slice(i));
      if (st2) {
        push('<del data-s="' + (base + i) + '">' + renderInline(st2[1], base + i + 2, defs) + '</del>');
        i += st2[0].length; continue;
      }
      var mk2 = STRICT ? null : /^==(?=\S)([\s\S]*?\S)==/.exec(src.slice(i));
      if (mk2) {
        push('<mark data-s="' + (base + i) + '">' + renderInline(mk2[1], base + i + 2, defs) + '</mark>');
        i += mk2[0].length; continue;
      }
      var em1 = /^(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1/.exec(src.slice(i));
      if (em1) {
        push('<em data-s="' + (base + i) + '">' + renderInline(em1[2], base + i + 1, defs) + '</em>');
        i += em1[0].length; continue;
      }
      // 上标 X^2^ / 下标 H~2~O（单行内、不含空白；~~ 已在上面的删除线里吃掉）
      if (!STRICT && c === '^') {
        var supm = /^\^(?=\S)([^\s^]+?)\^(?!\^)/.exec(src.slice(i));
        if (supm) {
          push('<sup data-s="' + (base + i) + '">' + renderInline(supm[1], base + i + 1, defs) + '</sup>');
          i += supm[0].length; continue;
        }
      }
      if (!STRICT && c === '~' && src[i + 1] !== '~') {
        var subm = /^~(?=\S)([^\s~]+?)~(?![~])/.exec(src.slice(i));
        if (subm) {
          push('<sub data-s="' + (base + i) + '">' + renderInline(subm[1], base + i + 1, defs) + '</sub>');
          i += subm[0].length; continue;
        }
      }
      // Emoji shortcode :smile:
      if (!STRICT && c === ':') {
        var emo = RE_EMOJI.exec(src.slice(i));
        if (emo && EMOJI[emo[1].toLowerCase()]) {
          push('<span class="emoji" data-s="' + (base + i) + '" title="' + esc(emo[0]) + '">' +
            EMOJI[emo[1].toLowerCase()] + '</span>');
          i += emo[0].length; continue;
        }
      }
      // 裸 URL / www. 自动链接
      if (c === 'h' || c === 'H' || c === 'w' || c === 'W') {
        var bu = readBareUrl(src, i);
        if (bu) {
          push('<a class="bare-url" data-s="' + (base + i) + '" href="' + esc(bu.href) + '">' + esc(bu.raw) + '</a>');
          i += bu.raw.length; continue;
        }
      }
      // 硬换行（行尾两空格 + 换行）
      if (c === '\n') {
        if (/ {2,}$/.test(src.slice(0, i))) {
          if (buf) { buf = buf.replace(/ +$/, ''); }
          push('<br>');
          i += 1; continue;
        }
        if (!buf) bufStart = i;
        buf += '\n'; i += 1; continue;
      }

      if (!buf) bufStart = i;
      buf += c; i += 1;
    }
    flush();
    return out;
  }

  /* ---------------------------------------------------------- 数学（基础 TeX 子集） */
  var SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
    sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ',
    Psi: 'Ψ', Omega: 'Ω',
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', le: '≤', leq: '≤', ge: '≥', geq: '≥',
    ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', propto: '∝', infty: '∞',
    sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
    in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
    emptyset: '∅', varnothing: '∅', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
    Leftarrow: '⇐', leftrightarrow: '↔', mapsto: '↦', cdots: '⋯', ldots: '…', dots: '…',
    angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′', therefore: '∴', because: '∵',
    quad: '\u2003', qquad: '\u2003\u2003', ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '',
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', '\'': ''
  };

  function texFallback(tex, display) {
    var s = String(tex);

    function readAtom(i) {
      // 空白
      while (i < s.length && s[i] === ' ') i++;
      if (i >= s.length) return { html: '', i: i };
      if (s[i] === '{') {
        var r = parseSeq(i + 1, '}');
        return { html: '<span class="m-grp">' + r.html + '</span>', i: r.i };
      }
      if (s[i] === '\\') {
        var cm = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
        if (cm) {
          var name = cm[1];
          var after = i + cm[0].length;
          if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            var a = readAtom(after), b = readAtom(a.i);
            return {
              html: '<span class="m-frac"><span class="m-num">' + a.html + '</span>' +
                '<span class="m-den">' + b.html + '</span></span>', i: b.i
            };
          }
          if (name === 'sqrt') {
            var deg = null, k = after;
            if (s[k] === '[') { var close = s.indexOf(']', k); if (close > 0) { deg = s.slice(k + 1, close); k = close + 1; } }
            var rad = readAtom(k);
            return {
              html: '<span class="m-sqrt">' + (deg ? '<span class="m-deg">' + texFallback(deg, false) + '</span>' : '') +
                '<span class="m-rad">√</span><span class="m-radicand">' + rad.html + '</span></span>', i: rad.i
            };
          }
          if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'mathbf' || name === 'mathit' || name === 'operatorname') {
            var t = readAtom(after);
            var plain = t.html.replace(/<[^>]+>/g, '');
            var cls = name === 'mathbf' ? 'm-bf' : (name === 'mathit' ? 'm-it' : 'm-text');
            return { html: '<span class="' + cls + '">' + plain + '</span>', i: t.i };
          }
          if (name === 'left' || name === 'right') {
            var nxt = s[after] || '';
            if (nxt === '\\') { var d = /^\\([a-zA-Z]+|.)/.exec(s.slice(after)); nxt = SYM[d[1]] || d[1]; after += d[0].length; }
            else after += 1;
            return { html: '<span class="m-big">' + esc(nxt === '.' ? '' : nxt) + '</span>', i: after };
          }
          if (name === 'begin' || name === 'end') {
            var env = readAtom(after);
            return { html: '', i: env.i };
          }
          if (name === 'overline' || name === 'bar') {
            var o = readAtom(after);
            return { html: '<span class="m-overline">' + o.html + '</span>', i: o.i };
          }
          if (SYM[name] !== undefined) return { html: esc(SYM[name]), i: after };
          return { html: '<span class="m-fn">' + esc(name) + '</span>', i: after };
        }
        return { html: '\\', i: i + 1 };
      }
      // 普通字符
      var ch = s[i];
      if (ch === '^') return { html: '', i: i + 1 };
      if (ch === '_') return { html: '', i: i + 1 };
      return { html: esc(ch), i: i + 1 };
    }

    function parseSeq(i, stop) {
      var out = [];
      while (i < s.length) {
        var c = s[i];
        if (stop && c === stop) return { html: out.join(''), i: i + 1 };
        if (c === '}') return { html: out.join(''), i: i + 1 };
        if (c === '^' || c === '_') {
          var atom = readAtom(i + 1);
          var prev = out.length ? out.pop() : '';
          if (c === '^') out.push('<span class="m-base">' + prev + '</span><span class="m-sup">' + atom.html + '</span>');
          else out.push('<span class="m-base">' + prev + '</span><span class="m-sub">' + atom.html + '</span>');
          i = atom.i; continue;
        }
        var r = readAtom(i);
        out.push(r.html); i = r.i;
      }
      return { html: out.join(''), i: i };
    }

    var html = parseSeq(0, null).html;
    return '<span class="math' + (display ? ' math-display' : '') + '">' + html + '</span>';
  }

  /* ---------------------------------------------------------- 公式
   * 编辑器里优先用 KaTeX（`app/vendor/katex`，随包内置，离线可用），
   * 拿不到时退回上面那套自研子集 —— ePub 导出走的就是回退（阅读器不认
   * KaTeX 依赖 CSS 的排版），Node 单测同理。
   */
  function texToHTML(tex, display) {
    var K = null;
    try {
      if (typeof window !== 'undefined' && window.katex) K = window.katex;
      else if (typeof globalThis !== 'undefined' && globalThis.katex) K = globalThis.katex;
    } catch (e) { K = null; }
    if (K && typeof K.renderToString === 'function') {
      try {
        return K.renderToString(String(tex), {
          displayMode: !!display,
          throwOnError: false,        // 语法错误渲染成红字，不要抛异常把整篇渲染打挂
          errorColor: '#d1242f',
          strict: false,               // 不认的命令按字面输出，不刷警告
          trust: false,
          output: 'htmlAndMathml'      // 带 MathML：屏幕阅读器/复制公式可用，导出 HTML 时也能靠它兜底
        });
      } catch (e) { /* 落到自研渲染 */ }
    }
    return texFallback(tex, display);
  }

  /* ---------------------------------------------------------- 代码高亮 */
  /* 每种语言一张方言表。字段：
   *   line   行注释前缀（数组，长度自动降序试）
   *   block  块注释 / 多行字符串 [[开, 合, 类名?], …]
   *   kw     关键字          types 类型与内置名
   *   ci     关键字大小写不敏感（SQL）
   *   quotes 引号集合（默认 " ' `）
   *   dbl    true = 连续两个引号算转义（SQL 的 ''）
   *   hashIn true = # 只在行首或空白后才是注释（YAML 的 a#b 不是注释）
   *   unit   true = 数字可以带单位（CSS 的 10px）
   *   pre    语言专属规则 [[/^…/, 'tok-xx'], …]，在字符串/数字/关键字之前试
   *   flavor 'diff' / 'md' 走整行渲染
   *
   * 所有分支都「原样搬字符、只加 span」，所以去掉标签再反转义必须一字不差还原
   * 原文 —— 这条不变量比逐个断言颜色更抗回归，test/highlight.test.js 逐语言验。
   */
  var LANG = {
    javascript: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of delete void yield static get set null true false undefined',
      types: 'Array Object String Number Boolean Promise Map Set WeakMap Symbol JSON Math Date RegExp Error BigInt'
    },
    typescript: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of delete void yield static get set interface type enum implements public private protected readonly as namespace declare abstract satisfies keyof infer never unknown any null true false undefined',
      types: 'Array Object String Number Boolean Promise Map Set WeakMap Symbol JSON Math Date RegExp Error BigInt Record Partial Readonly Required Pick Omit Exclude'
    },
    jsx: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of delete void yield static get set null true false undefined',
      types: 'Array Object String Number Boolean Promise Map Set Symbol JSON Math Date RegExp Error React Component Fragment',
      pre: [[/^<\/?[A-Za-z][\w.:-]*/, 'tok-tag']]
    },
    tsx: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of delete void yield static get set interface type enum implements public private protected readonly as namespace declare abstract satisfies keyof infer never unknown any null true false undefined',
      types: 'Array Object String Number Boolean Promise Map Set Symbol JSON Math Date RegExp Error React Component Fragment Record Partial',
      pre: [[/^<\/?[A-Za-z][\w.:-]*/, 'tok-tag']]
    },
    python: {
      line: ['#'], quotes: '"\'',
      block: [['"""', '"""', 'tok-st'], ["'''", "'''", 'tok-st']],
      kw: 'def class return if elif else for while break continue import from as with try except finally raise pass lambda yield global nonlocal assert del in is not and or None True False async await self match case',
      types: 'int float str bool bytes list dict set tuple frozenset object type len range print open enumerate zip map filter sum min max sorted isinstance super property staticmethod classmethod Exception ValueError TypeError',
      pre: [[/^@[A-Za-z_][\w.]*/, 'tok-fn']]
    },
    java: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null',
      types: 'String Integer Long Double Float Boolean Character Object List Map Set ArrayList HashMap Optional Stream Exception',
      pre: [[/^@[A-Za-z_]\w*/, 'tok-meta']]
    },
    kotlin: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg',
      types: 'Int Long Double Float Boolean String Char Any Unit Nothing List Map Set Array MutableList',
      pre: [[/^@[A-Za-z_]\w*/, 'tok-meta']]
    },
    swift: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self Self throw throws true try async await some any',
      types: 'Int Double Float String Bool Void Array Dictionary Set Optional Result Error Character',
      pre: [[/^@[A-Za-z_]\w*/, 'tok-meta']]
    },
    go: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'`',
      kw: 'package import func var const type struct interface map chan go defer return if else for range switch case break continue select fallthrough default goto nil true false iota',
      types: 'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 complex64 complex128 bool byte rune error any make new len cap append copy delete panic recover'
    },
    rust: {
      line: ['//'], block: [['/*', '*/']], quotes: '"\'',
      kw: 'fn let mut pub use mod struct enum impl trait for in while loop if else match return self Self where as dyn ref move async await unsafe const static type crate super extern true false',
      types: 'i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 usize isize bool char str String Vec Option Result Box Rc Arc HashMap',
      // 生命周期 'a 必须抢在字符串规则前面，否则会被当成没闭合的字符字面量
      pre: [[/^#!?\[[^\]\n]*\]/, 'tok-meta'], [/^'[a-z_]\w*(?!')/, 'tok-meta']]
    },
    c: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Static_assert',
      types: 'size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t bool true false NULL FILE',
      pre: [[/^#[ \t]*[a-zA-Z]+[^\n]*/, 'tok-meta']]
    },
    cpp: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'auto break case char const constexpr continue decltype default delete do double else enum explicit extern float friend for goto if inline int long mutable namespace new noexcept operator override private protected public register reinterpret_cast return short signed sizeof static static_cast struct switch template this throw try typedef typename union unsigned using virtual void volatile while class dynamic_cast const_cast final nullptr bool true false',
      types: 'size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t string vector map set unordered_map unique_ptr shared_ptr pair',
      pre: [[/^#[ \t]*[a-zA-Z]+[^\n]*/, 'tok-meta']]
    },
    csharp: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await yield get set partial record nameof',
      types: 'List Dictionary Task Action Func Span Memory Guid DateTime TimeSpan Exception IEnumerable',
      // @"..." 与 $"..." 的修饰符先单独吃掉，后面那个引号仍按普通字符串扫
      pre: [[/^[@$]{1,2}(?=")/, 'tok-st']]
    },
    objectivec: {
      line: ['//'], block: [['/*', '*/']],
      kw: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while interface implementation property end synthesize dynamic protocol selector class instancetype self super nil YES NO id',
      types: 'NSObject NSString NSArray NSDictionary NSNumber NSInteger NSUInteger CGFloat BOOL',
      pre: [[/^@[a-zA-Z]+/, 'tok-meta'], [/^#[ \t]*[a-zA-Z]+[^\n]*/, 'tok-meta']]
    },
    php: {
      line: ['//', '#'], block: [['/*', '*/']],
      kw: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null this self parent',
      types: 'int float string bool array object iterable void mixed never',
      pre: [[/^<\?php|^\?>/, 'tok-meta'], [/^\$[A-Za-z_]\w*/, 'tok-meta']]
    },
    ruby: {
      line: ['#'], block: [['=begin', '=end']], quotes: '"\'`',
      kw: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer include extend prepend raise puts',
      types: 'String Integer Float Array Hash Symbol Range Proc Exception Object',
      pre: [[/^:[A-Za-z_]\w*[?!]?/, 'tok-fn'], [/^@@?[A-Za-z_]\w*/, 'tok-meta']]
    },
    r: {
      line: ['#'], quotes: '"\'`',
      kw: 'if else repeat while function for in next break TRUE FALSE NULL NA NaN Inf',
      types: 'c list vector data.frame matrix factor character numeric integer logical library require print paste'
    },
    lua: {
      line: ['--'], block: [['--[[', ']]']],
      kw: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self',
      types: 'string table math io os pairs ipairs print require tostring tonumber type setmetatable'
    },
    bash: {
      line: ['#'], quotes: '"\'`',
      kw: 'if then else elif fi for while until do done case esac function return echo export local readonly declare cd exit set unset source alias sudo shift read printf test trap eval exec in',
      types: 'true false',
      pre: [
        [/^\$\{[^}\n]*\}/, 'tok-meta'], [/^\$\([^)\n]*\)/, 'tok-meta'],
        [/^\$[A-Za-z_]\w*/, 'tok-meta'], [/^\$[0-9@*#?$!-]/, 'tok-meta']
      ]
    },
    sql: {
      line: ['--'], block: [['/*', '*/']], ci: true, dbl: true,
      kw: 'select from where insert into values update set delete create table index view join left right inner outer full cross on group by order having limit offset as and or not null distinct count sum avg min max case when then else end primary key foreign references unique default check alter add drop column constraint asc desc union all exists between like in is with returning begin commit rollback transaction if',
      types: 'int integer bigint smallint varchar char text date datetime timestamp boolean decimal numeric float double serial uuid json jsonb blob'
    },
    json: {
      kw: 'true false null',
      pre: [[/^"(?:[^"\\]|\\.)*"(?=\s*:)/, 'tok-key']]
    },
    yaml: {
      line: ['#'], hashIn: true,
      kw: 'true false null yes no on off',
      pre: [
        [/^[&*][A-Za-z_][\w-]*/, 'tok-meta'], [/^!!?[\w/]+/, 'tok-meta'],
        [/^[A-Za-z_][\w.-]*(?=\s*:(\s|$))/, 'tok-key'], [/^-(?=\s)/, 'tok-meta']
      ]
    },
    toml: {
      line: ['#'],
      kw: 'true false',
      pre: [
        [/^\[\[?[^\]\n]+\]\]?/, 'tok-kw'],
        [/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/, 'tok-nu'],
        [/^[A-Za-z0-9_."'-]+(?=\s*=)/, 'tok-key']
      ]
    },
    css: {
      line: [], block: [['/*', '*/']], unit: true,
      pre: [
        [/^@[\w-]+/, 'tok-kw'], [/^!important\b/i, 'tok-kw'],
        [/^#[0-9a-fA-F]{3,8}\b/, 'tok-nu'],
        [/^[.#][A-Za-z_-][\w-]*/, 'tok-type'], [/^::?[a-z-]+/i, 'tok-kw'],
        [/^[a-z-]{2,}(?=\s*:)/i, 'tok-key']
      ]
    },
    scss: {
      line: ['//'], block: [['/*', '*/']], unit: true,
      pre: [
        [/^@[\w-]+/, 'tok-kw'], [/^!important\b/i, 'tok-kw'],
        [/^#[0-9a-fA-F]{3,8}\b/, 'tok-nu'], [/^\$[\w-]+/, 'tok-meta'],
        [/^[.#%][A-Za-z_-][\w-]*/, 'tok-type'], [/^&?::?[a-z-]+/i, 'tok-kw'],
        [/^[a-z-]{2,}(?=\s*:)/i, 'tok-key']
      ]
    },
    html: {
      block: [['<!--', '-->']],
      pre: [
        [/^<\/?[A-Za-z][\w:.-]*/, 'tok-tag'],
        [/^<!DOCTYPE[^>]*>|^<!\[CDATA\[/i, 'tok-meta'],
        [/^&[A-Za-z]\w*;|^&#\d+;/, 'tok-nu'],
        [/^[A-Za-z_:][\w:.-]*(?=\s*=)/, 'tok-key']
      ]
    },
    xml: {
      block: [['<!--', '-->']],
      pre: [
        [/^<\/?[A-Za-z_][\w:.-]*/, 'tok-tag'],
        [/^<\?[\w-]*|^\?>/, 'tok-meta'],
        [/^<!DOCTYPE[^>]*>|^<!\[CDATA\[/i, 'tok-meta'],
        [/^&[A-Za-z]\w*;|^&#\d+;/, 'tok-nu'],
        [/^[A-Za-z_:][\w:.-]*(?=\s*=)/, 'tok-key']
      ]
    },
    latex: {
      line: ['%'],
      kw: 'documentclass usepackage begin end section subsection subsubsection paragraph chapter part textbf textit emph underline footnote cite ref label includegraphics item itemize enumerate tabular figure table caption title author date maketitle newcommand renewcommand input include href url',
      pre: [
        [/^\\[A-Za-z]+/, 'tok-kw'], [/^\\[^A-Za-z]/, 'tok-kw'],
        [/^\$\$[\s\S]*?\$\$/, 'tok-st'], [/^\$[^$\n]*\$/, 'tok-st']
      ]
    },
    markdown: { flavor: 'md' },
    mermaid: {
      line: ['%%'],
      kw: 'graph flowchart sequenceDiagram classDiagram stateDiagram erDiagram gantt pie journey gitGraph mindmap timeline subgraph end participant actor note loop alt else opt par and rect activate deactivate autonumber classDef class style linkStyle click direction TB TD BT RL LR',
      pre: [
        [/^(?:-->|---|-.->|==>|<--|--x|--o|~~~|--)/, 'tok-meta'],
        [/^\|[^|\n]*\|/, 'tok-st'], [/^\[[^\]\n]*\]/, 'tok-st'], [/^[({][^)}\n]*[)}]/, 'tok-st']
      ]
    },
    flow: {
      line: ['%%'],
      kw: 'graph flowchart sequenceDiagram classDiagram stateDiagram erDiagram gantt pie journey gitGraph mindmap timeline subgraph end participant actor note loop alt else opt par and rect activate deactivate autonumber classDef class style linkStyle click direction TB TD BT RL LR',
      pre: [
        [/^(?:-->|---|-.->|==>|<--|--x|--o|~~~|--)/, 'tok-meta'],
        [/^\|[^|\n]*\|/, 'tok-st'], [/^\[[^\]\n]*\]/, 'tok-st'], [/^[({][^)}\n]*[)}]/, 'tok-st']
      ]
    },
    diff: { flavor: 'diff' }
  };

  function span(cls, s) { return '<span class="' + cls + '">' + esc(s) + '</span>'; }

  function wordSet(str, ci) {
    var set = {};
    String(str || '').split(/\s+/).forEach(function (k) { if (k) set[ci ? k.toLowerCase() : k] = 1; });
    return set;
  }

  /* diff 是行级的：一行一个语义，按行首字符判比词法更准 */
  function hlDiff(code) {
    return String(code).split('\n').map(function (line) {
      if (/^(\+\+\+|---)/.test(line)) return span('tok-meta', line);
      if (/^@@/.test(line)) return span('tok-meta', line);
      if (/^(diff |index |new file|deleted file|similarity |rename |Binary files)/.test(line)) return span('tok-meta', line);
      if (line[0] === '+') return span('tok-ins', line);
      if (line[0] === '-') return span('tok-del', line);
      return esc(line);
    }).join('\n');
  }

  /* markdown 源码块：只看结构（围栏/标题/列表/引用），行内再挑代码、粗体、链接 */
  function mdInline(s) {
    var re = /`[^`\n]*`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]*\]\([^)\n]*\)|!\[[^\]\n]*\]\([^)\n]*\)/g;
    var out = '', last = 0, m;
    while ((m = re.exec(s)) !== null) {
      out += esc(s.slice(last, m.index));
      var cls = m[0][0] === '`' ? 'tok-st' : (m[0][0] === '[' || m[0][0] === '!' ? 'tok-fn' : 'tok-kw');
      out += span(cls, m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  function hlMarkdown(code) {
    return String(code).split('\n').map(function (line) {
      var m;
      if (/^\s*(`{3,}|~{3,})/.test(line)) return span('tok-meta', line);
      if ((m = /^(#{1,6})(\s+)([\s\S]*)$/.exec(line))) {
        return span('tok-meta', m[1]) + m[2] + span('tok-kw', m[3]);
      }
      if ((m = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line))) {
        return m[1] + span('tok-meta', m[2]) + m[3] + mdInline(line.slice(m[0].length));
      }
      if ((m = /^(\s*(?:>+\s?)+)/.exec(line))) {
        return span('tok-cm', m[1]) + mdInline(line.slice(m[1].length));
      }
      return mdInline(line);
    }).join('\n');
  }

  function hlGeneric(code, cfg, name) {
    var kws = wordSet(cfg.kw, cfg.ci), tys = wordSet(cfg.types, cfg.ci);
    var lineMarks = (cfg.line || []).slice().sort(function (a, b) { return b.length - a.length; });
    var blocks = cfg.block || [];
    var pre = cfg.pre || [];
    var quotes = cfg.quotes || '"\'`';
    var out = '', i = 0, n = code.length, m, k, b;

    while (i < n) {
      var c = code[i], rest = code.slice(i);

      // 1) 块注释 / 多行字符串（`--[[` 要抢在 `--` 行注释前，所以放第一步）
      for (b = 0; b < blocks.length; b++) {
        if (rest.slice(0, blocks[b][0].length) === blocks[b][0]) break;
      }
      if (b < blocks.length) {
        var open = blocks[b][0], close = blocks[b][1];
        var e = code.indexOf(close, i + open.length);
        e = e < 0 ? n : e + close.length;
        out += span(blocks[b][2] || 'tok-cm', code.slice(i, e));
        i = e; continue;
      }

      // 2) 行注释
      var lc = null;
      for (k = 0; k < lineMarks.length; k++) {
        if (rest.slice(0, lineMarks[k].length) !== lineMarks[k]) continue;
        if (lineMarks[k] === '#' && cfg.hashIn && i > 0 && !/[ \t]/.test(code[i - 1])) continue;
        lc = lineMarks[k]; break;
      }
      if (lc) {
        var nl = code.indexOf('\n', i); nl = nl < 0 ? n : nl;
        out += span('tok-cm', code.slice(i, nl)); i = nl; continue;
      }

      // 3) 语言专属规则（要在字符串前，Rust 的 'a 才会被当成生命周期）
      var hit = false;
      for (k = 0; k < pre.length; k++) {
        m = pre[k][0].exec(rest);
        if (m && m[0].length) { out += span(pre[k][1], m[0]); i += m[0].length; hit = true; break; }
      }
      if (hit) continue;

      // 4) 字符串
      if (quotes.indexOf(c) >= 0) {
        var j = i + 1;
        while (j < n) {
          if (code[j] === '\\') { j += 2; continue; }
          if (cfg.dbl && code[j] === c && code[j + 1] === c) { j += 2; continue; }
          if (code[j] === c) { j++; break; }
          if (code[j] === '\n' && c !== '`') break;
          j++;
        }
        if (j > n) j = n;
        out += span('tok-st', code.slice(i, j)); i = j; continue;
      }

      // 5) 数字
      if (/[0-9]/.test(c) && !/[A-Za-z_$]/.test(code[i - 1] || '')) {
        m = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/.exec(rest);
        var num = m[0];
        if (cfg.unit) {
          var um = /^[a-zA-Z%]+/.exec(rest.slice(num.length));
          if (um) num += um[0];
        }
        out += span('tok-nu', num); i += num.length; continue;
      }

      // 6) 单词：关键字 → 类型 → 调用 → 普通
      if (/[A-Za-z_$@#]/.test(c)) {
        m = /^[A-Za-z_$@#][\w$]*/.exec(rest);
        var w = m[0], lw = cfg.ci ? w.toLowerCase() : w;
        if (kws[lw]) out += span('tok-kw', w);
        else if (tys[lw]) out += span('tok-type', w);
        else if (/^\s*\(/.test(code.slice(i + w.length))) out += span('tok-fn', w);
        else out += esc(w);
        i += w.length; continue;
      }

      out += esc(c); i++;
    }
    return out;
  }

  function highlight(code, lang) {
    var name = langKey(lang);
    var cfg = LANG[name];
    if (!cfg) {
      // 不认识的围栏语言：只当普通文本处理（注释都不猜，免得把正文染花）
      if (!name || name === 'text') return esc(code);
      cfg = { line: ['//', '#'], block: [['/*', '*/']] };
    }
    if (cfg.flavor === 'diff') return hlDiff(code);
    if (cfg.flavor === 'md') return hlMarkdown(code);
    return hlGeneric(code, cfg, name);
  }

  /* ---------------------------------------------------------- 表格 */
  function splitRow(line) {
    var s = line.trim();
    if (s[0] === '|') s = s.slice(1);
    if (s[s.length - 1] === '|') s = s.slice(0, -1);
    var cells = [], cur = '', escp = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (escp) { cur += c; escp = false; continue; }
      if (c === '\\') { cur += c; escp = true; continue; }
      if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function tableHTML(raw, base) {
    var lines = raw.split('\n');
    var head = splitRow(lines[0]);
    var align = splitRow(lines[1] || '').map(function (c) {
      var l = c[0] === ':', r = c[c.length - 1] === ':';
      if (l && r) return 'center';
      if (r) return 'right';
      if (l) return 'left';
      return '';
    });
    var body = lines.slice(2).map(splitRow);
    var h = '<table><thead><tr>';
    head.forEach(function (c, j) {
      h += '<th data-r="-1" data-c="' + j + '"' + (align[j] ? ' style="text-align:' + align[j] + '"' : '') + '>' + renderInline(c, base) + '</th>';
    });
    h += '</tr></thead><tbody>';
    body.forEach(function (row, r) {
      h += '<tr>';
      for (var j = 0; j < head.length; j++) {
        h += '<td data-r="' + r + '" data-c="' + j + '"' + (align[j] ? ' style="text-align:' + align[j] + '"' : '') + '>' + renderInline(row[j] || '', base) + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* ---------------------------------------------------------- 表格模型
   * 渲染态改表格结构（插入/删除行列、改对齐）之后，要把整张表重新序列化回
   * GFM 文本。这里不追求列宽完美（中文字符按 1 个宽度算），只要读得懂、对齐好看。
   */
  // 显示宽度：CJK / 全角算 2，其余算 1。不这么算，含中文的表格在源码里会歪。
  function charLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var wide = (c >= 0x1100 && (
        c <= 0x115f || c === 0x2329 || c === 0x232a ||
        (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) ||
        (c >= 0x1f300 && c <= 0x1f9ff)));
      n += wide ? 2 : 1;
      if (c >= 0xd800 && c <= 0xdbff) i++;   // 代理对只算一个字符
    }
    return n;
  }

  function cellText(s) {
    return String(s == null ? '' : s)
      .replace(/\r?\n/g, ' ')
      .replace(/(^|[^\\])\|/g, '$1\\|')     // 单元格里的裸 | 要转义，否则结构散了
      .trim();
  }

  function tableModel(raw) {
    var lines = String(raw == null ? '' : raw).split('\n');
    var head = splitRow(lines[0] || '');
    var sep = splitRow(lines[1] || '');
    var aligns = [];
    for (var j = 0; j < head.length; j++) {
      var c = String(sep[j] || '');
      var l = c[0] === ':', r = c[c.length - 1] === ':';
      aligns.push(l && r ? 'center' : r ? 'right' : l ? 'left' : '');
    }
    var widths = [];
    for (var w0 = 0; w0 < head.length; w0++) {
      // 分隔行里的短横线数 = 单元格内容宽 - 1（两侧各留一个空格）
      widths.push(Math.max(3, String(sep[w0] || '').replace(/:/g, '').trim().length + 1));
    }
    var rows = lines.slice(2).filter(function (l) { return l.trim() !== ''; }).map(function (l) {
      var cells = splitRow(l);
      var out = [];
      for (var k = 0; k < head.length; k++) out.push(cells[k] || '');   // 短行补齐、长行截断
      return out;
    });
    return { head: head, aligns: aligns, rows: rows, widths: widths };
  }

  function serialTable(m) {
    var cols = (m.head || []).length;
    if (!cols) return '';
    var all = [m.head].concat(m.rows || []);
    var w = [];
    for (var j = 0; j < cols; j++) {
      var mx = 3;
      for (var i = 0; i < all.length; i++) {
        var n = charLen(cellText(all[i][j] || ''));
        if (n > mx) mx = n;
      }
      // m.widths 是用户拖出来的列宽（字符数），只放大不缩小，避免截断内容
      if (m.widths && m.widths[j] > mx) mx = m.widths[j];
      w.push(mx);
    }
    function fill(n) { return n > 0 ? new Array(n + 1).join(' ') : ''; }
    function rowLine(cells) {
      var out = [];
      for (var j = 0; j < cols; j++) {
        var t = cellText(cells[j] || '');
        out.push(' ' + t + fill(w[j] - charLen(t)) + ' ');
      }
      return '|' + out.join('|') + '|';
    }
    var lines = [rowLine(m.head)];
    var sep = [];
    for (var j2 = 0; j2 < cols; j2++) {
      var a = m.aligns[j2] || '';
      var dash = Math.max(3, w[j2] - (a ? 1 : 0));
      var body = new Array(dash + 1).join('-');
      if (a === 'center') sep.push(':' + body + ':');
      else if (a === 'right') sep.push(body + ':');
      else if (a === 'left') sep.push(':' + body);
      else sep.push(body);
    }
    lines.push('|' + sep.map(function (x) { return ' ' + x + ' '; }).join('|') + '|');
    (m.rows || []).forEach(function (r) { lines.push(rowLine(r)); });
    return lines.join('\n');
  }

  /* ---------------------------------------------------------- 列表树 */
  // 列表项的内容列：缩进 + 标记宽度 + 标记后至少一个空白。
  // 严格模式的第二条规则就落在这里——列表项里新开的段落/子列表必须
  // 缩进到这一列，否则不算同一项。
  function colOf(item) { return item.indent + (item.marker ? item.marker.length + 1 : 0); }

  function parseListTree(lines, i) {
    var root = { indent: -1, children: [] };
    var stack = [root];
    var lastLine = i;

    function newItem(m, indent) {
      return {
        marker: m[2], ordered: /\d/.test(m[2]), indent: indent,
        task: null, text: m[4], children: []
      };
    }

    while (i < lines.length) {
      var line = lines[i].text;
      if (RE_BLANK.test(line)) {
        var k = i + 1;
        while (k < lines.length && RE_BLANK.test(lines[k].text)) k++;
        // 空行之后的列表行：宽松档只要比当前项缩进深就算子树；
        // 严格档必须落在当前项的内容列（子树）或与当前项同缩进（兄弟），
        // 否则列表到此结束。
        if (k < lines.length && RE_LIST.test(lines[k].text)) {
          var tp = stack[stack.length - 1];
          var ind2 = indentWidth(lines[k].text);
          var deep = STRICT
            ? (stack.length > 1 && (ind2 >= colOf(tp) || ind2 === tp.indent))
            : ind2 > tp.indent;
          if (deep) { i = k; continue; }
        }
        break;
      }
      var m = RE_LIST.exec(line);
      if (m) {
        var indent = indentWidth(m[1]);
        if (STRICT) {
          // 严格档：从栈顶往下找挂载点——缩进够到某项的内容列才算它的子树，
          // 与某项缩进相同才算兄弟；都挂不上（如 1. aaa 后只有 2 空格的
          // 1. ccc）列表就此结束，另起一个列表块（CommonMark 语义）。
          // 栈里只有 root 说明是列表首行，直接挂顶层。
          var attach = null, keep = 1;
          if (stack.length === 1) { attach = root; keep = 1; }
          else {
            for (var si = stack.length - 1; si >= 1; si--) {
              var sit = stack[si];
              if (indent >= colOf(sit)) { attach = sit; keep = si + 1; break; }
              if (indent === sit.indent) { attach = stack[si - 1]; keep = si; break; }
            }
          }
          if (!attach) break;
          stack.length = keep;
        } else {
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
          if (!(indent > stack[stack.length - 1].indent && stack[stack.length - 1].children)) {
            while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
          }
        }
        var item = newItem(m, indent);
        var parent = stack[stack.length - 1];
        parent.children.push(item);
        stack.push(item);
        // 任务列表
        var tm = /^\[([ xX])\]\s+([\s\S]*)$/.exec(item.text);
        if (tm) { item.task = tm[1].toLowerCase() === 'x'; item.text = tm[2]; }
        i++; lastLine = i; continue;
      }
      // 续行（懒续行或缩进续行）
      var top = stack[stack.length - 1];
      if (top !== root) {
        // 严格档：续行必须对齐当前项的内容列，且不能让块级元素打断；
        // 宽松档：缩进比当前项深就算，或者不是 ATX 标题就懒续行（CommonMark 语义）。
        var keeps = STRICT
          ? indentWidth(line) >= colOf(top)
          : (indentWidth(line) > top.indent || !atxOf(line));
        if (keeps && !atxOf(line) && !fenceOf(line) && !RE_HR.test(line) && !RE_QUOTE.test(line)) {
          top.text += '\n' + line.trim();
          i++; lastLine = i; continue;
        }
      }
      break;
    }
    return { tree: root.children, end: lastLine };
  }

  function listHTML(items, base, ordered) {
    var tag = ordered ? 'ol' : 'ul';
    var h = '<' + tag + '>';
    items.forEach(function (it) {
      h += '<li>';
      if (it.task !== null) h += '<input type="checkbox" class="task" disabled' + (it.task ? ' checked' : '') + '> ';
      h += renderInline(it.text, base);
      if (it.children.length) h += listHTML(it.children, base, it.children[0].ordered);
      h += '</li>';
    });
    return h + '</' + tag + '>';
  }

  /* ---------------------------------------------------------- 块级解析 */
  function parseBlocks(src, inheritDefs) {
    src = String(src == null ? '' : src);
    var lines = splitLines(src);
    var blocks = [];
    var i = 0;
    // 定义表全文生效（引用可以写在定义之前），子块（引用内）继承父级
    var defs = {};
    var dk;
    if (inheritDefs) for (dk in inheritDefs) defs[dk] = inheritDefs[dk];
    var own = scanLinkDefs(src);
    for (dk in own) defs[dk] = own[dk];

    function startsNewBlock(k) {
      var t = lines[k].text;
      return !!atxOf(t) || !!fenceOf(t) || RE_HR.test(t) || RE_QUOTE.test(t) ||
        RE_LIST.test(t) || RE_MATH_FENCE.test(t) || RE_MATH_ONELINE.test(t) || isHtmlBlock(t) ||
        RE_TOC.test(t) || RE_FOOTDEF.test(t) || RE_LINKDEF.test(t);
    }

    while (i < lines.length) {
      var ln = lines[i];
      var text = ln.text;
      if (RE_BLANK.test(text)) { i++; continue; }
      var startOffset = ln.start;

      // YAML front matter
      if (i === 0 && RE_FM.test(text)) {
        var close = -1;
        for (var k = 1; k < lines.length; k++) { if (/^(---|\.\.\.)[ \t]*$/.test(lines[k].text)) { close = k; break; } }
        if (close > 0) {
          var raw = lines.slice(0, close + 1).map(function (l) { return l.text; }).join('\n');
          blocks.push({ type: 'frontmatter', raw: raw, start: startOffset });
          i = close + 1; continue;
        }
      }

      // 公式块 $$
      if (RE_MATH_FENCE.test(text)) {
        var endM = -1;
        for (var q = i + 1; q < lines.length; q++) { if (RE_MATH_FENCE.test(lines[q].text)) { endM = q; break; } }
        if (endM > 0) {
          var rawM = lines.slice(i, endM + 1).map(function (l) { return l.text; }).join('\n');
          blocks.push({ type: 'math', raw: rawM, start: startOffset, tex: rawM.replace(/^\s*\$\$\s*/, '').replace(/\s*\$\$\s*$/, '') });
          i = endM + 1; continue;
        }
      }

      // 单行公式 $$...$$
      var mo = RE_MATH_ONELINE.exec(text);
      if (mo && mo[1].trim()) {
        blocks.push({ type: 'math', raw: text, start: startOffset, tex: mo[1].trim() });
        i++; continue;
      }

      // 代码围栏
      var fm = fenceOf(text);
      if (fm) {
        var fence = fm[1];
        var info = fm[2].trim();
        var endF = -1;
        for (var f = i + 1; f < lines.length; f++) {
          var t2 = lines[f].text;
          if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*$').test(t2)) { endF = f; break; }
        }
        var lastLine = endF < 0 ? lines.length - 1 : endF;
        var rawF = lines.slice(i, lastLine + 1).map(function (l) { return l.text; }).join('\n');
        var body = lines.slice(i + 1, endF < 0 ? undefined : endF).map(function (l) { return l.text; }).join('\n');
        blocks.push({ type: 'code', raw: rawF, start: startOffset, lang: info.split(/\s+/)[0] || '', code: body, info: info, unclosed: endF < 0 });
        i = lastLine + 1; continue;
      }

      // ATX 标题（严格档要求 # 后有空白；容错档 ###Header 也算）
      var hm = atxOf(text);
      if (hm) {
        var level = hm[1].length;
        var htext = (hm[2] || '').replace(/[ \t]+#+[ \t]*$/, '');
        blocks.push({ type: 'h' + level, raw: text, start: startOffset, inline: htext, inlineOffset: startOffset + text.indexOf(hm[2] || '') });
        i++; continue;
      }

      // [TOC] 目录
      if (RE_TOC.test(text)) {
        blocks.push({ type: 'toc', raw: text, start: startOffset });
        i++; continue;
      }

      // 脚注定义 [^id]: 内容（后续缩进行算续写）
      var fd = RE_FOOTDEF.exec(text);
      if (fd) {
        var fdStart = i, fdBody = [fd[2] || ''];
        i++;
        while (i < lines.length) {
          var fl = lines[i].text;
          if (RE_BLANK.test(fl)) break;
          if (/^(?: {2,}|\t)/.test(fl)) { fdBody.push(fl.replace(/^[ \t]+/, '')); i++; continue; }
          break;
        }
        var rawFd = lines.slice(fdStart, i).map(function (l) { return l.text; }).join('\n');
        blocks.push({
          type: 'footdef', raw: rawFd, start: startOffset,
          fnId: fd[1], fnBody: fdBody.join('\n')
        });
        continue;
      }

      // 引用式链接定义行：本身不渲染，但保留在块模型里以便无损序列化
      var ld = RE_LINKDEF.exec(text);
      if (ld) {
        blocks.push({
          type: 'linkdef', raw: text, start: startOffset,
          defId: ld[1].trim().toLowerCase(), defHref: ld[2]
        });
        i++; continue;
      }

      // 分隔线
      if (RE_HR.test(text)) {
        blocks.push({ type: 'hr', raw: text, start: startOffset });
        i++; continue;
      }

      // 引用块
      if (RE_QUOTE.test(text)) {
        var qStart = i, qlines = [];
        while (i < lines.length && !RE_BLANK.test(lines[i].text)) {
          var lt = lines[i].text;
          if (RE_QUOTE.test(lt)) qlines.push(lt.replace(/^ {0,3}>[ \t]?/, ''));
          else if (RE_LIST.test(lt) || atxOf(lt) || fenceOf(lt)) break;
          else qlines.push(lt);
          i++;
        }
        var rawQ = lines.slice(qStart, i).map(function (l) { return l.text; }).join('\n');
        // GitHub Alerts / Callouts：首行 > [!NOTE]（可带自定义标题）
        var callout = null, calloutTitle = '', body = qlines;
        var cm = /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/.exec(qlines[0] || '');
        if (!STRICT && cm && CALLOUT[cm[1].toLowerCase()]) {
          callout = cm[1].toLowerCase();
          calloutTitle = cm[3] || '';
          body = qlines.slice(1);
        }
        blocks.push({
          type: 'quote', raw: rawQ, start: startOffset, inner: body.join('\n'),
          callout: callout, calloutTitle: calloutTitle
        });
        continue;
      }

      // 表格
      if (text.indexOf('|') >= 0 && lines[i + 1] && RE_TABLE_SEP.test(lines[i + 1].text) && lines[i + 1].text.indexOf('-') >= 0) {
        var tStart = i;
        i++;
        while (i < lines.length && !RE_BLANK.test(lines[i].text) && lines[i].text.indexOf('|') >= 0) i++;
        var rawT = lines.slice(tStart, i).map(function (l) { return l.text; }).join('\n');
        blocks.push({ type: 'table', raw: rawT, start: startOffset });
        continue;
      }

      // 列表
      if (RE_LIST.test(text)) {
        var lr = parseListTree(lines, i);
        var rawL = lines.slice(i, lr.end).map(function (l) { return l.text; }).join('\n');
        blocks.push({ type: 'list', raw: rawL, start: startOffset, items: lr.tree });
        i = lr.end; continue;
      }

      // HTML 块
      if (isHtmlBlock(text)) {
        var hs = i;
        var he = htmlEndLine(lines, i);
        if (he > i) i = he;
        else { while (i < lines.length && !RE_BLANK.test(lines[i].text)) i++; }
        var rawH = lines.slice(hs, i).map(function (l) { return l.text; }).join('\n');
        blocks.push({ type: 'html', raw: rawH, start: startOffset });
        continue;
      }

      // 段落（可被 setext 标题或新块打断）
      var pStart = i, plines = [text];
      i++;
      while (i < lines.length) {
        var pt = lines[i].text;
        if (RE_BLANK.test(pt)) break;
        if (RE_SETEQ1.test(pt)) {
          var rawS1 = lines.slice(pStart, i + 1).map(function (l) { return l.text; }).join('\n');
          var txtS1 = plines.join('\n');
          blocks.push({ type: 'h1', raw: rawS1, start: startOffset, inline: txtS1, inlineOffset: startOffset });
          i++; plines = null; break;
        }
        if (RE_SETEQ2.test(pt) && plines.length) {
          var rawS2 = lines.slice(pStart, i + 1).map(function (l) { return l.text; }).join('\n');
          var txtS2 = plines.join('\n');
          blocks.push({ type: 'h2', raw: rawS2, start: startOffset, inline: txtS2, inlineOffset: startOffset });
          i++; plines = null; break;
        }
        if (startsNewBlock(i)) break;
        plines.push(pt);
        i++;
      }
      if (plines) {
        var rawP = plines.join('\n');
        blocks.push({ type: 'para', raw: rawP, start: startOffset });
      }
    }

    // 计算块之间的原始间隔串，保证「解析 → 序列化」完全无损
    var gaps = [];
    var prevEnd = 0;
    for (var b = 0; b < blocks.length; b++) {
      gaps.push(src.slice(prevEnd, blocks[b].start));
      prevEnd = blocks[b].start + blocks[b].raw.length;
    }
    gaps.push(src.slice(prevEnd));

    // 每块带上定义表：renderBlock 单块渲染时也能解析引用式链接
    for (var bi = 0; bi < blocks.length; bi++) blocks[bi].defs = defs;

    return { blocks: blocks, gaps: gaps, source: src, defs: defs };
  }

  /* ---------------------------------------------------------- 块渲染
   * renderBlock 返回 { cls, html }：cls 为块的样式类，html 为「块内内容」。
   * 外层容器由编辑引擎统一套成 <div class="blk {cls}" data-i="n">，
   * 既保证每种块都能整块切换成 <textarea> 源码态，也让行内 data-s
   * 天然成为「块内相对偏移」，光标映射简单可靠。
   */
  function renderBlock(b) {
    var base = b.start || 0;
    CUR_DEFS = b.defs || {};
    switch (b.type) {
      case 'linkdef':
        // 定义行不参与显示（源码模式仍可见、可编辑）
        return { cls: 'linkdef', html: '' };
      case 'frontmatter': {
        var rows = b.raw.split('\n').map(function (l) {
          if (/^(---|\.\.\.)[ \t]*$/.test(l)) return '<div class="fm-rule">' + esc(l) + '</div>';
          var mm = /^([\w.-]+)\s*:\s*(.*)$/.exec(l);
          if (mm) return '<div class="fm-line"><span class="fm-key">' + esc(mm[1]) + '</span><span class="fm-colon">:</span> <span class="fm-val">' + esc(mm[2]) + '</span></div>';
          return '<div class="fm-line">' + esc(l) + '</div>';
        }).join('');
        return { cls: 'frontmatter', html: rows };
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        var lvl = b.type.slice(1);
        return {
          cls: 'h' + lvl,
          html: renderInline(b.inline != null ? b.inline : b.raw,
            b.inlineOffset != null ? b.inlineOffset : base)
        };
      }
      case 'hr':
        return { cls: 'hr', html: '<hr>' };
      case 'toc':
        // 内容由 Doc.decorate() 按当前文档的标题树填充（渲染时还不知道全文标题）
        return { cls: 'toc', html: '<div class="toc-body" data-toc="1"></div>' };
      case 'footdef': {
        var p = b.raw.indexOf(']');
        var bodyOff = base + (p < 0 ? 0 : p + 1);
        return {
          cls: 'fn-def',
          html: '<span class="fn-num" data-fn-num="' + esc(b.fnId || '') + '"></span>' +
            '<span class="fn-text">' + renderInline(b.fnBody || '', bodyOff) + '</span>'
        };
      }
      case 'quote': {
        var inner = parseBlocks(b.inner || '', b.defs);
        if (b.callout) {
          var meta = CALLOUT[b.callout] || { title: b.callout, icon: '' };
          var ttl = b.calloutTitle || meta.title;
          return {
            cls: 'quote callout',
            html: '<blockquote class="callout callout-' + esc(b.callout) + '">' +
              '<div class="callout-title"><span class="callout-icon">' + meta.icon + '</span>' +
              '<span class="callout-name">' + esc(ttl) + '</span></div>' +
              renderBlocks(inner.blocks, true) + '</blockquote>'
          };
        }
        return { cls: 'quote', html: '<blockquote>' + renderBlocks(inner.blocks, true) + '</blockquote>' };
      }
      case 'code': {
        var codeLines = String(b.code || '').split('\n');
        var gutter = CODE_LINENO
          ? '<div class="code-gutter" aria-hidden="true">' +
            codeLines.map(function (_, k) { return k + 1; }).join('\n') + '</div>'
          : '';
        var cur = langKey(b.lang || 'text') || 'text';
        var sel = '<select class="code-lang-sel" title="选择语言">' +
          CODE_LANGS.map(function (l) {
            var hit = langKey(l[0]) === cur;
            return '<option value="' + esc(l[0]) + '"' + (hit ? ' selected' : '') + '>' +
              esc(l[1]) + '</option>';
          }).join('') + '</select>';
        return {
          cls: 'code' + (CODE_LINENO ? ' has-lines' : ''),
          html: '<div class="code-bar">' + sel +
            '<button class="code-copy" type="button" title="复制代码">复制</button></div>' +
            '<div class="code-body">' + gutter + '<pre><code class="language-' + esc(b.lang || 'text') + '">' +
            highlight(b.code || '', b.lang) + '</code></pre></div>'
        };
      }
      case 'math':
        return { cls: 'mathblock', html: texToHTML(b.tex || '', true) };
      case 'table':
        return { cls: 'table', html: tableHTML(b.raw, base) };
      case 'list': {
        var isTask = b.items.some(function (it) { return it.task !== null; });
        return { cls: 'list' + (isTask ? ' task-list' : ''), html: listHTML(b.items, base, b.items.length ? b.items[0].ordered : false) };
      }
      case 'html':
        // 原样渲染成真 HTML；点一下整块切回 textarea 源码态。
        // html-body 里没有 data-s，所以点击一律落到块首，不会算出奇怪的偏移。
        return { cls: 'html', html: '<div class="html-body">' + balanceHTML(cleanHTML(b.raw)) + '</div>' };
      default:
        return { cls: 'para', html: renderInline(b.raw, base) };
    }
  }

  function renderBlocks(blocks, flat) {
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      var r = renderBlock(blocks[i]);
      out += '<div class="blk ' + r.cls + '"' + (flat ? '' : ' data-i="' + i + '"') + '>' + r.html + '</div>';
    }
    return out;
  }

  // 由块模型还原 Markdown（edit 用的模型与解析模型同构）
  function serialize(model) {
    var s = model.gaps[0] || '';
    for (var i = 0; i < model.blocks.length; i++) {
      s += model.blocks[i].raw;
      s += model.gaps[i + 1] || '';
    }
    return s;
  }

  // 大纲：抽取标题
  function outline(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (/^h[1-6]$/.test(b.type)) {
        var txt = (b.inline != null ? b.inline : b.raw).replace(/[*_`~]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
        out.push({ level: +b.type.slice(1), text: txt.trim(), index: i });
      }
    }
    return out;
  }

  function countWords(text) {
    var cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || []).length;
    var rest = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g, ' ');
    var words = (rest.match(/[A-Za-z0-9][A-Za-z0-9'’_\-]*/g) || []).length;
    return { words: cjk + words, chars: text.length, cjk: cjk };
  }

  /* ------------------------------------------------ 查找 / 替换
   * 全部按「全文原始文本」的字符偏移计算，与块模型的 starts() 对应，
   * 这样渲染态、源码态、分栏态可以共用同一套匹配结果。
   */
  var MAX_MATCHES = 5000;

  function escapeRe(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function makeRe(query, opt) {
    var opts = opt || {};
    var flags = 'g' + (opts.caseSensitive ? '' : 'i');
    var body = opts.regex ? query : escapeRe(query);
    if (opts.wholeWord) body = '(?<![\\w\\u4e00-\\u9fff])' + body + '(?![\\w\\u4e00-\\u9fff])';
    return new RegExp(body, flags);
  }

  // 返回 [{start,end,text}]；query 为空返回 []；正则非法返回 null
  function findAll(text, query, opt) {
    text = String(text == null ? '' : text);
    query = String(query == null ? '' : query);
    if (!query) return [];
    var re;
    try { re = makeRe(query, opt); } catch (e) { return null; }
    var out = [], m, guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') {                 // 零宽匹配（如 ^ 或 a*）：跳过，避免死循环
        re.lastIndex++;
        if (++guard > MAX_MATCHES) break;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }

  // 返回 {text, count}；非正则模式下替换串按字面处理（$ 不当反向引用）
  function replaceAll(text, query, rep, opt) {
    text = String(text == null ? '' : text);
    rep = rep == null ? '' : String(rep);
    var hits = findAll(text, query, opt);
    if (!hits || !hits.length) return { text: text, count: 0 };
    var re = makeRe(query, opt);
    var out = (opt && opt.regex)
      ? text.replace(re, rep)
      : text.replace(re, function () { return rep; });
    return { text: out, count: hits.length };
  }

  return {
    parse: parseBlocks,
    renderBlock: renderBlock,
    renderBlocks: renderBlocks,
    renderInline: renderInline,
    renderDocument: function (src) { var m = parseBlocks(src); return renderBlocks(m.blocks, false); },
    serialize: serialize,
    outline: outline,
    countWords: countWords,
    findAll: findAll,
    replaceAll: replaceAll,
    highlight: highlight,
    // 测试用：高亮表覆盖了哪些语言（应与 CODE_LANGS 除 text 外一一对应）
    hlLangs: function () { return Object.keys(LANG); },
    texToHTML: texToHTML,
    texFallback: texFallback,
    tableModel: tableModel,
    serialTable: serialTable,
    readWiki: readWiki,
    readImage: readImage,
    wikiHref: wikiHref,
    cleanHTML: cleanHTML,
    htmlText: htmlText,
    scanLinkDefs: scanLinkDefs,
    setCodeLineNo: function (on) { CODE_LINENO = !!on; },
    setStrict: function (on) { STRICT = !!on; },
    isStrict: function () { return STRICT; },
    // 补全下拉要用全部名字（按键名排序，稳定）
    emojiNames: function () {
      if (!EMOJI_NAMES) EMOJI_NAMES = Object.keys(EMOJI).sort();
      return EMOJI_NAMES;
    },
    CODE_LANGS: CODE_LANGS,
    LANG_ALIAS: LANG_ALIAS,
    langKey: langKey,
    EMOJI: EMOJI,
    emojiOf: function (code) { return EMOJI[String(code).toLowerCase()] || ''; },
    escape: esc
  };
});
