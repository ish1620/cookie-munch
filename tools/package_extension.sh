#!/bin/zsh
# Check the extension and zip it for people who load it in Safari as a temporary extension
# (Safari → Settings → Developer → Add Temporary Extension… accepts a folder or a zip).
# Usage: tools/package_extension.sh        Writes dist/cookie-munch-extension.zip
set -euo pipefail
cd "${0:A:h}/.."

echo "Checking…"
for file in extension/*.js tests/harness.js; do node --check "$file"; done
python3 -m json.tool extension/manifest.json >/dev/null
node tests/labels.mjs
node tests/check_extension.mjs

if grep -q "^globalThis.COOKIE_MUNCH_REPO_URL = '.*YOUR-NAME" extension/config.js; then
  echo "Note: the repository URL is still a placeholder, so the popup hides its Report link." >&2
  echo "      Run tools/set_repo_url.sh first for a public release." >&2
fi

version="$(python3 -I -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')"
mkdir -p dist
rm -f dist/cookie-munch-extension.zip
(cd extension && zip -qr -X ../dist/cookie-munch-extension.zip . -x '.*' -x '*/.*')
echo "Wrote dist/cookie-munch-extension.zip (Cookie Munch $version, $(du -h dist/cookie-munch-extension.zip | cut -f1))"
