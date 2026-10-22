/* ============================================================
 * tabs.js — 标签页的状态机（纯函数，可单独 require 做单测）
 *
 * 状态：{ list: [tab], active: id|null, seq: n }
 * tab ：{ id, path, name, dirty, doc }
 *
 * doc 只在「非活动」标签里有意义 —— 活动标签的正文活在 Editor 里，
 * 切换前由 Editor.snapshotDoc() 拍一张存进来（正文 + 路径 + 撤销栈 + 滚动位置）。
 *
 * 约定：
 *   - 同一个 path 只开一个标签（重复打开就切过去，不覆盖已有内容）
 *   - 未命名标签（path 为 null）永远新建，名字依次排到「未命名 2.md」
 *   - 所有函数都不改入参，返回新状态
 * ============================================================ */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tabs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 24;                 // 上限，防手滑刷出几百个标签
  var UNTITLED = '未命名.md';

  function make() {
    return { list: [], active: null, seq: 0 };
  }

  function normPath(p) {
    if (!p) return '';
    return String(p).replace(/\/{2,}/g, '/');
  }

  function indexOf(state, id) {
    var list = (state && state.list) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  function find(state, id) {
    var i = indexOf(state, id);
    return i < 0 ? null : state.list[i];
  }

  function activeTab(state) {
    return state ? find(state, state.active) : null;
  }

  function findByPath(state, path) {
    var p = normPath(path);
    if (!p) return null;
    var list = (state && state.list) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].path && normPath(list[i].path) === p) return list[i];
    }
    return null;
  }

  /* 新建一个候选标签（id 与「未命名 N」由 add 决定） */
  function create(name, path, doc) {
    return {
      path: normPath(path) || null,
      name: name || baseName(path) || '',
      dirty: false,
      doc: doc || null
    };
  }

  function baseName(p) {
    if (!p) return '';
    var a = String(p).split('/');
    return a[a.length - 1] || '';
  }

  /* 未命名文档的默认名：未命名.md / 未命名 2.md / 未命名 3.md …
   * 只在「未命名」标签之间去重，已有文件的同名不算冲突。 */
  function untitled(state) {
    var used = {};
    var list = (state && state.list) || [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].path) used[list[i].name] = 1;
    }
    if (!used[UNTITLED]) return UNTITLED;
    for (var n = 2; n < 999; n++) {
      var cand = '未命名 ' + n + '.md';
      if (!used[cand]) return cand;
    }
    return UNTITLED;
  }

  /* 加一个标签并切过去。
   * 同 path 已存在 → 复用（返回 reused: true，不覆盖内容）。
   * 到上限 → 状态不变（返回 full: true，tab 为 null）。 */
  function add(state, tab) {
    var s = state || make();
    var t = tab || {};
    var path = normPath(t.path) || null;

    if (path) {
      var dup = findByPath(s, path);
      if (dup) {
        // 已经开着就切过去（不覆盖里面可能还没保存的内容）
        return { state: activate(s, dup.id), tab: dup, reused: true, full: false };
      }
    }
    if (s.list.length >= MAX) return { state: s, tab: null, reused: false, full: true };

    var seq = (s.seq || 0) + 1;
    var item = {
      id: 't' + seq,
      path: path,
      name: t.name || baseName(path) || (path ? UNTITLED : untitled(s)),
      dirty: !!t.dirty,
      doc: t.doc || null
    };
    return {
      state: { list: s.list.concat([item]), active: item.id, seq: seq },
      tab: item, reused: false, full: false
    };
  }

  function activate(state, id) {
    var s = state || make();
    if (indexOf(s, id) < 0) return s;
    if (s.active === id) return s;
    return { list: s.list.slice(), active: id, seq: s.seq };
  }

  /* 关闭。nextId 是关掉之后该激活谁：
   * 关活动页 → 右边那个，右边没有就左边；关非活动页 → 活动页不动。 */
  function close(state, id) {
    var s = state || make();
    var i = indexOf(s, id);
    if (i < 0) return { state: s, tab: null, nextId: s.active, closedActive: false };
    var tab = s.list[i];
    var list = s.list.slice(0, i).concat(s.list.slice(i + 1));
    var wasActive = s.active === id;
    var nextId = s.active;
    if (wasActive) {
      var after = list[i] || list[i - 1] || null;
      nextId = after ? after.id : null;
    }
    return {
      state: { list: list, active: nextId, seq: s.seq },
      tab: tab, nextId: nextId, closedActive: wasActive
    };
  }

  function patch(state, id, fields) {
    var s = state || make();
    var i = indexOf(s, id);
    if (i < 0) return s;
    var t = s.list[i], merged = {};
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) merged[k] = t[k];
    for (var j in fields) if (Object.prototype.hasOwnProperty.call(fields, j)) merged[j] = fields[j];
    var list = s.list.slice();
    list[i] = merged;
    return { list: list, active: s.active, seq: s.seq };
  }

  function patchAll(state, fields) {
    var s = state || make();
    var list = s.list.map(function (t) {
      var m = {};
      for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) m[k] = t[k];
      for (var j in fields) if (Object.prototype.hasOwnProperty.call(fields, j)) m[j] = fields[j];
      return m;
    });
    return { list: list, active: s.active, seq: s.seq };
  }

  /* 循环切换：dir = 1 下一个，-1 上一个，越界绕回 */
  function cycle(state, dir) {
    var s = state || make();
    var n = s.list.length;
    if (n < 2) return s;
    var i = indexOf(s, s.active);
    if (i < 0) i = 0;
    var k = ((i + (dir < 0 ? -1 : 1)) % n + n) % n;
    return activate(s, s.list[k].id);
  }

  function count(state) { return ((state && state.list) || []).length; }

  function order(state) {
    return ((state && state.list) || []).map(function (t) { return t.id; });
  }

  function paths(state) {
    return ((state && state.list) || []).filter(function (t) { return !!t.path; })
      .map(function (t) { return t.path; });
  }

  function label(tab) { return (tab && tab.name) || UNTITLED; }

  /* 窗口标题 / tooltip 用：脏了前面加个圆点 */
  function title(tab) {
    return (tab && tab.dirty ? '● ' : '') + label(tab);
  }

  /* ------------------------------------------------ 会话（重启后还原整排标签）
   * 只存有落点的标签（path 非空）与前台的 path。未命名标签不进去 ——
   * 它没有磁盘落点，正文属于「草稿」那条路（Workbench.saveDraft）。
   */
  var SESSION_VERSION = 1;

  /* 存盘形状：{ v, paths: [...], active: path|null } */
  function sessionOf(state) {
    var s = state || make();
    var seen = {}, paths = [];
    for (var i = 0; i < s.list.length; i++) {
      var p = normPath(s.list[i] && s.list[i].path);
      if (!p || seen[p]) continue;
      seen[p] = 1;
      if (paths.length < MAX) paths.push(p);
    }
    var at = activeTab(s);
    var act = at ? normPath(at.path) : '';
    return {
      v: SESSION_VERSION,
      paths: paths,
      active: (act && seen[act]) ? act : null
    };
  }

  /* 读回会话：形状不对就当没有（返回 null）；坏一条丢一条，不影响别的。
   * 只认绝对路径 —— 相对路径换个工作目录就指到别处去了，宁可不恢复。 */
  function parseSession(raw) {
    var o = raw;
    if (typeof raw === 'string') {
      if (!raw) return null;
      try { o = JSON.parse(raw); } catch (e) { return null; }
    }
    if (!o || typeof o !== 'object' || !Array.isArray(o.paths)) return null;
    var seen = {}, out = [], dropped = 0;
    for (var i = 0; i < o.paths.length; i++) {
      var p = typeof o.paths[i] === 'string' ? normPath(o.paths[i]).trim() : '';
      if (p.charAt(0) !== '/' || p.length < 2 || seen[p] || out.length >= MAX) {
        dropped++;
        continue;
      }
      seen[p] = 1;
      out.push(p);
    }
    if (!out.length) return null;
    var act = typeof o.active === 'string' ? normPath(o.active) : '';
    return { paths: out, active: seen[act] ? act : out[0], dropped: dropped };
  }

  return {
    MAX: MAX,
    SESSION_VERSION: SESSION_VERSION,
    make: make,
    create: create,
    find: find,
    indexOf: indexOf,
    activeTab: activeTab,
    findByPath: findByPath,
    untitled: untitled,
    add: add,
    activate: activate,
    close: close,
    patch: patch,
    patchAll: patchAll,
    cycle: cycle,
    count: count,
    order: order,
    paths: paths,
    label: label,
    title: title,
    baseName: baseName,
    normPath: normPath,
    sessionOf: sessionOf,
    parseSession: parseSession
  };
});
