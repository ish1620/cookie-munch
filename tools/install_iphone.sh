#!/bin/zsh
# Build the iPhone app and install it on your phone, over the cable or the same Wi-Fi.
# Apps signed with a free Apple ID stop opening after 7 days: run this again to renew.
# Usage: tools/install_iphone.sh [device-id]   (default: the first iPhone this Mac can reach)
set -euo pipefail
cd "${0:A:h}/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
source tools/signing.sh
PROJECT="xcode/Cookie Munch/Cookie Munch.xcodeproj"
BUILT="xcode/build/Build/Products/Debug-iphoneos/Cookie Munch.app"
LIST="$(mktemp -t devices).json"

device="${1:-}"
if [[ -z "$device" ]]; then
  xcrun devicectl list devices --json-output "$LIST" >/dev/null 2>&1
  device="$(python3 -I -c '
import json, sys
for d in json.load(open(sys.argv[1]))["result"]["devices"]:
    if d["hardwareProperties"].get("reality") == "physical" and d["connectionProperties"].get("tunnelState") != "unavailable":
        print(d["hardwareProperties"]["udid"]); break
' "$LIST")"
  rm -f "$LIST"
fi
if [[ -z "$device" ]]; then
  echo "No iPhone found. Unlock it, and plug it in or join the same Wi-Fi as this Mac." >&2
  exit 1
fi

echo "Building for $device…"
xcodebuild -project "$PROJECT" -scheme "Cookie Munch (iOS)" -configuration Debug \
  -destination "id=$device" -derivedDataPath xcode/build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet "${SIGNING_SETTINGS[@]}" build

echo "Installing…"
xcrun devicectl device install app --device "$device" "$BUILT" >/dev/null
xcrun devicectl device process launch --device "$device" "$APP_BUNDLE_ID" >/dev/null
echo "Installed and opened Cookie Munch on your iPhone."
