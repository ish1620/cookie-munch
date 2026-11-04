#!/bin/zsh
# Set the version in the extension manifest and the Xcode project (Mac and iPhone apps) at once.
# Usage: tools/bump_version.sh 1.4.0      Then add a "## 1.4.0" entry at the top of CHANGELOG.md.
set -euo pipefail
cd "${0:A:h}/.."

version="${1:-}"
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  echo "Usage: tools/bump_version.sh <major.minor.patch>, for example 1.4.0" >&2
  exit 1
fi

python3 -I - "$version" <<'EOF'
import re, sys
version = sys.argv[1]
short = version[:-2] if version.endswith(".0") else version

path = "extension/manifest.json"
text = open(path).read()
text, n = re.subn(r'"version": "[^"]+"', f'"version": "{version}"', text, count=1)
assert n == 1, "no version in manifest.json"
open(path, "w").write(text)

path = "xcode/Cookie Munch/Cookie Munch.xcodeproj/project.xcproj"
text = open(path).read()
text, n = re.subn(r'"MARKETING_VERSION": "[^"]+"', f'"MARKETING_VERSION": "{short}"', text)
assert n, "no MARKETING_VERSION in the Xcode project"
open(path, "w").write(text)
print(f"manifest {version}, Xcode {short} ({n} targets)")
EOF
grep -q "^## $version" CHANGELOG.md || echo "Now add a '## $version' entry at the top of CHANGELOG.md."
