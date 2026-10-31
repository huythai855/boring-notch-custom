#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="$PWD/build/Notch Focus Test.app"
mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.notch.focustest</string>
<key>CFBundleName</key><string>Notch Focus Test</string>
<key>CFBundleExecutable</key><string>FocusTest</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macosx14.0" \
  Shared/Chat/ChatProtocol.swift Shared/Chat/NativeChatView.swift \
  Shared/Chat/ChatPanelController.swift Tests/ChatDaemon/FocusHarness.swift \
  -o "$app/Contents/MacOS/FocusTest"
codesign --force --sign - "$app"
