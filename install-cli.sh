#!/bin/bash
# install-cli.sh —— 把 bin/opentypora 装到 PATH 里（默认 /usr/local/bin，需要 sudo）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-/usr/local/bin}"

mkdir -p "$DEST"
install -m 755 "$ROOT/bin/opentypora" "$DEST/opentypora"

# 装完立刻自检一次，别等用户以后才发现路径不对
echo "已安装：$DEST/opentypora"
"$DEST/opentypora" --version | sed 's/^/    opentypora --version → /'
