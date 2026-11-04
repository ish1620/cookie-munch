#!/bin/zsh
# Point every link (README, docs, popup "Report it", issue templates, the app) at the real repository.
# Usage: tools/set_repo_url.sh https://github.com/someone/cookie-munch
set -euo pipefail
cd "${0:A:h}/.."

url="${1:-}"
if [[ ! "$url" =~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ]]; then
  echo "Usage: tools/set_repo_url.sh https://github.com/<owner>/<repository>" >&2
  exit 1
fi

current="$(sed -n "s/^globalThis.COOKIE_MUNCH_REPO_URL = '\(.*\)';$/\1/p" extension/config.js)"
if [[ -z "$current" ]]; then
  echo "Couldn't read the current URL from extension/config.js" >&2
  exit 1
fi

files=(README.md CONTRIBUTING.md extension/config.js .github/ISSUE_TEMPLATE/config.yml
  "xcode/Cookie Munch/Shared (App)/Resources/Base.lproj/Main.html")
for file in "${files[@]}"; do
  # Plain text replace (no regex), so dots and slashes in the URLs need no escaping.
  python3 -I -c 'import sys; p, old, new = sys.argv[1:]; s = open(p).read(); open(p, "w").write(s.replace(old, new))' \
    "$file" "$current" "$url"
done
echo "Links now point to $url (was $current)."
grep -rn "$url" "${files[@]}" | wc -l | xargs echo "Occurrences:"
