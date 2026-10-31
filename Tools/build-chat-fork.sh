#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
bash Tools/ChatDaemon/build.sh > build/daemon-build.log 2>&1
# Use Xcode's package cache and a local ad-hoc identity. No developer account
# or provisioning profile is needed for a personal macOS build.
xcodebuild -project boringNotch.xcodeproj -scheme boringNotch \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
  build > build/integrated-build.log 2>&1
echo 'Build succeeded. See build/integrated-build.log for product paths.'
