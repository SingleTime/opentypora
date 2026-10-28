#!/bin/bash
# 构建网页版：web/ = app/（去掉 harness 页）+ 注入 web-src/web-shim.js
# web/ 是生成物，不进仓库；改前端请改 app/，改浏览器适配请改 web-src/。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB="$ROOT/web"
SRC="$ROOT/app"
SHIM="$ROOT/web-src/web-shim.js"

if [ ! -f "$SHIM" ]; then
  echo "缺少 $SHIM" >&2
  exit 1
fi

echo "==> 清理旧产物"
# 同 build.sh：不直接删，先挪到临时目录
if [ -d "$WEB" ]; then
  mv "$WEB" "${TMPDIR:-/tmp}/opentypora-web-old-$$"
fi
mkdir -p "$WEB"

echo "==> 复制 app/（排除 __*.html 测试页）"
rsync -a --exclude '__*.html' "$SRC/" "$WEB/"

echo "==> 注入 web-shim.js"
cp "$SHIM" "$WEB/js/web-shim.js"
python3 - "$WEB/index.html" <<'PY'
import sys

path = sys.argv[1]
html = open(path, encoding='utf-8').read()
if 'js/web-shim.js' in html:
    sys.exit(0)

anchor = '  <script src="js/bridge.js"></script>\n'
if anchor not in html:
    raise SystemExit('index.html 里找不到 bridge.js 的 <script> 标签，注入位置失效')

tag = '  <script src="js/web-shim.js"></script>\n'
open(path, 'w', encoding='utf-8').write(html.replace(anchor, anchor + tag, 1))
PY

echo "==> 校验"
grep -q 'js/web-shim.js' "$WEB/index.html" || { echo "注入失败：index.html 未包含 shim" >&2; exit 1; }
[ -f "$WEB/js/web-shim.js" ] || { echo "注入失败：缺少 js/web-shim.js" >&2; exit 1; }
# shim 必须在 bridge.js 之后、ui.js 之前
python3 - "$WEB/index.html" <<'PY'
import sys
html = open(sys.argv[1], encoding='utf-8').read()
i_bridge = html.find('js/bridge.js')
i_shim = html.find('js/web-shim.js')
i_ui = html.find('js/ui.js')
if not (i_bridge < i_shim < i_ui):
    raise SystemExit('脚本顺序不对：需要 bridge.js → web-shim.js → ui.js')
PY
du -sh "$WEB" | sed 's/^/    size: /'

echo "==> 完成：$WEB"
echo "    本地预览：cd \"$WEB\" && python3 -m http.server 8000"
