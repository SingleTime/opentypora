// cli.test.js —— 命令行入口（bin/opentypora）的可用性检查
// 只测不会真的启动应用的路径：--help / --version / 未知选项 / 语法检查
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'opentypora');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function run(args, input) {
  return spawnSync('bash', [CLI].concat(args), {
    cwd: ROOT, encoding: 'utf8', input: input || undefined, timeout: 10000
  });
}

console.log('脚本自身');
{
  const s = spawnSync('bash', ['-n', CLI], { encoding: 'utf8' });
  ok('bash 语法检查通过', s.status === 0, s.stderr);
  const fs = require('fs');
  const st = fs.statSync(CLI);
  ok('可执行位已设置', !!(st.mode & 0o111), st.mode.toString(8));
}

console.log('--help');
{
  const r = run(['--help']);
  ok('退出码 0', r.status === 0, String(r.status));
  ok('打印用法', /用法/.test(r.stdout));
  ok('列出 -v 与 -h', /--version/.test(r.stdout) && /--help/.test(r.stdout));
  ok('不把脚本正文漏出来', !/set -euo pipefail/.test(r.stdout), r.stdout.split('\n').slice(-3).join('|'));
  ok('-h 等价', run(['-h']).stdout === r.stdout);
}

console.log('--version');
{
  const r = run(['--version']);
  ok('退出码 0', r.status === 0, String(r.status) + ' ' + r.stderr);
  ok('输出形如 1.0', /^\d+(\.\d+)*\s*$/.test(r.stdout), JSON.stringify(r.stdout));
  ok('-v 等价', run(['-v']).stdout === r.stdout);
}

console.log('错误处理');
{
  const r = run(['--bogus']);
  ok('未知选项退出码 2', r.status === 2, String(r.status));
  ok('提示见 --help', /--help/.test(r.stderr), r.stderr.trim());
  const r2 = run(['/tmp/__definitely_not_here___.md']);
  ok('文件不存在时退出 1', r2.status === 1, String(r2.status));
  ok('给出不存在提示', /不存在/.test(r2.stderr), r2.stderr.trim());
}

console.log('安装脚本');
{
  const s = spawnSync('bash', ['-n', path.join(ROOT, 'install-cli.sh')], { encoding: 'utf8' });
  ok('install-cli.sh 语法通过', s.status === 0, s.stderr);
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
