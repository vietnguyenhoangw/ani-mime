#!/bin/bash
# Post-build: re-sign the .app with entitlements and re-package the DMG.
# Tauri doesn't embed entitlements for ad-hoc signing, so we do it manually.
#
# Usage: post-build-sign.sh [TARGET_TRIPLE]
#   e.g. post-build-sign.sh aarch64-apple-darwin
#   Without argument, uses target/release/ (local builds).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$TAURI_DIR/Entitlements.plist"

TARGET="${1:-}"
if [ -n "$TARGET" ]; then
  RELEASE_DIR="$TAURI_DIR/target/$TARGET/release"
else
  RELEASE_DIR="$TAURI_DIR/target/release"
fi

APP_PATH="$RELEASE_DIR/bundle/macos/ani-mime.app"
DMG_DIR="$RELEASE_DIR/bundle/dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run 'bun run tauri build' first."
  exit 1
fi

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "Error: $ENTITLEMENTS not found."
  exit 1
fi

echo "==> Re-signing ani-mime.app with entitlements..."
codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP_PATH"

# Verify
echo "==> Verifying entitlements..."
codesign -d --entitlements - "$APP_PATH" 2>&1 | grep -q "network.server" \
  && echo "    OK: network entitlements embedded" \
  || { echo "    FAIL: entitlements not found"; exit 1; }

# Re-create DMG
VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    aarch64*) ARCH="aarch64" ;;
    x86_64*)  ARCH="x64" ;;
    *)        ARCH=$(uname -m) ;;
  esac
else
  RAW_ARCH=$(uname -m)
  case "$RAW_ARCH" in
    arm64) ARCH="aarch64" ;;
    *)     ARCH="$RAW_ARCH" ;;
  esac
fi
DMG_NAME="ani-mime_${VERSION}_${ARCH}.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"

echo "==> Creating DMG: $DMG_NAME"
rm -f "$DMG_PATH"
mkdir -p "$DMG_DIR"

hdiutil create -volname "ani-mime" \
  -srcfolder "$APP_PATH" \
  -ov -format UDZO \
  "$DMG_PATH"

echo ""
echo "Done! Distribution-ready files:"
echo "  .app: $APP_PATH"
echo "  .dmg: $DMG_PATH"
