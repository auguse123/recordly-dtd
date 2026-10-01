#!/bin/zsh
# Build Recordly DTD, sign it with the local "Recordly DTD Local Signing" certificate
# (stable designated requirement => macOS keeps screen/mic/camera permissions across
# rebuilds), and install it to /Applications.
set -euo pipefail

REPO="${0:A:h:h}"
APP_NAME="Recordly DTD.app"
BUILT="$REPO/release/mac-arm64/$APP_NAME"
DEST="/Applications/$APP_NAME"
IDENTITY="Recordly DTD Local Signing"
LOG="${REPO:h}/build-dtd.log"

cd "$REPO"
source ~/.nvm/nvm.sh >/dev/null

if [[ "${1:-}" != "--skip-build" ]]; then
	echo "Building (log: $LOG)…"
	CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac >"$LOG" 2>&1
fi

echo "Signing with \"$IDENTITY\"…"
codesign --force --deep --sign "$IDENTITY" \
	--entitlements build/entitlements.mac.plist "$BUILT"
codesign -d -r- "$BUILT" 2>&1 | grep designated

if pgrep -f "$DEST/Contents/MacOS" >/dev/null; then
	echo "Recordly DTD is running: quit it, then rerun with --skip-build." >&2
	exit 1
fi

rm -rf "$DEST"
ditto "$BUILT" "$DEST"
echo "Installed $DEST"
