#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="$PWD/build/Notch Chat Probe.app"
mkdir -p "$app/Contents/MacOS"
bash Tools/ChatDaemon/build.sh
mkdir -p "$app/Contents/Resources"
ditto "$PWD/build/Notch Chat Daemon.app" "$app/Contents/Resources/Notch Chat Daemon.app"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.notch.chatprobe</string>
<key>CFBundleName</key><string>Notch Chat Probe</string>
<key>CFBundleExecutable</key><string>ChatProbe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macosx14.0" \
  Shared/Chat/ChatProtocol.swift Shared/Chat/ChatDaemonClient.swift Shared/Chat/NativeChatView.swift \
  Shared/Chat/ChatPanelController.swift Tools/ChatProbe/main.swift \
  -o "$app/Contents/MacOS/ChatProbe"
codesign --force --sign - "$app"
echo "$app"
