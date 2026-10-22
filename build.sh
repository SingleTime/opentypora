#!/bin/bash
# 构建 OpenTypora.app：编译原生壳 → 生成图标 → 组装 bundle → ad-hoc 签名
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/OpenTypora.app"
NAME="OpenTypora"

echo "==> 清理"
# 不用 rm -rf：先把旧产物挪到临时目录（出问题还能捞回来），再重建
if [ -d "$BUILD" ]; then
  mv "$BUILD" "${TMPDIR:-/tmp}/opentypora-build-old-$$"
fi
mkdir -p "$BUILD"

echo "==> 生成图标"
swiftc -O -o "$BUILD/makeicon" "$ROOT/native/makeicon.swift" -framework Cocoa
"$BUILD/makeicon" "$BUILD/AppIcon.iconset" >/dev/null
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$BUILD/AppIcon.icns"

echo "==> 编译主程序"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/$NAME" \
  "$ROOT/native/main.swift" \
  "$ROOT/native/translate.swift" \
  "$ROOT/native/pdfbook.swift" \
  "$ROOT/native/webexport.swift" \
  "$ROOT/native/spell.swift" \
  -framework Cocoa -framework WebKit -framework SwiftUI -framework Translation -framework PDFKit

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
swiftc -O -o "$BUILD/shot" "$ROOT/test/shot.swift" -framework Cocoa -framework WebKit 2>/dev/null

echo "==> 校验"
codesign -dv "$APP" 2>&1 | sed 's/^/    /'
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist" | sed 's/^/    bundle id: /'
du -sh "$APP" | sed 's/^/    size: /'

echo "==> 完成：$APP"
