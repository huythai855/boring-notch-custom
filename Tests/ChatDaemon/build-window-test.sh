#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="$PWD/build/Notch Window Lifecycle Test.app"
mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.notch.windowlifecycletest</string>
<key>CFBundleName</key><string>Notch Window Lifecycle Test</string>
<key>CFBundleExecutable</key><string>WindowTest</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macosx14.0" \
  Tools/ChatDaemon/ConnectionWindow.swift Tests/ChatDaemon/WindowLifecycleTests.swift \
  -o "$app/Contents/MacOS/WindowTest"
codesign --force --sign - "$app"
