#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CONFIGURATION=Release
export ARCH=arm64
bash Tools/build-chat-fork.sh

source_app="$PWD/build/DerivedData/Build/Products/Release/Boring Notch.app"
staging="$PWD/build/package-stage"
output="$PWD/build/packages"
mkdir -p "$staging" "$output"
app="$staging/Boring Notch Chat.app"
if [ -e "$app" ]; then
  echo "Package staging already exists: $app. Remove it before packaging again." >&2
  exit 1
fi
ditto "$source_app" "$app"
codesign --verify --deep --strict "$app"
test -x "$app/Contents/Resources/Notch Chat Daemon.app/Contents/MacOS/ChatDaemon"
lipo "$app/Contents/MacOS/Boring Notch" -verify_arch arm64
lipo "$app/Contents/Resources/Notch Chat Daemon.app/Contents/MacOS/ChatDaemon" -verify_arch arm64

cp LICENSE "$staging/LICENSE.txt"
cat > "$staging/INSTALL.txt" <<'TXT'
Boring Notch Chat — Apple Silicon (arm64), macOS 14+

Quit any running Boring Notch before opening this fork.
Drag Boring Notch Chat.app to Applications, then open it.
For updates that change the chat helper, also quit Notch Chat Daemon first.
Connect Messenger/Zalo from the Chat tab and log in directly in its window.

This personal build is ad-hoc signed, without Apple notarization.
If macOS blocks this trusted download, use System Settings > Privacy & Security
to allow it. Upstream Sparkle auto-updates are disabled in this fork.
TXT
ln -s /Applications "$staging/Applications"
ditto -c -k --sequesterRsrc --keepParent "$app" "$output/Boring-Notch-Chat-arm64.zip"
hdiutil create -volname 'Boring Notch Chat' -srcfolder "$staging" \
  -ov -format UDZO "$output/Boring-Notch-Chat-arm64.dmg"
(
  cd "$output"
  shasum -a 256 Boring-Notch-Chat-arm64.zip Boring-Notch-Chat-arm64.dmg > SHA256SUMS.txt
)
echo "Packages: $output"
