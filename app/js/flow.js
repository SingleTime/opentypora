/* ============================================================
 * flow.js — flowchart.js 语法图表渲染（纯 JS，零依赖）
 *
 * 为什么自己画：flowchart.js 本体是 npm 包，这个项目不引外部依赖
 * （mermaid 3.4 MB 已经是上限）。流程图语法子集足够小——节点声明 +
 * 有向边，值得内建：解析、分层布局、SVG 输出全在纯函数里，可单测。
 *
 * 语法（flowchart.js v1.x 常用子集）：
 *   st=>start: 开始          // 节点：id=>类型: 标签
 *   op=>operation: 处理      // 类型：start/end/operation/condition/
 *   cond=>condition: 是否?   //       inputoutput/subroutine
 *   io=>inputoutput: 录入
 *   st->op                   // 边（可链式 a->b->c）
 *   st->op: 说明             // 边标签
 *   cond(yes)->e             // 条件分支（等价 cond:yes->e）
 *
 * 布局：最长路分层 + 层内按声明序排开；同层边走横线，
 * 回边（指向祖先层）绕右侧。不追求 flowchart.js 的跨层优化，
 * 但保证常见流程图直来直去、可读。
 * ============================================================ */
var Flow = (function () {
  'use strict';

  var SHAPES = {
    start: 1, end: 1, operation: 1, condition: 1, inputoutput: 1, subroutine: 1
  };
  var MAX_W = 220;          // 单行标签最宽（px），超出自动换行
  var NODE_H = 44;          // 常规节点高
  var COND_H = 58;          // 菱形要高一些才放得下文字
  var GAP_X = 46;           // 同层节点间距
  var GAP_Y = 52;           // 层间距
  var PAD = 14;             // 画布内边距
  var SKEW = 12;            // 平行四边形斜边

  /* ---------------------------------------------------------- 文本宽度
   * CJK / 全角按 2 个 ASCII 宽算，等宽场景下够用。
   */
  function textWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += (c > 0x2e7f && c < 0x1d000) ? 2 : 1;   // 粗略覆盖 CJK 与 emoji 区
    }
    return w;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 标签按宽度折行：显式 \n 优先，超长再按字符切 */
  function wrap(label) {
    var out = [];
    String(label == null ? '' : label).split('\n').forEach(function (seg) {
      var line = '', w = 0;
      for (var i = 0; i < seg.length; i++) {
        var ch = seg[i], cw = textWidth(ch);
        if (w + cw > MAX_W / 9 && line) { out.push(line); line = ''; w = 0; }
        line += ch; w += cw;
      }
      out.push(line);
    });
    return out.length ? out : [''];
  }

  function nodeSize(label, shape) {
    var lines = wrap(label);
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, textWidth(l) * 9); });
    w = Math.max(72, Math.min(MAX_W, w + 28));
    if (shape === 'condition') w = Math.max(w + 26, 110);   // 菱形要更宽才不憋
    if (shape === 'inputoutput') w += SKEW + 8;
    return { w: Math.round(w), h: shape === 'condition' ? COND_H : NODE_H, lines: lines };
  }

  /* ---------------------------------------------------------- 解析 */
  // 节点声明：id=>type: label（label 可省略；id 之后允许空格）
  var RE_NODE = /^\s*([A-Za-z0-9_.\-]+)\s*=>\s*([A-Za-z]+)\s*(?::\s*([\s\S]*))?$/;
  // 边：左右两端都是「节点引用」，可带 (label) 或 :label；整体可链式
  var RE_EDGE = /^\s*([\s\S]+?)\s*->\s*([\s\S]+)$/;

  // 解析一侧的节点引用：id / id(label) / id:label；
  // label 外层如果是 |...|（flowchart.js 的管道写法）也剥掉
  function parseRef(side) {
    var s = String(side).trim();
    var m = /^([A-Za-z0-9_.\-]+)\s*\(([^)]*)\)\s*$/.exec(s);
    if (m) return { id: m[1], label: cleanLabel(m[2]) };
    m = /^([A-Za-z0-9_.\-]+)\s*:\s*([\s\S]*)$/.exec(s);
    if (m) return { id: m[1], label: cleanLabel(m[2]) };
    m = /^([A-Za-z0-9_.\-]+)\s*$/.exec(s);
    if (m) return { id: m[1], label: null };
    return null;
  }

  function cleanLabel(s) {
    return String(s == null ? '' : s).replace(/^\|([\s\S]*)\|$/, '$1');
  }

  function parse(src) {
    var lines = String(src == null ? '' : src).split('\n');
    var nodes = {}, order = [], edges = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\r$/, '');
      if (!line.trim()) continue;
      var nm = RE_NODE.exec(line);
      if (nm) {
        var id = nm[1], type = nm[2].toLowerCase();
        if (!SHAPES[type]) throw new Error('第 ' + (i + 1) + ' 行：未知节点类型「' + nm[2] + '」');
        if (nodes[id]) throw new Error('第 ' + (i + 1) + ' 行：节点「' + id + '」重复声明');
        nodes[id] = { id: id, shape: type, label: cleanLabel(nm[3] == null ? id : nm[3]).replace(/\\n/g, '\n').trim() };
        order.push(id);
        continue;
      }
      var em = RE_EDGE.exec(line);
      if (em) {
        // 链式 a->b->c：按 -> 切开，逐段取节点引用；
        // 单独一段 |标签|（管道写法）是下一条边的标签
        var parts = line.split('->');
        if (parts.length < 2) throw new Error('第 ' + (i + 1) + ' 行：无法解析的边「' + line.trim() + '」');
        var prev = null, pending = null;
        for (var p = 0; p < parts.length; p++) {
          var seg = parts[p].trim();
          var pm = /^\|([\s\S]*)\|$/.exec(seg);
          if (pm) {
            if (pending != null) throw new Error('第 ' + (i + 1) + ' 行：连续两个边标签');
            pending = pm[1];
            continue;
          }
          var ref = parseRef(seg);
          if (!ref) throw new Error('第 ' + (i + 1) + ' 行：无法解析的节点引用「' + seg + '」');
          if (prev) {
            edges.push({ from: prev.id, to: ref.id, label: pending != null ? pending : prev.label });
          } else if (pending != null) {
            throw new Error('第 ' + (i + 1) + ' 行：边标签前面没有节点');
          }
          pending = null;
          prev = ref;
        }
        continue;
      }
      throw new Error('第 ' + (i + 1) + ' 行：无法解析「' + line.trim() + '」');
    }
    // 边上引用的节点必须声明过（flowchart.js 同样报错，不让错别名悄悄出图）
    edges.forEach(function (e) {
      if (!nodes[e.from]) throw new Error('边引用了未定义的节点「' + e.from + '」');
      if (!nodes[e.to]) throw new Error('边引用了未定义的节点「' + e.to + '」');
    });
    if (!order.length) throw new Error('图里没有节点');
    return { nodes: nodes, order: order, edges: edges };
  }

  /* ---------------------------------------------------------- 分层布局 */
  // DFS 找回边（指向栈中节点的边）。有环时从回边处断开，剩下的就是 DAG，
  // 最长路分层一定收敛——直接松弛会被环一路抬高层号。
  function backEdges(g) {
    var state = {}, back = [];
    function dfs(n) {
      state[n] = 1;
      for (var i = 0; i < g.edges.length; i++) {
        var e = g.edges[i];
        if (e.from !== n) continue;
        if (state[e.to] === 1) back.push(e);
        else if (!state[e.to]) dfs(e.to);
      }
      state[n] = 2;
    }
    g.order.forEach(function (n) { if (!state[n]) dfs(n); });
    return back;
  }

  function layout(g) {
    var nodes = g.nodes, order = g.order;
    if (!order.length) throw new Error('图里没有节点');
    var layer = {}, i, id, e;
    order.forEach(function (n) { layer[n] = 0; });
    var back = backEdges(g);
    var isBack = {};
    back.forEach(function (e) { isBack[e.from + '\u0001' + e.to] = 1; });
    // 在 DAG（去掉回边）上做最长路松弛：轮数上限是节点数，一定收敛
    var rounds = order.length + 1;
    for (var r = 0; r < rounds; r++) {
      var moved = false;
      for (i = 0; i < g.edges.length; i++) {
        e = g.edges[i];
        if (isBack[e.from + '\u0001' + e.to]) continue;
        if (layer[e.to] < layer[e.from] + 1) { layer[e.to] = layer[e.from] + 1; moved = true; }
      }
      if (!moved) break;
    }
    // 层内排序：按声明序（稳定，符合手写顺序）
    var byLayer = {};
    order.forEach(function (n) {
      var L = layer[n];
      (byLayer[L] || (byLayer[L] = [])).push(n);
    });
    var maxLayer = 0;
    for (var k in byLayer) maxLayer = Math.max(maxLayer, +k);

    // 量尺寸
    var size = {};
    order.forEach(function (n) { size[n] = nodeSize(nodes[n].label, nodes[n].shape); });

    // 每层的宽度与整体高度
    var layerW = {}, layerH = {}, totalW = 0;
    for (var L = 0; L <= maxLayer; L++) {
      var list = byLayer[L] || [];
      var w = 0, h = 0;
      list.forEach(function (n, idx) {
        w += size[n].w + (idx ? GAP_X : 0);
        h = Math.max(h, size[n].h);
      });
      layerW[L] = w; layerH[L] = h;
      totalW = Math.max(totalW, w);
    }
    var totalH = 0;
    for (var L2 = 0; L2 <= maxLayer; L2++) totalH += layerH[L2] + (L2 ? GAP_Y : 0);

    // 定位：层内水平居中，纵向按层高累加
    var pos = {}, y = PAD;
    for (var L3 = 0; L3 <= maxLayer; L3++) {
      var list3 = byLayer[L3] || [];
      var x = PAD + (totalW - layerW[L3]) / 2;
      list3.forEach(function (n) {
        pos[n] = { x: Math.round(x), y: Math.round(y + (layerH[L3] - size[n].h) / 2) };
        x += size[n].w + GAP_X;
      });
      y += layerH[L3] + GAP_Y;
    }

    /* ---------- 边走线：全部正交，横向只走层间间隙、纵向只走画布两侧 ----------
     * 回边（指向祖先层）如果从源节点侧面直接横出，会穿过同层的兄弟节点
     * （fix->input 就撞上了旁边的 sub）。改成：源节点底边下到间隙 →
     * 横走到画布外的纵向通道 → 上行到目标层上方的间隙 → 横到目标列 →
     * 向下进目标顶边。横向段都在没有节点的间隙里，纵向段在所有节点外侧。
     */
    var minX = Infinity, maxX = -Infinity;
    order.forEach(function (n) {
      minX = Math.min(minX, pos[n].x);
      maxX = Math.max(maxX, pos[n].x + size[n].w);
    });
    var laneL = minX - 24, laneR = maxX + 24;

    function box(n) {
      return { x: pos[n].x, y: pos[n].y, w: size[n].w, h: size[n].h };
    }
    var routes = [];
    g.edges.forEach(function (e) {
      var a = box(e.from), b = box(e.to);
      var pts, labelPos;
      if (layer[e.to] > layer[e.from]) {
        var p1 = anchor(nodes[e.from], a, 'bottom');
        var p2 = anchor(nodes[e.to], b, 'top');
        pts = [p1, p2];
        labelPos = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      } else if (layer[e.to] === layer[e.from]) {
        // 同层：按声明序决定左右方向，右边出、左边进
        var l2r = order.indexOf(e.from) < order.indexOf(e.to);
        var s1 = anchor(nodes[e.from], a, l2r ? 'right' : 'left');
        var s2 = anchor(nodes[e.to], b, l2r ? 'left' : 'right');
        pts = [s1, s2];
        labelPos = [(s1[0] + s2[0]) / 2, (s1[1] + s2[1]) / 2 - 10];
      } else {
        // 回边：目标在源左边就走左通道，否则走右通道
        var left = (b.x + b.w / 2) <= (a.x + a.w / 2);
        var laneX = left ? laneL : laneR;
        var sBot = anchor(nodes[e.from], a, 'bottom');
        var tTop = anchor(nodes[e.to], b, 'top');
        var gapA = a.y + a.h + GAP_Y * 0.5;      // 源层下方的间隙
        var gapB = b.y - GAP_Y * 0.5;            // 目标层上方的间隙
        pts = [sBot, [sBot[0], gapA], [laneX, gapA], [laneX, gapB], [tTop[0], gapB], tTop];
        labelPos = [laneX + (left ? 6 : -6), (gapA + gapB) / 2];
      }
      routes.push({ from: e.from, to: e.to, label: e.label, pts: pts, labelPos: labelPos });
    });

    // 画布 = 节点与所有走线点、标签的外包框 + 内边距（回边会伸到画布外，必须算进来）
    var bx0 = minX, bx1 = maxX, by0 = PAD, by1 = totalH + PAD;
    routes.forEach(function (r) {
      r.pts.forEach(function (p) {
        bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]);
        by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]);
      });
      if (r.label) {
        var lw = textWidth(r.label) * 9 + 10;
        bx0 = Math.min(bx0, r.labelPos[0] - lw / 2);
        bx1 = Math.max(bx1, r.labelPos[0] + lw / 2);
      }
    });

    return {
      nodes: nodes, order: order, edges: g.edges, size: size, pos: pos,
      layer: layer, maxLayer: maxLayer, routes: routes,
      width: Math.round(bx1 - bx0 + PAD * 2), height: Math.round(by1 - by0 + PAD * 2),
      offsetX: Math.round(PAD - bx0), offsetY: Math.round(PAD - by0)
    };
  }

  /* ---------------------------------------------------------- SVG */
  var PALETTE = {
    light: { fill: '#ffffff', stroke: '#8c959f', text: '#24292f', edge: '#57606a', labelBg: '#ffffff' },
    dark: { fill: '#161b22', stroke: '#8b949e', text: '#c9d1d9', edge: '#8b949e', labelBg: '#161b22' }
  };

  function shapeSvg(n, p, pal) {
    var x = p.x, y = p.y, w = p.w, h = p.h;
    var fill = pal.fill, stroke = pal.stroke;
    var s = '';
    if (n.shape === 'condition') {
      var cx = x + w / 2, cy = y + h / 2;
      s += '<polygon points="' + cx + ',' + y + ' ' + (x + w) + ',' + cy + ' ' +
        cx + ',' + (y + h) + ' ' + x + ',' + cy + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"/>';
    } else if (n.shape === 'inputoutput') {
      s += '<polygon points="' + (x + SKEW) + ',' + y + ' ' + (x + w) + ',' + y + ' ' +
        (x + w - SKEW) + ',' + (y + h) + ' ' + x + ',' + (y + h) +
        '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"/>';
    } else if (n.shape === 'subroutine') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + fill +
        '" stroke="' + stroke + '" stroke-width="1.4"/>';
      s += '<line x1="' + (x + 7) + '" y1="' + y + '" x2="' + (x + 7) + '" y2="' + (y + h) + '" stroke="' + stroke + '"/>';
      s += '<line x1="' + (x + w - 7) + '" y1="' + y + '" x2="' + (x + w - 7) + '" y2="' + (y + h) + '" stroke="' + stroke + '"/>';
    } else if (n.shape === 'start' || n.shape === 'end') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (h / 2) +
        '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"/>';
    } else {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + fill +
        '" stroke="' + stroke + '" stroke-width="1.4"/>';
    }
    // 文字：多行时按行高均摊
    var lines = p.lines, lh = 16, cy0 = p.y + p.h / 2 - (lines.length - 1) * lh / 2;
    lines.forEach(function (l, idx) {
      s += '<text x="' + (p.x + p.w / 2) + '" y="' + (cy0 + idx * lh) +
        '" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="' + pal.text +
        '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">' +
        esc(l) + '</text>';
    });
    return s;
  }

  function anchor(n, p, side) {
    if (n.shape === 'condition') {
      var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (side === 'top') return [cx, p.y];
      if (side === 'bottom') return [cx, p.y + p.h];
      if (side === 'left') return [p.x, cy];
      return [p.x + p.w, cy];
    }
    if (side === 'top') return [p.x + p.w / 2, p.y];
    if (side === 'bottom') return [p.x + p.w / 2, p.y + p.h];
    if (side === 'left') return [p.x, p.y + p.h / 2];
    return [p.x + p.w, p.y + p.h / 2];
  }

  function edgePath(r, pal, ox, oy) {
    var pts = r.pts.map(function (p) { return [p[0] + ox, p[1] + oy]; });
    var d = 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
    var s = '<path d="' + d + '" fill="none" stroke="' + pal.edge +
      '" stroke-width="1.3" marker-end="url(#flow-arrow)"/>';
    if (r.label) {
      var lx = r.labelPos[0] + ox, ly = r.labelPos[1] + oy;
      var w = Math.max(10, textWidth(r.label) * 9 + 10);
      s += '<rect x="' + (lx - w / 2) + '" y="' + (ly - 9) + '" width="' + w +
        '" height="16" rx="3" fill="' + pal.labelBg + '" opacity="0.92"/>';
      s += '<text x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="middle"' +
        ' font-size="11.5" fill="' + pal.text + '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">' +
        esc(r.label) + '</text>';
    }
    return s;
  }

  /* src: 流程图源码；dark: 是否深色配色。返回 SVG 字符串，语法错误抛错。 */
  function svg(src, opts) {
    opts = opts || {};
    var pal = PALETTE[opts.dark ? 'dark' : 'light'];
    var m = layout(parse(src));
    var ox = m.offsetX, oy = m.offsetY;
    var body = '';
    m.order.forEach(function (id) {
      var n = m.nodes[id], p = m.pos[id], sz = m.size[id];
      body += shapeSvg(n, { x: p.x + ox, y: p.y + oy, w: sz.w, h: sz.h, lines: sz.lines }, pal);
    });
    m.routes.forEach(function (r) { body += edgePath(r, pal, ox, oy); });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + m.width + ' ' + m.height +
      '" width="' + m.width + '" height="' + m.height + '" role="img" aria-label="flowchart">' +
      '<defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">' +
      '<path d="M0,0 L7,3 L0,6 z" fill="' + pal.edge + '"/></marker></defs>' +
      '<g>' + body + '</g></svg>';
  }

  /* ---------------------------------------------------------- DOM 集成 */
  function isDark() {
    try {
      var bg = getComputedStyle(document.body).backgroundColor || '';
      var m = /rgba?\(([^)]+)\)/.exec(bg);
      if (!m) return false;
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 128;
    } catch (e) { return false; }
  }

  function themeSig() {
    return (document.documentElement.getAttribute('data-theme') || '') + (isDark() ? ':dark' : ':light');
  }

  function blockOf(code) {
    var el = code;
    while (el && el.nodeType === 1 && !(el.classList && el.classList.contains('blk'))) el = el.parentNode;
    return el && el.classList && el.classList.contains('blk') ? el : null;
  }

  var cache = {};

  function paint(code, svgStr) {
    var host = blockOf(code);
    if (!host) return;
    host.classList.add('flow-on');
    host.classList.remove('flow-err');
    var fig = host.querySelector('.flow-fig');
    if (!fig) {
      fig = document.createElement('div');
      fig.className = 'flow-fig';
      host.appendChild(fig);
    }
    fig.innerHTML = svgStr;
  }

  function fail(code, err) {
    var host = blockOf(code);
    if (!host) return;
    host.classList.remove('flow-on');
    host.classList.add('flow-err');
    var old = host.querySelector('.flow-msg');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'flow-msg';
    d.textContent = 'Flowchart: ' + String((err && err.message) || err || '渲染失败').slice(0, 300);
    host.appendChild(d);
  }

  /* 把 root 里所有未渲染的 flowchart 代码块处理掉 */
  function renderAll(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var codes = root.querySelectorAll('pre > code.language-flow, pre > code.language-flowchart');
    var sig = themeSig();
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i], host = blockOf(code);
      var src = code.textContent;
      var key = sig + '\u0001' + src;
      if (host && host.getAttribute('data-fl') === key && host.querySelector('.flow-fig')) continue;
      if (host) {
        host.setAttribute('data-fl', key);
        var of = host.querySelector('.flow-fig'); if (of) of.remove();
        var om = host.querySelector('.flow-msg'); if (om) om.remove();
        host.classList.remove('flow-on');
        host.classList.remove('flow-err');
      }
      try {
        var s = cache[key];
        if (!s) { s = svg(src, { dark: isDark() }); cache[key] = s; }
        paint(code, s);
      } catch (err) {
        fail(code, err);
      }
    }
  }

  function refresh() {
    var all = document.querySelectorAll('.blk.flow-on, .blk.flow-err');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('flow-on');
      all[i].classList.remove('flow-err');
      var f = all[i].querySelector('.flow-fig'); if (f) f.remove();
      var m = all[i].querySelector('.flow-msg'); if (m) m.remove();
      all[i].removeAttribute('data-fl');
    }
    renderAll(document);
  }

  function isFlow(el) {
    return !!(el && el.querySelector && el.querySelector('pre > code.language-flow, pre > code.language-flowchart'));
  }

  return {
    parse: parse, layout: layout, svg: svg,
    renderAll: renderAll, refresh: refresh, isFlow: isFlow,
    themeSig: themeSig, _cache: cache
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Flow;
