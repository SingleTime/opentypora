var DOC = JSON.parse(document.getElementById('__doc').textContent);
setTimeout(function () {
  Editor.load(DOC, '/tmp/math-demo.md', 'math-demo.md');
  setTimeout(function () {
    var out = [];
    out.push('直接parse=' + MD.parse('$$x^2$$').blocks.map(function(b){return b.type;}).join(','));
    var mm = MD.parse(DOC);
    out.push('整篇块类型=' + mm.blocks.map(function (b) { return b.type; }).join(','));
    var mh = MD.renderDocument(DOC);
    out.push('renderDocument含mathblock=' + (mh.indexOf('mathblock') >= 0));
    var ai = mh.indexOf('pmatrix');
    out.push('片段=' + mh.slice(Math.max(0, ai - 120), ai + 30).replace(/\s+/g, ' '));
    out.push('katex=' + (window.katex ? window.katex.version : 'none'));
    out.push('nodes=' + document.querySelectorAll('.katex').length);
    out.push('displayNodes=' + document.querySelectorAll('.katex-display').length);
    out.push('mathblock=' + document.querySelectorAll('.mathblock').length);
    out.push('inline=' + document.querySelectorAll('.math-inline').length);

    var mb = document.querySelector('.mathblock');
    if (mb) {
      var cs = getComputedStyle(mb);
      out.push('mb.cls=' + mb.className);
      out.push('mb.textAlign=' + cs.textAlign);
      out.push('mb.html=' + mb.innerHTML.replace(/\s+/g, ' ').slice(0, 180));
      var r = mb.getBoundingClientRect();
      out.push('mb.rect=' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      // 找公式底下那条线的来源
      var probeY = r.bottom - 4;
      var els = document.elementsFromPoint(r.left + 30, probeY) || [];
      out.push('底部元素=' + els.slice(0, 3).map(function (e) {
        return e.tagName + '.' + (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '');
      }).join(' > '));
      var firstK = mb.querySelector('.katex');
      if (firstK) {
        var kcs = getComputedStyle(firstK);
        out.push('katex.font=' + kcs.fontFamily.slice(0, 24) + ' size=' + kcs.fontSize + ' display=' + kcs.display);
        out.push('katex.parent=' + firstK.parentNode.className);
      }
      out.push('mb.borderBottom=' + cs.borderBottomWidth + ' ' + cs.borderBottomColor);
    }
    window.__report = 'MATH ' + out.join(' | ');
  }, 900);
}, 700);
