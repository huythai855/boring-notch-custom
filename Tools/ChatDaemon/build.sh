#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="$PWD/build/Notch Chat Daemon.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.notch.chatdaemon</string>
<key>CFBundleName</key><string>Notch Chat Daemon</string>
<key>CFBundleExecutable</key><string>ChatDaemon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.4.2</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
cp Tools/ChatDaemon/ChatBridge.js "$app/Contents/Resources/ChatBridge.js"
xcrun swiftc -parse-as-library -swift-version 5 -target "${ARCH:-$(uname -m)}-apple-macosx14.0" \
  Shared/Chat/ChatProtocol.swift Tools/ChatDaemon/LocalRPC.swift \
  Tools/ChatDaemon/SessionCookies.swift Tools/ChatDaemon/DaemonWebSession.swift Tools/ChatDaemon/main.swift \
  -o "$app/Contents/MacOS/ChatDaemon"
codesign --force --sign - "$app"
