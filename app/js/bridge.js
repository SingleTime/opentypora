/* bridge.js — 与 Swift 原生壳通信（无原生环境时优雅降级） */
var Bridge = (function () {
  'use strict';
  var seq = 0, pending = {};

  function hasNative() {
    return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge);
  }

  function call(method, params) {
    if (!hasNative()) return Promise.reject(new Error('no-native'));
    return new Promise(function (res, rej) {
      var id = 'r' + (++seq);
      pending[id] = { res: res, rej: rej };
      try {
        window.webkit.messageHandlers.bridge.postMessage({ id: id, method: method, params: params || {} });
      } catch (err) {
        delete pending[id];
        rej(err);
      }
    });
  }

  // 原生侧回调入口
  window.__bridgeResolve = function (id, ok, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) p.res(payload);
    else p.rej(new Error(String(payload || 'native error')));
  };

  return {
    available: hasNative(),
    openFile: function () { return call('openFile'); },
    openFolder: function () { return call('openFolder'); },
    openFolderAt: function (path) { return call('openFolderAt', { path: path }); },
    readFile: function (path) { return call('readFile', { path: path }); },
    save: function (path, content) { return call('save', { path: path, content: content }); },
    saveAs: function (name, content) { return call('saveAs', { name: name, content: content }); },
    // dest：落盘目录（绝对，或相对文档目录）。空 = 文档同级的 assets/；
    // 文档未保存时落到临时目录，返回绝对路径
    saveImage: function (dataUrl, docPath, dest) {
      return call('saveImage', { data: dataUrl, docPath: docPath || '', dest: dest || '' });
    },
    // opts: { paper: 'a4'|'letter'|'a3'|'a5', margin: Number, headerFooter: Bool, h1page: Bool }
    exportPDF: function (opts) { return call('exportPDF', opts || {}); },
    // styles=false 导出「HTML without styles」：只要语义结构，样式由使用者自己的 CSS 决定
    // themeCss：自定义主题的 CSS 原文，原生侧排在 app.css 之后再内联
    exportHTML: function (name, html, styles, themeCss) {
      return call('exportHTML', {
        name: name, html: html, styles: styles !== false,
        themeCss: themeCss || ''
      });
    },
    exportImage: function (format) { return call('exportImage', { format: format || 'png' }); },
    readBinary: function (path) { return call('readBinary', { path: path }); },
    importFile: function () { return call('importFile'); },
    saveImport: function (name, content, assets) {
      return call('saveImport', { name: name, content: content, assets: assets || [] });
    },
    exportFile: function (name, ext, base64) { return call('exportFile', { name: name, ext: ext, base64: base64 }); },
    openUrl: function (url) { return call('openUrl', { url: url }); },
    setTitle: function (title) { return call('setTitle', { title: title }); },
    status: function (dirty, path) { return call('status', { dirty: !!dirty, path: path || '' }); },
    setFile: function (path) { return call('setFile', { path: path }); },
    reveal: function (path) { return call('reveal', { path: path }); },
    confirm: function (message, info) { return call('confirm', { message: message, info: info }); },
    translate: function (text, target, source) { return call('translate', { text: text, target: target, source: source || '' }); },
    translationStatus: function (target, source) { return call('translationStatus', { target: target, source: source || '' }); },
    prepareTranslation: function (target, source) { return call('prepareTranslation', { target: target, source: source || '' }); },
    openTranslationSettings: function () { return call('openTranslationSettings'); },
    copy: function (text) { return call('copy', { text: text }); },
    listThemes: function () { return call('listThemes'); },
    readTheme: function (id) { return call('readTheme', { id: id }); },
    openThemeFolder: function () { return call('openThemeFolder'); },
    readText: function (path) { return call('readText', { path: path }); },
    fsList: function (path) { return call('fsList', { path: path }); },
    fsNew: function (dir, name, isFolder) {
      return call('fsOp', { op: isFolder ? 'newFolder' : 'newFile', dir: dir, name: name });
    },
    fsRename: function (path, name) { return call('fsOp', { op: 'rename', path: path, name: name }); },
    fsDuplicate: function (path) { return call('fsOp', { op: 'duplicate', path: path }); },
    fsTrash: function (path) { return call('fsOp', { op: 'trash', path: path }); },
    // 撤销「移到废纸篓」：把 trash 路径下的文件搬回原路径
    fsRestore: function (trashPath, path) {
      return call('fsOp', { op: 'restore', trash: trashPath, path: path });
    },
    fsStat: function (path) { return call('fsOp', { op: 'stat', path: path }); },
    fsCopyTo: function (path, dir) { return call('fsOp', { op: 'copyTo', path: path, dir: dir }); },
    fsMoveTo: function (path, dir) { return call('fsOp', { op: 'moveTo', path: path, dir: dir }); },
    // 选图：返回 [{path,name}]，取消返回 null
    pickImages: function () { return call('pickImages'); },
    // 选目录：返回绝对路径，取消返回 null
    chooseFolder: function () { return call('chooseFolder'); },
    // 把外部图片复制进文档资产目录，返回绝对路径
    imgImport: function (src, docPath, dest) {
      return call('imgImport', { src: src, docPath: docPath || '', dest: dest || '' });
    },
    // 下载 http(s) 图片到 dest（为空则文档同级 assets/），返回 {path,name,size}
    imgFetch: function (url, docPath, dest, name) {
      return call('imgFetch', { url: url, docPath: docPath || '', dest: dest || '', name: name || '' });
    },
    // 自定义导出命令（pandoc 等）：原生写临时 .md → 弹保存面板 → /bin/sh -c 执行
    // params: { cmd, ext, name, dir, content }；返回 {path, log} 或 null（取消）
    runExport: function (o) {
      return call('runExport', {
        cmd: o.cmd, ext: o.ext || 'out', name: o.name || '',
        dir: o.dir || '', content: o.content || ''
      });
    },
    newWindow: function (path) { return call('newWindow', { path: path || '' }); },
    print: function () { return call('print'); },
    quit: function () { return call('quit'); },
    // 系统词典：批量判定拼错的词（resolve 成下标数组），以及取建议词
    spellCheck: function (words, ignore) {
      return call('spellCheck', { words: words || [], ignore: ignore || [] })
        .then(function (r) { return (r && r.bad) || []; });
    },
    spellGuesses: function (word) {
      return call('spellGuesses', { word: word || '' })
        .then(function (r) { return (r && r.guesses) || []; });
    },
    ready: function () { return call('ready'); }
  };
})();
