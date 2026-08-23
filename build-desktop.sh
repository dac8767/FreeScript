#!/bin/bash
# ============================================================================
# ScriptCraft — Desktop Build Script (.dmg distribution)
# Builds, signs, and notarizes the app for direct download distribution.
#
# Tauri handles signing and notarization automatically when the correct
# environment variables are set. Credentials are loaded from .env.
#
#   ./build-desktop.sh            release: signed + notarized (needs Apple creds)
#   ./build-desktop.sh --local    LOCAL install, unsigned, no Apple account
#
# v7.31, why --local exists. Derek could not test whether double-clicking a
# .script file opens the app: macOS reads file associations from Info.plist,
# which is written at BUILD time, and `tauri dev` never installs a bundle at
# all — so a dev session can never register one. The only way to test it is an
# installed .app, and requiring a notarized build (which needs an Apple
# Developer membership that is still an open release blocker) made testing an
# OS-level behaviour impossible for the person who owns the app.
# An unsigned local build registers associations on your own machine exactly
# like a signed one. Gatekeeper will refuse the FIRST launch — right-click the
# app and choose Open, once. It is not for distribution.
# ============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
TAURI_DIR="$PROJECT_ROOT/src-tauri"

# Load credentials from .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    . "$PROJECT_ROOT/.env"
    set +a
fi

LOCAL=0
[ "$1" = "--local" ] && LOCAL=1

if [ "$LOCAL" = "0" ]; then
    if [ -z "$APPLE_PASSWORD" ] || [ "$APPLE_PASSWORD" = "REPLACE_WITH_APP_SPECIFIC_PASSWORD" ]; then
        echo "Error: APPLE_PASSWORD not set."
        echo "Set it in .env (project root) or as an environment variable."
        echo "Generate an app-specific password at https://appleid.apple.com"
        echo ""
        echo "To build for YOURSELF without an Apple account:"
        echo "    ./build-desktop.sh --local"
        exit 1
    fi
    # Signing identity — used by Tauri for the app bundle. READ FROM .env,
    # like the other three, rather than written here.
    #
    # v7.79: this line used to hardcode
    #   "Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)"
    # — Proteus's certificate, from upstream OpenDraft, whose private key this
    # project has never had. Every release build therefore asked the keychain
    # for a certificate that is not in it. Naming it here also meant that the
    # day a real identity existed, signing would still fail until someone
    # noticed the constant.
    if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
        echo "Error: APPLE_SIGNING_IDENTITY not set."
        echo "Add it to .env (project root), exactly as `security find-identity -v -p codesigning` prints it:"
        echo '    APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"'
        echo ""
        echo "To build for YOURSELF without an Apple account:"
        echo "    ./build-desktop.sh --local"
        exit 1
    fi
    export APPLE_SIGNING_IDENTITY
else
    # Tauri signs when these are set, so they must be UNSET, not empty —
    # an empty APPLE_SIGNING_IDENTITY still trips its signing path.
    unset APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
fi

# Detect the Rust target triple
TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
echo "=== ScriptCraft Desktop Build ==="
echo "Target: $TARGET_TRIPLE"
if [ "$LOCAL" = "1" ]; then
    echo "Signing: NONE (--local; not for distribution)"
else
    echo "Signing: $APPLE_SIGNING_IDENTITY"
fi
echo ""

# ── Step 1: Build the frontend ────────────────────────────────────────────────
echo ""
echo "=== Step 1/2: Building frontend ==="
cd "$FRONTEND_DIR"
# v7.31: INSTALL FIRST. A pull can add a dependency (esbuild did), and going
# straight to `npm run build` then fails on a package that is declared but not
# on disk — which reads as the build being broken rather than one npm install
# behind. Cheap no-op when nothing changed.
npm install --silent
npm run build

# ── Step 2: Build, sign, and notarize with Tauri ─────────────────────────────
# Tauri automatically signs all binaries and notarizes when
# APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID
# are set in the environment.
echo ""
if [ "$LOCAL" = "1" ]; then
    echo "=== Step 2/2: Building Tauri app (unsigned, local) ==="
else
    echo "=== Step 2/2: Building Tauri app (with signing + notarization) ==="
fi
cd "$PROJECT_ROOT"
"$FRONTEND_DIR/node_modules/.bin/tauri" build

DMG_FILE=$(find "$TAURI_DIR/target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)

APP_FILE=$(find "$TAURI_DIR/target/release/bundle/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -1)

echo ""
echo "=== Desktop build complete! ==="
if [ "$LOCAL" = "1" ]; then
    echo "UNSIGNED build — for this machine only, not for distribution."
    echo "  app: $APP_FILE"
    echo "  dmg: $DMG_FILE"
    echo ""
    echo "To test file associations (.script double-click):"
    echo "  1. rm -rf /Applications/ScriptCraft.app"
    echo "  2. cp -R \"$APP_FILE\" /Applications/"
    echo "  3. right-click it in /Applications and choose Open, ONCE (Gatekeeper)"
    echo "  4. if .script is still greyed out in Open With, rebuild the"
    echo "     LaunchServices database — it caches the old bundle:"
    echo "     /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user"
else
    echo "Signed + notarized .dmg: $DMG_FILE"
fi
