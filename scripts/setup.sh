#!/usr/bin/env bash
# Vision.Forge setup for macOS and Linux.
#
# Checks for Node.js (24.12 or newer), ffmpeg with ffprobe, a browser (Google
# Chrome, Microsoft Edge or Chromium) and Blender 5.2 LTS, prints a table and,
# when every required program is present, runs "npm ci --ignore-scripts" and
# "node scripts/cli.ts doctor". With --install the missing programs are
# installed first: Homebrew on macOS, apt-get and snap on Linux (Node.js on
# Linux is a printed hint, since distributions differ). Never asks for input
# itself; on Linux --install calls sudo, which may ask for your password.
#
# Usage: scripts/setup.sh [--install] [--check-only] [--skip-blender] [--data-dir <dir>]
set -euo pipefail

INSTALL=0
CHECK_ONLY=0
SKIP_BLENDER=0
DATA_DIR=''
MIN_NODE_MAJOR=24
MIN_NODE_MINOR=12
BLENDER_SERIES='5.2'

usage() {
  echo 'Usage: scripts/setup.sh [--install] [--check-only] [--skip-blender] [--data-dir <dir>]'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    --skip-blender) SKIP_BLENDER=1 ;;
    --data-dir)
      if [[ $# -lt 2 ]]; then echo '--data-dir needs a value.' >&2; usage >&2; exit 2; fi
      DATA_DIR="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM='darwin' ;;
  Linux) PLATFORM='linux' ;;
  *) echo "This script supports macOS and Linux; on Windows run Setup-VisionForge.cmd (found: $OS)." >&2; exit 2 ;;
esac

if [[ "$PLATFORM" == 'darwin' ]]; then
  NODE_HINT='brew install node@24'
  FFMPEG_HINT='brew install ffmpeg'
  BROWSER_HINT='install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge into /Applications'
  BLENDER_HINT='brew install --cask blender (then confirm blender --version starts with 5.2)'
else
  NODE_HINT='install Node.js 24 from NodeSource (https://github.com/nodesource/distributions) or with nvm (nvm install 24)'
  FFMPEG_HINT='sudo apt-get install -y ffmpeg'
  BROWSER_HINT='install google-chrome, microsoft-edge or chromium with your package manager'
  # The blender snap publishes only latest/stable and latest/edge (no 5.2 track), so the version is confirmed afterwards.
  BLENDER_HINT="sudo snap install blender --classic (then confirm blender --version starts with ${BLENDER_SERIES})"
fi

NODE_PATH_FOUND=''
NODE_VERSION=''
NODE_OK=0
find_node() {
  NODE_PATH_FOUND="$(command -v node || true)"
  [[ -n "$NODE_PATH_FOUND" ]] || return 0
  local text
  text="$("$NODE_PATH_FOUND" --version 2>/dev/null || true)"
  NODE_VERSION="${text#v}"
  local major minor
  major="${NODE_VERSION%%.*}"
  minor="${NODE_VERSION#*.}"
  minor="${minor%%.*}"
  if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]]; then
    if (( major > MIN_NODE_MAJOR )) || (( major == MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR )); then NODE_OK=1; fi
  fi
}

FFMPEG_PATH_FOUND=''
FFMPEG_VERSION=''
FFMPEG_OK=0
find_ffmpeg() {
  local candidate
  for candidate in "${FFMPEG:-}" "$(command -v ffmpeg || true)" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg /usr/bin/ffmpeg /snap/bin/ffmpeg; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    FFMPEG_PATH_FOUND="$candidate"
    break
  done
  [[ -n "$FFMPEG_PATH_FOUND" ]] || return 0
  local first
  first="$("$FFMPEG_PATH_FOUND" -version 2>/dev/null | head -n 1 || true)"
  if [[ "$first" =~ ^ffmpeg\ version\ ([^[:space:]]+) ]]; then FFMPEG_VERSION="${BASH_REMATCH[1]}"; fi
  local probe
  probe="$(dirname "$FFMPEG_PATH_FOUND")/ffprobe"
  if [[ -n "$FFMPEG_VERSION" ]] && { [[ -x "$probe" ]] || command -v ffprobe >/dev/null 2>&1; }; then FFMPEG_OK=1; fi
}

