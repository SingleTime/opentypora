/* ============================================================
 * zip.js — 最小 ZIP 写入器（无第三方依赖，可 Node 单测）
 * docx / epub 都是 zip 包，Mac 上又不想为了写个 zip 去接
 * libz 或者引入 jszip（3.4 MB 的 mermaid 已经够重了）。
 *
 * 只做 store（不压缩）：Office / iBooks 都认。代价是体积大
 * 约 20~30%（纯 XML 文本，压缩后本来也不大），换来的是零依赖、
 * 零异步、零内存翻倍。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------- CRC32 */
  var TABLE = (function () {
    var t = new Uint32Array(256), n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------------------------------------------------- UTF-8 */
  var TE = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;

  function utf8(str) {
    str = String(str == null ? '' : str);
    if (TE) return TE.encode(str);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'utf8'));
    var out = [], i, cp, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        cp = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function concat(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  /* ---------------------------------------------------------- 打包 */
  // entries: [{name, data: String|Uint8Array, store?}]
  // 第一项要「无额外字段 + 不压缩」是 epub 的硬要求，store 模式天然满足。
  function build(entries, opt) {
    opt = opt || {};
    var d = opt.date || new Date();
    var time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    var date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);

    var chunks = [], central = [], offset = 0, i;

    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      var nameBytes = utf8(String(e.name).replace(/^\/+/, ''));
      var data = typeof e.data === 'string' ? utf8(e.data) : new Uint8Array(e.data);
      var crc = crc32(data);
      var size = data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);      // 本地文件头签名
      dv.setUint16(4, 20, true);              // 需要的版本
      dv.setUint16(6, 0x0800, true);          // bit11 = 文件名 UTF-8
      dv.setUint16(8, 0, true);               // 0 = store
      dv.setUint16(10, time, true);
      dv.setUint16(12, date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);              // 无 extra field（epub mimetype 要求）
      lh.set(nameBytes, 30);

      chunks.push(lh, data);
      central.push({ nameBytes: nameBytes, crc: crc, size: size, offset: offset });
      offset += lh.length + size;
    }

    var cdStart = offset, cdParts = [];
    for (i = 0; i < central.length; i++) {
      var c = central[i];
      var ch = new Uint8Array(46 + c.nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);      // 中央目录签名
      cv.setUint16(4, 20, true);              // made by
      cv.setUint16(6, 20, true);              // needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, c.crc, true);
      cv.setUint32(20, c.size, true);
      cv.setUint32(24, c.size, true);
      cv.setUint16(28, c.nameBytes.length, true);
      cv.setUint16(30, 0, true);              // extra
      cv.setUint16(32, 0, true);              // comment
      cv.setUint16(34, 0, true);              // disk
      cv.setUint16(36, 0, true);              // 内部属性
      cv.setUint32(38, 0, true);              // 外部属性
      cv.setUint32(42, c.offset, true);
      ch.set(c.nameBytes, 46);
      cdParts.push(ch);
    }
    var cd = concat(cdParts);

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cd.length, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);

    return concat(chunks.concat([cd, eocd]));
  }

  /* ---------------------------------------------------------- 读回（单测 / 自检用） */
  function read(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 从尾部找 EOCD（容忍注释）
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是合法的 zip：找不到 EOCD');
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);

    var out = [], p = cdOff, dec = new TextDecoder('utf-8');
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('中央目录损坏');
      var method = dv.getUint16(p + 10, true);
      var crc = dv.getUint32(p + 16, true);
      var csize = dv.getUint32(p + 20, true);
      var usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;

      if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('本地头损坏：' + name);
      var lnlen = dv.getUint16(lho + 26, true);
      var lelen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lnlen + lelen;
      var data = bytes.subarray(start, start + csize);
      out.push({
        name: name, method: method, crc: crc, usize: usize,
        data: data, bytes: data,
        text: method === 0 ? dec.decode(data) : null
      });
    }
    return out;
  }

  return { build: build, read: read, crc32: crc32, utf8: utf8, concat: concat };
});
