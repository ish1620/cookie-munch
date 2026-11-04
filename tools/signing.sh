# Loads your signing settings from signing.local (see signing.example).
# Sourced by build_app.sh and install_iphone.sh from the repository root.
if [[ ! -f signing.local ]]; then
  echo "Missing signing.local: copy signing.example to signing.local and fill in your team and app ID." >&2
  exit 1
fi
source ./signing.local
: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM in signing.local}"
: "${APP_BUNDLE_ID:?Set APP_BUNDLE_ID in signing.local}"
SIGNING_SETTINGS=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" APP_BUNDLE_ID="$APP_BUNDLE_ID")
