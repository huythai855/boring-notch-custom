#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
configuration="${CONFIGURATION:-Debug}"
architecture="${ARCH:-arm64}"
if ! xcodebuild -version >/dev/null 2>&1; then
  echo 'Full Xcode is required. Select it with DEVELOPER_DIR or xcode-select.' >&2
  exit 1
fi
bash Tools/ChatDaemon/build.sh > build/daemon-build.log 2>&1
# Use Xcode's package cache and a local ad-hoc identity. No developer account
# or provisioning profile is needed for a personal macOS build.
# Ad-hoc signatures have no Team ID, so hardened-runtime library validation
# cannot match the bundled frameworks to the host. Keep the sandbox entitlements.
xcodebuild -project boringNotch.xcodeproj -scheme boringNotch \
  -configuration "$configuration" -destination "platform=macOS,arch=$architecture" \
  -derivedDataPath "$PWD/build/DerivedData" \
  -onlyUsePackageVersionsFromResolvedFile \
  ARCHS="$architecture" ONLY_ACTIVE_ARCH=YES \
  ENABLE_HARDENED_RUNTIME=NO \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
  build > build/integrated-build.log 2>&1
echo 'Build succeeded. See build/integrated-build.log for product paths.'