BROWSER_PATH_FOUND=''
BROWSER_VERSION=''
BROWSER_OK=0
find_browser() {
  local candidates=()
  if [[ "$PLATFORM" == 'darwin' ]]; then
    candidates+=('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  else
    local name
    for name in microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable chromium chromium-browser; do
      candidates+=("$(command -v "$name" || true)")
    done
  fi
  if [[ -n "${CHROME:-}" ]]; then candidates=("$CHROME" "${candidates[@]}"); fi
  local candidate
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    BROWSER_PATH_FOUND="$candidate"
    BROWSER_VERSION="$("$candidate" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
    BROWSER_OK=1
    return 0
  done
}

BLENDER_PATH_FOUND=''
BLENDER_VERSION=''
BLENDER_OK=0
find_blender() {
  local candidate
  for candidate in "${BLENDER:-}" /Applications/Blender.app/Contents/MacOS/Blender /snap/bin/blender /usr/bin/blender /usr/local/bin/blender "$(command -v blender || true)"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    BLENDER_PATH_FOUND="$candidate"
    break
  done
  [[ -n "$BLENDER_PATH_FOUND" ]] || return 0
  BLENDER_VERSION="$("$BLENDER_PATH_FOUND" --version 2>/dev/null | grep -oE '^Blender [0-9]+\.[0-9]+\.[0-9]+' | head -n 1 | cut -d ' ' -f 2 || true)"
  if [[ "$BLENDER_VERSION" == "${BLENDER_SERIES}."* ]]; then BLENDER_OK=1; fi
}

row() {
  local found='no'
  [[ "$2" == '1' ]] && found='yes'
  printf '%-28s %-7s %-32s %s\n' "$1" "$found" "${3:--}" "${4:--}"
  if [[ "$2" != '1' ]]; then printf '%-28s install: %s\n' '' "$5"; fi
}

report() {
  printf '%-28s %-7s %-32s %s\n' 'Program' 'Found' 'Version' 'Path'
  row 'Node.js 24.12+' "$NODE_OK" "$NODE_VERSION" "$NODE_PATH_FOUND" "$NODE_HINT"
  row 'ffmpeg + ffprobe' "$FFMPEG_OK" "$FFMPEG_VERSION" "$FFMPEG_PATH_FOUND" "$FFMPEG_HINT"
  row 'Chrome, Edge or Chromium' "$BROWSER_OK" "$BROWSER_VERSION" "$BROWSER_PATH_FOUND" "$BROWSER_HINT"
  row "Blender ${BLENDER_SERIES} LTS (optional)" "$BLENDER_OK" "$BLENDER_VERSION" "$BLENDER_PATH_FOUND" "$BLENDER_HINT"
  if [[ -n "$BLENDER_PATH_FOUND" && "$BLENDER_OK" != '1' ]]; then
    echo "Blender ${BLENDER_VERSION:-unknown} at $BLENDER_PATH_FOUND is not supported; only ${BLENDER_SERIES}.x is. Install it with: $BLENDER_HINT (two versions can coexist)."
  fi
}

check_all() {
  NODE_PATH_FOUND=''; NODE_VERSION=''; NODE_OK=0
  FFMPEG_PATH_FOUND=''; FFMPEG_VERSION=''; FFMPEG_OK=0
  BROWSER_PATH_FOUND=''; BROWSER_VERSION=''; BROWSER_OK=0
  BLENDER_PATH_FOUND=''; BLENDER_VERSION=''; BLENDER_OK=0
  find_node
  find_ffmpeg
  find_browser
  find_blender
}

install_missing() {
  if [[ "$PLATFORM" == 'darwin' ]]; then
    if ! command -v brew >/dev/null 2>&1; then
      echo 'Homebrew was not found. Install it from https://brew.sh/, then run scripts/setup.sh --install again.' >&2
      exit 1
    fi
    if [[ "$NODE_OK" != '1' ]]; then echo 'Installing Node.js 24 to run the command-line program (brew install node@24).'; brew install node@24; brew link --overwrite --force node@24; fi
    if [[ "$FFMPEG_OK" != '1' ]]; then echo 'Installing ffmpeg to assemble and check video (brew install ffmpeg).'; brew install ffmpeg; fi
    if [[ "$BLENDER_OK" != '1' && "$SKIP_BLENDER" != '1' && -z "$BLENDER_PATH_FOUND" ]]; then echo 'Installing Blender for the blender lane (optional; skipped with --skip-blender).'; brew install --cask blender; fi
  else
    if [[ "$NODE_OK" != '1' ]]; then echo "Node.js 24.12 or newer is not installed; distributions differ, so install it by hand: $NODE_HINT. Then run scripts/setup.sh --install again." >&2; fi
    if [[ "$FFMPEG_OK" != '1' ]]; then
      if command -v apt-get >/dev/null 2>&1; then echo 'Installing ffmpeg to assemble and check video (sudo apt-get install -y ffmpeg).'; sudo apt-get install -y ffmpeg
      else echo "apt-get was not found; install ffmpeg with your package manager ($FFMPEG_HINT on Debian and Ubuntu)." >&2; fi
    fi
    if [[ "$BLENDER_OK" != '1' && "$SKIP_BLENDER" != '1' && -z "$BLENDER_PATH_FOUND" ]]; then
      if command -v snap >/dev/null 2>&1; then echo "Installing Blender for the blender lane (optional; skipped with --skip-blender); confirm afterwards that blender --version starts with ${BLENDER_SERIES}."; sudo snap install blender --classic
      else echo "snap was not found; install Blender ${BLENDER_SERIES} LTS from https://www.blender.org/download/lts/ or skip the blender lane." >&2; fi
    fi
  fi
}

echo "Vision.Forge setup (repository: $REPO_ROOT)"
check_all
report

if [[ "$CHECK_ONLY" == '1' ]]; then
  if [[ "$NODE_OK" == '1' && "$FFMPEG_OK" == '1' && "$BROWSER_OK" == '1' ]]; then exit 0; fi
  echo 'A required program is missing. Run scripts/setup.sh --install to install it, or use the command listed above.'
  exit 1
fi

if [[ "$INSTALL" == '1' ]]; then
  install_missing
  echo ''
  check_all
  report
fi

MISSING=()
[[ "$NODE_OK" == '1' ]] || MISSING+=('Node.js 24.12 or newer')
[[ "$FFMPEG_OK" == '1' ]] || MISSING+=('ffmpeg with ffprobe')
[[ "$BROWSER_OK" == '1' ]] || MISSING+=('Chrome, Edge or Chromium')
if (( ${#MISSING[@]} > 0 )); then
  if [[ "$INSTALL" == '1' ]]; then
    echo "Still missing after installation: ${MISSING[*]}. Open a new terminal and run scripts/setup.sh again; if it persists, install with the commands above." >&2
  else
    echo "Missing: ${MISSING[*]}. Run scripts/setup.sh --install to install them, or use the commands above and run setup again." >&2
  fi
  exit 1
fi
if [[ "$BLENDER_OK" != '1' ]]; then
  if [[ -n "$BLENDER_PATH_FOUND" ]]; then
    echo "Blender ${BLENDER_VERSION:-unknown} at $BLENDER_PATH_FOUND is not ${BLENDER_SERIES}.x; --install leaves an existing Blender alone. Install ${BLENDER_SERIES} LTS by hand with: $BLENDER_HINT (two versions can coexist)."
  else
    echo "Blender ${BLENDER_SERIES} LTS is not available; the blender lane is off until it is installed (scripts/setup.sh --install, or: $BLENDER_HINT)."
  fi
fi

echo 'Installing the pinned dependencies with npm ci --ignore-scripts.'
cd "$REPO_ROOT"
npm ci --ignore-scripts
echo 'Running doctor.'
if [[ -n "$DATA_DIR" ]]; then
  "$NODE_PATH_FOUND" scripts/cli.ts doctor --data-dir "$DATA_DIR"
else
  "$NODE_PATH_FOUND" scripts/cli.ts doctor
fi
echo 'Vision.Forge is ready. Run node scripts/cli.ts doctor any time to see which lanes are available.'
