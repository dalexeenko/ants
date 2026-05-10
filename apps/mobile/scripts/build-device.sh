#!/usr/bin/env bash
#
# Build and deploy the OpenMgr Expo Dev Client to a physical iOS device.
#
# Usage:
#   ./scripts/build-device.sh              # auto-detect connected device
#   ./scripts/build-device.sh <UDID>       # target a specific device by UDID
#
# Prerequisites:
#   - Xcode with your Apple ID added in Settings > Accounts
#   - Device registered: open the .xcworkspace in Xcode at least once,
#     go to Signing & Capabilities, select your team, and let Xcode
#     register the device + create a provisioning profile.
#   - Device paired (USB or wireless) and trusted
#   - pnpm dependencies installed (pnpm install from repo root)
#
# What this builds:
#   An Expo Dev Client build — includes the full dev experience on-device:
#   error overlays, shake-to-open dev menu, fast refresh, etc.
#   After installing, start Metro with: pnpm start
#   The app on your device will connect to your Mac's Metro bundler.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
IOS_DIR="$MOBILE_DIR/ios"
WORKSPACE="$IOS_DIR/OpenMgr.xcworkspace"
SCHEME="OpenMgr"
CONFIGURATION="Debug"
DEVELOPMENT_TEAM="2U9885LF7M"

# --- Resolve device UDID ---
if [ -n "${1:-}" ]; then
  DEVICE_UDID="$1"
  echo "==> Using provided device UDID: $DEVICE_UDID"
else
  echo "==> Auto-detecting connected iOS device..."
  # Find the first physical iOS device (not a Mac, not a simulator)
  DEVICE_LINE=$(xcrun xctrace list devices 2>/dev/null \
    | sed -n '/== Devices ==/,/== Simulators ==/p' \
    | grep -v "== Devices ==" \
    | grep -v "== Simulators ==" \
    | grep -v "MacBook\|Mac Pro\|Mac mini\|Mac Studio\|iMac" \
    | grep -v "^$" \
    | head -1)

  if [ -z "$DEVICE_LINE" ]; then
    echo "ERROR: No physical iOS device found."
    echo "Connect your device via USB or pair wirelessly, then try again."
    echo ""
    echo "Available devices:"
    xcrun xctrace list devices 2>/dev/null
    exit 1
  fi

  DEVICE_UDID=$(echo "$DEVICE_LINE" | grep -oE '\(([A-F0-9-]+)\)' | tail -1 | tr -d '()')
  DEVICE_NAME=$(echo "$DEVICE_LINE" | sed 's/ (.*//')
  echo "    Found: $DEVICE_NAME ($DEVICE_UDID)"
fi

# --- Step 1: Build workspace packages ---
echo ""
echo "==> Building workspace packages..."
(cd "$REPO_ROOT" && pnpm build)

# --- Step 2: Ensure signing is configured ---
# expo prebuild --clean wipes the ios/ directory, so we patch signing
# into the pbxproj if it's missing. This is idempotent.
PBXPROJ="$IOS_DIR/OpenMgr.xcodeproj/project.pbxproj"
if ! grep -q "DEVELOPMENT_TEAM" "$PBXPROJ"; then
  echo "==> Patching code signing (team: $DEVELOPMENT_TEAM)..."
  sed -i '' "/CODE_SIGN_ENTITLEMENTS/a\\
\\				CODE_SIGN_STYLE = Automatic;\\
\\				DEVELOPMENT_TEAM = $DEVELOPMENT_TEAM;
" "$PBXPROJ"
fi

# --- Step 3: Build with xcodebuild ---
echo ""
echo "==> Building OpenMgr for device $DEVICE_UDID..."
echo "    First build takes 10-15 minutes. Subsequent builds are much faster."
echo ""

DERIVED_DATA="$IOS_DIR/build/DerivedData"

# Use a temp file to capture the exit code through the pipe
BUILD_LOG=$(mktemp)
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "id=$DEVICE_UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  build \
  2>&1 | tee "$BUILD_LOG"

if grep -q "BUILD FAILED" "$BUILD_LOG"; then
  echo ""
  echo "ERROR: Build failed. Check the output above."
  echo "Tip: Open $WORKSPACE in Xcode to see detailed errors."
  echo ""
  echo "Common fixes:"
  echo "  - Device not registered: open .xcworkspace in Xcode, go to"
  echo "    Signing & Capabilities, select your team, and register."
  echo "  - Stale pods: cd ios && pod install"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

# --- Step 4: Install on device ---
echo ""
echo "==> Installing on device..."

APP_PATH=$(find "$DERIVED_DATA/Build/Products/$CONFIGURATION-iphoneos" -name "*.app" -maxdepth 1 | head -1)

if [ -z "$APP_PATH" ]; then
  echo "ERROR: Could not find built .app bundle."
  exit 1
fi

xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH" 2>&1

echo ""
echo "==> Done! OpenMgr dev client installed on your device."
echo ""
echo "Next steps:"
echo "  1. On your iPhone, go to Settings > General > VPN & Device Management"
echo "     and trust your developer certificate (first time only)."
echo "  2. Start the Metro dev server:"
echo "       cd apps/mobile && pnpm start"
echo "  3. Open the OpenMgr app on your device — it will connect to Metro."
echo ""
