#!/bin/zsh
# Build the Mac app, install it in /Applications, and open it once so Safari sees the extension.
# Needs Xcode, signed in with an Apple ID (Xcode → Settings → Accounts), and a signing.local file.
set -euo pipefail
cd "${0:A:h}/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
source tools/signing.sh
PROJECT="xcode/Cookie Munch/Cookie Munch.xcodeproj"
BUILT="xcode/build/Build/Products/Release/Cookie Munch.app"
INSTALLED="/Applications/Cookie Munch.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

echo "Building…"
xcodebuild -project "$PROJECT" -scheme "Cookie Munch (macOS)" -configuration Release \
  -derivedDataPath xcode/build -allowProvisioningUpdates -quiet "${SIGNING_SETTINGS[@]}" build

# Replace the installed copy.
pkill -x "Cookie Munch" 2>/dev/null || true
rm -rf "$INSTALLED"
ditto "$BUILT" "$INSTALLED"

# Make sure Safari only sees the installed copy, not the one in the build folder.
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
"$LSREGISTER" -f "$INSTALLED"

open "$INSTALLED"
echo "Installed $INSTALLED"
echo "Safari → Settings → Extensions: tick Cookie Munch and allow it on every website."
