#!/bin/bash
set -euo pipefail

# chrome-to-safari.sh — convert any Chrome / WebExtension into a signed,
# installed Safari extension. No paid Apple Developer ID needed.
#
# Usage:
#   ./chrome-to-safari.sh /path/to/extension              # convert + build + install + launch
#   ./chrome-to-safari.sh <chrome-web-store-url>          # download from the store, then same
#   ./chrome-to-safari.sh /path/to/extension --build-only # convert + build, don't install
#   OUT_DIR=/path/to/ext-safari ./chrome-to-safari.sh --install-only  # rebuild + install from existing project
#   ./chrome-to-safari.sh --from-source /path/to/project   # rebuild + install from a saved project folder
#   ./chrome-to-safari.sh --ui                            # open the native app UI
#
# Env overrides (all optional):
#   APP_NAME    display name        (default: "name" from manifest.json)
#   BUNDLE_ID   bundle identifier   (default: com.converted.<slug>)
#   TEAM_ID     Apple team ID       (default: auto-detected from your keychain)
#   OUT_DIR     output directory    (default: ./<slug>-safari next to the extension)

# --- Native UI ----------------------------------------------------------------
# compiled from ui.swift on the user's own machine, so Gatekeeper never sees it
if [ "${1:-}" = "--ui" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  UI_SRC="$SCRIPT_DIR/ui.swift"
  UI_BIN="$SCRIPT_DIR/.ui/ChromeToSafari"
  if [ ! -x "$UI_BIN" ] || [ "$UI_SRC" -nt "$UI_BIN" ]; then
    echo "==> Compiling the UI (first run only)..."
    mkdir -p "$SCRIPT_DIR/.ui"
    swiftc -O -parse-as-library "$UI_SRC" -o "$UI_BIN"
  fi
  exec env C2S_SCRIPT="$SCRIPT_DIR/chrome-to-safari.sh" "$UI_BIN"
fi

# --- Shared helpers -------------------------------------------------------------

# Locate the single converted Xcode project under $1. Accepts either the output
# folder (project nested one level: <dir>/<app>/<app>.xcodeproj) or the app
# folder itself (<dir>/<app>.xcodeproj). Sets $PROJECT.
find_project() {
  local dir="$1" direct nested
  shopt -s nullglob
  direct=("$dir"/*.xcodeproj)
  nested=("$dir"/*/*.xcodeproj)
  shopt -u nullglob
  if [ "${#direct[@]}" -eq 1 ]; then
    PROJECT="${direct[0]}"
  elif [ "${#nested[@]}" -eq 1 ]; then
    PROJECT="${nested[0]}"
  else
    echo "ERROR: expected one converted Xcode project in $dir" >&2
    echo "  Found ${#direct[@]} project(s) directly and ${#nested[@]} nested project(s)." >&2
    echo "  Point this mode at the output folder from --build-only, or at the project folder itself." >&2
    return 1
  fi
}

# Detect an Apple Development team ID from the keychain; override with TEAM_ID.
# Never fails the script when no certificate is found — callers check TEAM_ID.
detect_team_id() {
  if [ -z "${TEAM_ID:-}" ]; then
    TEAM_ID="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
      | openssl x509 -noout -subject 2>/dev/null \
      | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p')" || TEAM_ID=""
  fi
}

# Print the one-time Apple Development certificate setup instructions.
print_cert_help() {
  cat >&2 <<'EOF'
ERROR: No Apple Development certificate found.

One-time setup (free, no paid developer account needed):
  1. Open Xcode > Settings > Accounts
  2. Click "+" and sign in with your Apple ID
  3. Select your account > "Manage Certificates..." > "+" > "Apple Development"
  4. Re-run this script

Without this, Safari treats the extension as unsigned and disables it
on every restart.
EOF
}

# Detect the team ID, or print setup help and exit if none is available.
require_team_id() {
  detect_team_id
  if [ -z "$TEAM_ID" ]; then
    print_cert_help
    exit 1
  fi
}

# Build a converted project, verify its signature, and (unless --skip-install)
# install it to /Applications and launch Safari.
build_install_project() {
  local project="$1" app_name="$2" root="$3" skip="${4:-}"
  local app

  echo "==> Building..."
  rm -rf "$root/build/Build/Products"   # no stale products from failed runs
  xcodebuild \
    -project "$project" \
    -scheme "$app_name" \
    -configuration Release \
    -derivedDataPath "$root/build" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    build 2>&1 | grep -E "BUILD|error|Cycle"

  app="$root/build/Build/Products/Release/$app_name.app"
  if [ ! -d "$app" ]; then
    echo "ERROR: build product not found at $app" >&2
    exit 1
  fi

  echo "==> Verifying signature..."
  codesign --verify --deep --strict "$app"

  if [ "$skip" = "--skip-install" ]; then
    echo ""
    echo "Done (build only). App at: $app"
    return 0
  fi

  echo "==> Installing to /Applications..."
  rm -rf "/Applications/$app_name.app"
  mv "$app" /Applications/

  /System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister \
    -f -R -trusted "/Applications/$app_name.app"

  open -a "/Applications/$app_name.app"
  sleep 2
  open -a Safari

  echo ""
  echo "Done. Enable it in Safari > Settings > Extensions."
}

# --- Install-only mode: rebuild + install from an existing converted project ---
# Requires OUT_DIR. The project's build/ tree may be absent; it is regenerated.
if [ "${1:-}" = "--install-only" ]; then
  if [ -z "${OUT_DIR:-}" ]; then
    echo "ERROR: --install-only requires OUT_DIR to point to the converted project directory." >&2
    echo "  Example: OUT_DIR=/path/to/ext-safari ./chrome-to-safari.sh --install-only" >&2
    exit 1
  fi
  OUT_DIR="$(cd "$OUT_DIR" && pwd)"

  find_project "$OUT_DIR"
  APP_NAME="$(basename "$PROJECT" .xcodeproj)"

  require_team_id
  echo "==> App name:  $APP_NAME"
  echo "==> Team ID:   $TEAM_ID"

  build_install_project "$PROJECT" "$APP_NAME" "$OUT_DIR"
  exit 0
fi

# --- From-source mode: rebuild + install from a saved project folder ------------
# e.g. the source extracted by --build-only when the large build/ tree was not
# kept (for example, you only synced the converted project to git). The build/
# tree is regenerated from the existing project. Accepts either the output
# folder or the project folder itself.
if [ "${1:-}" = "--from-source" ]; then
  SRC="${2:?usage: chrome-to-safari.sh --from-source /path/to/converted-project}"
  SRC="$(cd "$SRC" && pwd)"

  find_project "$SRC"
  APP_NAME="$(basename "$PROJECT" .xcodeproj)"
  ROOT="$(dirname "$(dirname "$PROJECT")")"

  require_team_id
  echo "==> App name:  $APP_NAME"
  echo "==> Team ID:   $TEAM_ID"
  echo "==> Source:    $SRC"

  build_install_project "$PROJECT" "$APP_NAME" "$ROOT"
  exit 0
fi

EXT_DIR="${1:?usage: chrome-to-safari.sh /path/to/extension|<store-url> [--build-only] | --from-source /path/to/project | --ui}"
BUILD_ONLY="${2:-}"

# --- Chrome Web Store URL? Download and unpack first --------------------------
if [[ "$EXT_DIR" == http*://* ]]; then
  # store URLs: .../detail/<slug>/<32-char-id>; IDs use letters a-p only
  EXT_ID="$(printf '%s' "$EXT_DIR" | grep -oE '[a-p]{32}' | head -1)"
  if [ -z "$EXT_ID" ]; then
    echo "ERROR: no extension ID in that URL. Expected a Chrome Web Store link like" >&2
    echo "  https://chromewebstore.google.com/detail/<name>/<32-char-id>" >&2
    exit 1
  fi
  # use the URL's name slug as the folder name so APP_NAME falls back to it
  URL_SLUG="$(printf '%s' "$EXT_DIR" | sed -n 's|.*/detail/\([^/]*\)/.*|\1|p')"
  DL_DIR="$(mktemp -d)/${URL_SLUG:-$EXT_ID}"
  mkdir -p "$DL_DIR"
  echo "==> Downloading $EXT_ID from Chrome Web Store..."
  curl -fsSL -o "$DL_DIR.crx" \
    "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3D${EXT_ID}%26uc"
  # a .crx is a zip with a binary header; unzip skips the junk but exits nonzero
  unzip -qo "$DL_DIR.crx" -d "$DL_DIR" 2>/dev/null || true
  if [ ! -f "$DL_DIR/manifest.json" ]; then
    echo "ERROR: download failed — no manifest.json in the downloaded package" >&2
    exit 1
  fi
  rm -rf "$DL_DIR/_metadata"   # store signing artifacts; the converter chokes on them
  EXT_DIR="$DL_DIR"
  OUT_BASE="$PWD"              # don't leave build output in the temp dir
fi

EXT_DIR="$(cd "$EXT_DIR" && pwd)"
MANIFEST="$EXT_DIR/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: no manifest.json in $EXT_DIR — is this a WebExtension?" >&2
  exit 1
fi

# --- Names ------------------------------------------------------------------
if [ -z "${APP_NAME:-}" ]; then
  APP_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("name",""))' "$MANIFEST")"
  # i18n manifests use "__MSG_key__" placeholders; fall back to folder name
  case "$APP_NAME" in ""|__MSG_*) APP_NAME="$(basename "$EXT_DIR")";; esac
fi

SLUG="$(printf '%s' "$APP_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')"
BUNDLE_ID="${BUNDLE_ID:-com.converted.$SLUG}"
OUT_DIR="${OUT_DIR:-${OUT_BASE:-$(dirname "$EXT_DIR")}/$SLUG-safari}"

echo "==> App name:  $APP_NAME"
echo "==> Bundle ID: $BUNDLE_ID"
echo "==> Output:    $OUT_DIR"

# --- Signing identity ---------------------------------------------------------
# ponytail: picks first Apple Development cert; set TEAM_ID env var to override
require_team_id
echo "==> Team ID:   $TEAM_ID"

# --- Convert ------------------------------------------------------------------
echo "==> Converting with safari-web-extension-converter..."
xcrun safari-web-extension-converter "$EXT_DIR" \
  --project-location "$OUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only --copy-resources --no-open --no-prompt --force

PROJECT="$OUT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
if [ ! -d "$PROJECT" ]; then
  echo "ERROR: converter did not produce $PROJECT" >&2
  exit 1
fi

# The converter sometimes derives the app's bundle ID from the app name while
# giving the extension the ID passed via --bundle-identifier. If they differ
# (even by case), the build fails with "Embedded binary's bundle identifier is
# not prefixed with the parent app's bundle identifier". Normalize: make the
# extension's ID always be <app ID>.Extension.
PBX="$PROJECT/project.pbxproj"
APP_ID="$(grep -o 'PRODUCT_BUNDLE_IDENTIFIER = "\{0,1\}[^";]*' "$PBX" \
  | sed 's/.*= "\{0,1\}//' | grep -v '\.Extension$' | head -1)"
sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = \"\{0,1\}[^\";]*\.Extension\"\{0,1\};/PRODUCT_BUNDLE_IDENTIFIER = \"$APP_ID.Extension\";/g" "$PBX"

# --- Build + install ------------------------------------------------------------
if [ "$BUILD_ONLY" = "--build-only" ]; then
  build_install_project "$PROJECT" "$APP_NAME" "$OUT_DIR" --skip-install
  exit 0
fi

build_install_project "$PROJECT" "$APP_NAME" "$OUT_DIR"

# The generated project and build tree hold extra copies of the extension.
# Once the app is in /Applications they're dead weight; a re-run regenerates
# everything from scratch anyway. Use --build-only if you want to keep them.
# Only remove the two directories this script created, never OUT_DIR wholesale.
rm -rf "$OUT_DIR/$APP_NAME" "$OUT_DIR/build"
rmdir "$OUT_DIR" 2>/dev/null || true
