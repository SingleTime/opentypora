#!/bin/bash
# 构建 OpenTypora.app：编译原生壳 → 生成图标 → 组装 bundle → ad-hoc 签名
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/OpenTypora.app"
NAME="OpenTypora"

# 部署目标。必须显式指定：不写 -target 时 swiftc 用构建机的 SDK 版本，
# 于是「在 macOS 27 上构建」= 产物 minos 27.0，在 26 及以下系统直接打不开，
# 报「这个版本不能与此版本的 macOS 配合使用」。
#
# 13.0 是代码的真实下限：
#   - Translation 框架（15.0 起）→ translate.swift 整个类型已 @available(macOS 15.0, *)，
#     且框架用 -weak_framework 弱链接，13/14 上不加载、翻译功能自动缺席
#   - session.canRequestDownloads / TranslationError.notInstalled（26.0 起）→ 已加 #available 回退
#   - Task.sleep(nanoseconds:) 需要 13.0
# 再往下（12）Swift 并发运行时和前端 WKWebView 特性都撑不住，不再降。
MACOS_MIN="${MACOS_MIN:-13.0}"
ARCH="${ARCH:-arm64}"
TARGET="${ARCH}-apple-macos${MACOS_MIN}"

echo "==> 清理"
# 不用 rm -rf：先把旧产物挪到临时目录（出问题还能捞回来），再重建
if [ -d "$BUILD" ]; then
  mv "$BUILD" "${TMPDIR:-/tmp}/opentypora-build-old-$$"
fi
mkdir -p "$BUILD"

echo "==> 生成图标"
swiftc -O -target "$TARGET" -o "$BUILD/makeicon" "$ROOT/native/makeicon.swift" -framework Cocoa
"$BUILD/makeicon" "$BUILD/AppIcon.iconset" >/dev/null
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$BUILD/AppIcon.icns"

echo "==> 编译主程序（target: ${TARGET}）"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -target "$TARGET" -o "$APP/Contents/MacOS/$NAME" \
  "$ROOT/native/main.swift" \
  "$ROOT/native/translate.swift" \
  "$ROOT/native/pdfbook.swift" \
  "$ROOT/native/webexport.swift" \
  "$ROOT/native/spell.swift" \
  -framework Cocoa -framework WebKit -framework SwiftUI -framework PDFKit \
  -Xlinker -weak_framework -Xlinker Translation

echo "==> 组装 Bundle"
cp "$ROOT/native/Info.plist" "$APP/Contents/Info.plist"
cp "$BUILD/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
mkdir -p "$APP/Contents/Resources/app"
# 测试/演示生成的 __*.html 不进包（app/ 下仍然留着，方便本地跑 harness）
rsync -a --exclude '__*.html' "$ROOT/app/" "$APP/Contents/Resources/app/"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> 代码签名（ad-hoc）"
codesign --force --deep --sign - "$APP" 2>&1 | sed 's/^/    /'

echo "==> 测试工具 build/shot（harness 套件要用）"
swiftc -O -target "$TARGET" -o "$BUILD/shot" "$ROOT/test/shot.swift" -framework Cocoa -framework WebKit 2>/dev/null

echo "==> 校验"
codesign -dv "$APP" 2>&1 | sed 's/^/    /'
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist" | sed 's/^/    bundle id: /'

# 二进制 minos 与 Info.plist 声明必须一致，否则就是「声称支持 12、实际只能跑 27」
# 那种漂移 —— 用户在更低版本系统上会看到一个和真实原因无关的兼容性弹窗。
MINOS=$(otool -l "$APP/Contents/MacOS/$NAME" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')
PLIST_MIN=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$APP/Contents/Info.plist")
echo "    minos: $MINOS  plist LSMinimumSystemVersion: $PLIST_MIN"
if [ "$MINOS" != "$MACOS_MIN" ]; then
  echo "    ✗ 二进制 minos=${MINOS}，期望 ${MACOS_MIN}（-target 没生效？）" >&2
  exit 1
fi
if [ "$PLIST_MIN" != "$MACOS_MIN" ]; then
  echo "    ✗ Info.plist 声明 ${PLIST_MIN}，与二进制 ${MINOS} 不一致；改 native/Info.plist" >&2
  exit 1
fi

du -sh "$APP" | sed 's/^/    size: /'

echo "==> 完成：$APP"
