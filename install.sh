#!/bin/bash
# install.sh —— 从 GitHub Release 下载最新 OpenTypora，装进 /Applications 并解除隔离
#
# 用法：
#   ./install.sh                    装最新版
#   curl -fsSL https://raw.githubusercontent.com/SingleTime/opentypora/main/install.sh | bash
#
# 为什么需要这一步：应用只有 ad-hoc 签名，没有 Apple 开发者证书，Gatekeeper 会拦。
# 脚本做的是「下载 → 解压 → 覆盖 /Applications → 去掉 com.apple.quarantine → 启动」。
set -euo pipefail

REPO="SingleTime/opentypora"
APP_NAME="OpenTypora.app"
DEST="/Applications/$APP_NAME"

say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

# 路径必须落在 /Applications 下，防止后续删除操作跑偏
case "$DEST" in
  /Applications/*.app) ;;
  *) die "目标路径异常：$DEST" ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  die "这个脚本只用于 macOS。"
fi

if [ "$(uname -m)" != "arm64" ]; then
  say "注意：现有构建只支持 Apple Silicon（arm64），当前机器是 $(uname -m)，装上也跑不起来。"
  exit 1
fi

# 1. 定位最新 release 里的 zip 资产
say "查询最新版本…"
INFO="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" \
  || die "连不上 GitHub API。网络或代理问题，也可以直接去 https://github.com/$REPO/releases 手动下载。"
URL="$(printf '%s' "$INFO" \
  | sed -n 's/.*"browser_download_url": *"\([^"]*\.zip\)".*/\1/p' \
  | head -1)"
TAG="$(printf '%s' "$INFO" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$URL" ] || die "最新 release 里没找到 zip 资产，请到 https://github.com/$REPO/releases 手动下载。"
say "最新版本：${TAG:-未知}"

# 2. 下载到临时目录
TMP="$(mktemp -d "${TMPDIR:-/tmp}/opentypora.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

say "下载 $(basename "$URL")…"
curl -fL --progress-bar -o "$TMP/pkg.zip" "$URL" || die "下载失败。"

# 3. 解压
say "解压…"
unzip -q "$TMP/pkg.zip" -d "$TMP/x" || die "解压失败，压缩包可能不完整。"
SRC="$TMP/x/$APP_NAME"
[ -d "$SRC" ] || SRC="$(/usr/bin/find "$TMP/x" -maxdepth 2 -name "$APP_NAME" -type d | head -1)"
[ -n "${SRC:-}" ] && [ -d "$SRC" ] || die "压缩包里没找到 $APP_NAME。"

# 4. 退出正在运行的实例，否则覆盖时会冲突
osascript -e 'tell application "OpenTypora" to quit' >/dev/null 2>&1 || true
pkill -x OpenTypora >/dev/null 2>&1 || true

# 5. 安装（/Applications 对 admin 组成员可写，一般不需要 sudo）
if [ -e "$DEST" ]; then
  say "覆盖已有安装…"
  if ! mv "$DEST" "$TMP/old.app" 2>/dev/null; then
    say "没有写入权限，需要 sudo。"
    sudo mv "$DEST" "$TMP/old.app"
    sudo ditto "$SRC" "$DEST"
  else
    ditto "$SRC" "$DEST"
  fi
  rm -rf "$TMP/old.app"
else
  ditto "$SRC" "$DEST" 2>/dev/null || { say "没有写入权限，需要 sudo。"; sudo ditto "$SRC" "$DEST"; }
fi

# 6. 解除隔离，让 Gatekeeper 不再拦
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null \
  || sudo xattr -dr com.apple.quarantine "$DEST" 2>/dev/null \
  || say "解除隔离失败，首次打开时可能需要手动放行。"

# 7. 自检：签名是否还在，Gatekeeper 是否仍拒绝（仅提示，不阻断）
IDENT="$(codesign -dv "$DEST" 2>&1 | sed -n 's/^Identifier=//p' | head -1)"
say ""
say "已安装：$DEST"
say "  bundle id：${IDENT:-未知}"
say "  Gatekeeper 评估：$(spctl -a "$DEST" 2>&1 >/dev/null | head -1 || true)"
say "  上面显示 rejected 是正常的 —— ad-hoc 签名过不了公证，但隔离属性已清掉，能直接打开。"
say ""
say "启动：open -a OpenTypora"
say "卸载：rm -rf \"$DEST\" \"\$HOME/Library/Application Support/OpenTypora\""

open "$DEST" 2>/dev/null || true
