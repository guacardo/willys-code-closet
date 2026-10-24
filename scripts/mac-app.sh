#!/bin/sh
# Builds release/Willy's Code Closet.app: a renamed copy of the repo-local Electron.app whose
# Contents/Resources/app symlinks to this checkout, so it always loads the current out/.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/node_modules/electron/dist/Electron.app"
APP="$REPO/release/Willy's Code Closet.app"
ICONSET="$REPO/release/icon.iconset"
VERSION="$(node -p "require('$REPO/package.json').version")"

mkdir -p "$REPO/release"
rsync -a --delete --exclude 'Contents/Resources/app' "$SRC/" "$APP/"
rm -f "$APP/Contents/Resources/default_app.asar"
ln -sfn "$REPO" "$APP/Contents/Resources/app"

P="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "Willy's Code Closet" "$P"
plutil -replace CFBundleDisplayName -string "Willy's Code Closet" "$P"
plutil -replace CFBundleIdentifier -string "com.anvilsoftwarelabs.willys-code-closet" "$P"
plutil -replace CFBundleVersion -string "$VERSION" "$P"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$P"
plutil -replace CFBundleIconFile -string "icon.icns" "$P"
mv -f "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Willy's Code Closet"
plutil -replace CFBundleExecutable -string "Willy's Code Closet" "$P"

rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$REPO/resources/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$REPO/resources/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
rm -rf "$ICONSET" "$APP/Contents/Resources/electron.icns"

codesign --force --deep --sign - "$APP" 2>/dev/null
touch "$APP"
echo "$APP"
