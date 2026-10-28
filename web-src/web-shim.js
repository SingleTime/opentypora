/* web-shim.js — 浏览器环境下的 Bridge 适配层
 *
 * 桌面版 bridge.js 通过 WKWebView messageHandlers 与 Swift 壳通信；
 * 在浏览器里没有原生壳，这里把同一组 API 重新实现一遍：
 *   - 文件读写 → File System Access API（Chrome/Edge），不支持时退化为下载
 *   - 导出 → Blob 下载
 *   - 剪贴板 / 打印 / 标题 → Web 标准 API
 *   - 依赖本机能力的（文件夹工作区、本地翻译、系统词典、外部命令）→ 明确降级，
 *     返回「网页版不支持」的 reject，调用方 toast 出来即可，不会打断编辑
 *
 * 加载顺序：必须排在 js/bridge.js 之后。
 */
(function () {
  'use strict';

  var B = window.Bridge;
  if (!B) return;

  B.available = true;
  // ui.js 等模块靠这个标记切换网页版文案（桌面版没有这个字段）
  B.web = true;

  /* -------------------------------------------------- 通用工具 */

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'untitled';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
    return { path: name };
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime || 'application/octet-stream' });
  }

  function pickFile(accept, multiple) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.style.position = 'fixed';
      inp.style.left = '-9999px';
      document.body.appendChild(inp);
      var done = false;
      inp.addEventListener('change', function () {
        done = true;
        resolve(multiple ? Array.prototype.slice.call(inp.files || []) : (inp.files && inp.files[0]) || null);
        setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 0);
      });
      // 取消选择不会触发 change，靠 focus 回来自清理
      window.addEventListener('focus', function onFocus() {
        setTimeout(function () {
          if (!done) resolve(multiple ? [] : null);
          window.removeEventListener('focus', onFocus);
          if (inp.parentNode) inp.parentNode.removeChild(inp);
        }, 400);
      }, { once: true });
      inp.click();
    });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsDataURL(file);
    });
  }

  function noWeb(what) {
    return Promise.reject(new Error('网页版不支持' + (what ? '「' + what + '」' : '该操作') + '，请使用桌面版'));
  }

  /* File System Access API：同一次会话里记住句柄，⌘S 直接回写 */
  var handles = Object.create(null);

  function canPick() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function writeHandle(handle, text) {
    return handle.createWritable().then(function (w) {
      return w.write(new Blob([text], { type: 'text/markdown;charset=utf-8' })).then(function () {
        return w.close();
      });
    });
  }

  /* -------------------------------------------------- 文件 */

  B.openFile = function () {
    return pickFile('.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain').then(function (file) {
      if (!file) return null;
      return readText(file).then(function (content) {
        return { content: content, path: '', name: file.name };
      });
    });
  };

  B.save = function (path, content) {
    var h = path && handles[path];
    if (h) {
      return writeHandle(h, content).then(function () { return { path: path }; });
    }
    return B.saveAs(path ? String(path).replace(/^.*\//, '') : 'untitled.md', content);
  };

  B.saveAs = function (name, content) {
    name = name || 'untitled.md';
    if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';

    if (!canPick()) {
      return Promise.resolve(download(name, new Blob([content], { type: 'text/markdown;charset=utf-8' })));
    }
    return window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }]
    }).then(function (handle) {
      return writeHandle(handle, content).then(function () {
        var key = 'web/' + handle.name;
        handles[key] = handle;
        return { path: key };
      });
    }).catch(function (err) {
      // AbortError = 用户在保存面板里点了取消，安静收场
      if (err && err.name === 'AbortError') return null;
      // 其余情况（权限策略、非安全上下文、API 被禁）退化成下载，别让保存直接失败
      return download(name, new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    });
  };

  B.exportFile = function (name, ext, base64) {
    var mime = 'application/octet-stream';
    var e = String(ext || '').toLowerCase();
    if (e === 'pdf') mime = 'application/pdf';
    else if (e === 'html' || e === 'htm') mime = 'text/html;charset=utf-8';
    else if (e === 'docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (e === 'epub') mime = 'application/epub+zip';
    else if (e === 'odt') mime = 'application/vnd.oasis.opendocument.text';
    else if (e === 'png') mime = 'image/png';
    else if (e === 'svg') mime = 'image/svg+xml';
    return Promise.resolve(download(name, b64ToBlob(base64, mime)));
  };

  B.exportHTML = function (name, html, styles, themeCss) {
    var doc = String(html || '');
    if (themeCss) {
      doc = doc.replace('</head>', '<style>' + themeCss + '</style></head>');
    }
    var fname = name || 'export';
    if (!/\.html?$/i.test(fname)) fname += '.html';
    return Promise.resolve(download(fname, new Blob([doc], { type: 'text/html;charset=utf-8' })));
  };

  /* 页面截图导出：原生用 WebKit 抓图，网页里退一步走打印/系统截图 */
  B.exportImage = function () {
    return noWeb('图片导出');
  };

  /* PDF：原生用 printOperation 直出文件，网页里交给浏览器的「打印 → 存储为 PDF」
   * 纸张/页边距这些选项由 ui.js 写进 .printing 样式，浏览器打印面板里选「无边距」即可 */
  B.exportPDF = function () {
    return new Promise(function (resolve) {
      setTimeout(function () {
        window.print();
        setTimeout(function () { resolve({ path: '（浏览器打印面板 · 存储为 PDF）' }); }, 1200);
      }, 120);
    });
  };

  B.print = function () {
    setTimeout(function () { window.print(); }, 60);
    return Promise.resolve();
  };

  /* -------------------------------------------------- 系统交互 */

  B.confirm = function (message, info) {
    var text = message || '';
    if (info) text += '\n\n' + info;
    return Promise.resolve(window.confirm(text));
  };

  B.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(String(text || '')).catch(function () {
        return Promise.reject(new Error('剪贴板不可用'));
      });
    }
    return Promise.reject(new Error('剪贴板不可用'));
  };

  B.openUrl = function (url) {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve();
  };

  B.setTitle = function (title) {
    // 桌面版改的是窗口标题；网页里用「文档名 — OpenTypora」撑住浏览器标签
    var t = String(title || '').trim();
    document.title = t ? t + ' — OpenTypora' : 'OpenTypora · 网页版';
    return Promise.resolve();
  };

  B.status = function () { return Promise.resolve(); };
  B.setFile = function () { return Promise.resolve(); };
  B.ready = function () { return Promise.resolve(); };

  /* -------------------------------------------------- 图片 */

  /* 粘贴/插入的图片：桌面版落盘到 assets/，网页版直接内嵌 dataURL */
  B.saveImage = function (dataUrl, docPath, dest) {
    return Promise.resolve({ path: dataUrl, name: 'image.png' });
  };

  B.imgImport = function (src) {
    return Promise.resolve({ path: src });
  };

  /* 远程图：浏览器能直接显示，无需下载到本地 */
  B.imgFetch = function (url, docPath, dest, name) {
    return Promise.resolve({ path: url, name: name || 'image', size: 0 });
  };

  B.pickImages = function () {
    return pickFile('image/*', true).then(function (files) {
      if (!files || !files.length) return null;
      return Promise.all(files.map(function (f) {
        return readDataUrl(f).then(function (url) { return { path: url, name: f.name }; });
      }));
    });
  };

  /* -------------------------------------------------- 主题 / 词典 / 翻译 */

  B.listThemes = function () {
    return Promise.resolve({ themes: [], dir: '（网页版不支持自定义主题目录）' });
  };
  B.readTheme = function () { return Promise.resolve({ css: '' }); };

  /* 系统词典不可用：报告「没有拼错」，让拼写波浪线安静地不出现 */
  B.spellCheck = function () { return Promise.resolve([]); };
  B.spellGuesses = function () { return Promise.resolve([]); };

  B.translate = function () { return noWeb('本地翻译'); };
  B.translationStatus = function () { return noWeb('本地翻译'); };
  B.prepareTranslation = function () { return noWeb('本地翻译'); };
  B.openTranslationSettings = function () { return noWeb('本地翻译'); };

  /* -------------------------------------------------- 桌面专属：明确降级 */

  B.openFolder = function () { return noWeb('打开文件夹工作区'); };
  B.openFolderAt = function () { return noWeb('打开文件夹工作区'); };
  B.readFile = function () { return noWeb('直接读路径'); };
  B.readText = function () { return noWeb('直接读路径'); };
  B.readBinary = function () { return noWeb('直接读路径'); };
  B.reveal = function () { return noWeb('在访达中显示'); };
  B.openThemeFolder = function () { return noWeb('打开主题目录'); };
  B.runExport = function () { return noWeb('自定义导出命令'); };
  B.newWindow = function () { return noWeb('多窗口'); };
  B.quit = function () { return noWeb('退出'); };
  B.importFile = function () { return noWeb('导入文件'); };
  B.saveImport = function () { return noWeb('导入落盘'); };

  B.fsList = function () { return noWeb('文件操作'); };
  B.fsNew = function () { return noWeb('文件操作'); };
  B.fsRename = function () { return noWeb('文件操作'); };
  B.fsDuplicate = function () { return noWeb('文件操作'); };
  B.fsTrash = function () { return noWeb('文件操作'); };
  B.fsRestore = function () { return noWeb('文件操作'); };
  B.fsStat = function () { return noWeb('文件操作'); };
  B.fsCopyTo = function () { return noWeb('文件操作'); };
  B.fsMoveTo = function () { return noWeb('文件操作'); };
  B.chooseFolder = function () { return noWeb('选择目录'); };
})();
