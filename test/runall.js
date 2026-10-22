#!/usr/bin/env node
// runall.js —— 全量回归：纯 Node 套件直接跑，harness 套件跑完再交给 build/shot 出报告
// 用法: node test/runall.js [套件名...]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOT = path.join(ROOT, 'build', 'shot');

// [套件, shot 等待秒数(0=纯 Node)]
const SUITES = [
  ['parser', 0], ['syntax2', 0], ['workbench', 0], ['imgman', 0], ['export', 0], ['exportopts', 0],
  ['import', 0], ['cli', 0], ['odt', 0], ['textfmt', 0], ['infmt', 0], ['epub', 0], ['reveal', 0],
  ['strict', 0], ['strictparse', 0], ['flow', 0], ['fsundo', 0], ['yaml', 0], ['exportyaml', 0],
  ['xcmd', 0], ['code', 0], ['highlight', 0], ['srcmode', 0], ['caret', 0], ['spell', 0], ['typography', 0], ['tabs', 0], ['live', 0], ['dropfile', 0], ['pdfbook', 0], ['htmltheme', 0],
  ['table', 12], ['doc', 12], ['selbar', 12], ['split', 12], ['math', 14], ['exportui', 22],
  ['find', 14], ['prefs', 14], ['imgedit', 16], ['translate', 18],   ['mermaid', 34], ['flowdom', 12], ['fsundodom', 16], ['xcmddom', 16],
  ['codemod', 16], ['recentdom', 14], ['dropdom', 14], ['srcmodedom', 22], ['htmlthemedom', 10],
  ['caredom', 16], ['spelldom', 22], ['typodom', 22], ['tabsdom', 30], ['livedom', 20],
  ['html', 14], ['importweb', 16], ['note', 14],
  ['edit2', 20]
];

const only = process.argv.slice(2);
const list = only.length ? SUITES.filter(function (s) { return only.indexOf(s[0]) >= 0; }) : SUITES;

let totalPass = 0, totalCatch = 0, bad = [];

list.forEach(function (entry) {
  const name = entry[0], wait = entry[1];
  const file = path.join(ROOT, 'test', name + '.test.js');
  if (!fs.existsSync(file)) { bad.push(name + ': 文件不存在'); return; }

  const r = spawnSync('node', [file], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');

  if (wait === 0) {
    const m = out.match(/✅ (\d+) passed, (\d+) failed/);
    if (m) {
      totalPass += +m[1]; totalCatch += +m[1] + +m[2];
      if (+m[2]) bad.push(name + ': ' + m[2] + ' 失败');
      console.log(pad(name) + m[1] + ' passed, ' + m[2] + ' failed');
    } else {
      bad.push(name + ': 没找到结果行');
      console.log(pad(name) + '?? ' + out.trim().split('\n').slice(-2).join(' | '));
    }
    return;
  }

  // harness 型：从输出里拿 html 路径（有的套件打印相对路径，如 "wrote app/__mmd_harness.html"）
  const hm = out.match(/([^\s:：>]+\.html)/);
  if (!hm) { bad.push(name + ': 没生成 harness'); console.log(pad(name) + '?? 没生成 harness'); return; }
  let harness = hm[1];
  if (!path.isAbsolute(harness) || !fs.existsSync(harness)) {
    const rel = path.join(ROOT, harness.replace(/^\.?\/*/, ''));
    if (fs.existsSync(rel)) harness = rel;
  }
  if (!fs.existsSync(harness)) {
    bad.push(name + ': harness 路径不存在 ' + harness);
    console.log(pad(name) + '?? harness 路径不存在 ' + harness);
    return;
  }
  if (!fs.existsSync(SHOT)) { bad.push('build/shot 不存在，先 swiftc 编译'); return; }

  const s = spawnSync(SHOT, [harness, '/tmp/__runall.png', '1280', '900', '', String(wait)],
    { cwd: ROOT, encoding: 'utf8', timeout: (wait + 40) * 1000 });
  const sout = (s.stdout || '') + (s.stderr || '');
  const rm = sout.match(/(\d+)\/(\d+)([^\n]*)/);
  if (rm) {
    totalPass += +rm[1]; totalCatch += +rm[2];
    const miss = +rm[2] - +rm[1];
    if (miss || /FAIL|失败/.test(rm[3] || '')) bad.push(name + ': ' + rm[0].trim());
    console.log(pad(name) + rm[1] + '/' + rm[2] + (rm[3] ? '  ' + rm[3].trim() : ''));
  } else {
    bad.push(name + ': shot 无报告');
    console.log(pad(name) + '?? shot 无报告 ' + sout.trim().split('\n').slice(-2).join(' | '));
  }
});

function pad(s) { return (s + '                 ').slice(0, 14); }

console.log('\n合计 ' + totalPass + '/' + totalCatch +
  (bad.length ? '\n⚠️  ' + bad.join('\n    ') : '  ✅ 全绿'));
process.exit(bad.length ? 1 : 0);
