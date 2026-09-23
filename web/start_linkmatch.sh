#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$SCRIPT_DIR" || exit 1
fail() {
  printf '\n%s\n' "$1"
  if [ -t 0 ]; then printf 'Press Enter to close...'; read -r reply; fi
  exit 1
}
command -v node >/dev/null 2>&1 || fail "Install Node.js 22.13 or newer (with npm), then try again."
command -v npm >/dev/null 2>&1 || fail "npm is missing. Install Node.js with npm, then try again."
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || (major===22 && minor>=13) ? 0 : 1)' || fail "Node.js 22.13 or newer is required."
if [ ! -f node_modules/vinext/dist/cli.js ]; then
  printf 'Installing dependencies for the first run...\n'
  npm ci || fail "Dependency installation failed. Check the errors above and your internet connection."
fi
npm run local || fail "LinkMatch stopped with an error. See the message above."
