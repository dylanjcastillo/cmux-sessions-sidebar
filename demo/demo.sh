#!/usr/bin/env bash
# Show the Sessions sidebar with made-up demo data, for screenshots.
#
#   demo/demo.sh          install sessions-demo and switch the sidebar to it
#   demo/demo.sh --off    switch back to sessions and remove sessions-demo
#
# The demo sidebar is demo/demo-data.js followed by sessions.js. It never shows
# your real workspaces, and its buttons do nothing.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dest="$HOME/.config/cmux/sidebars/sessions-demo.js"

if [[ "${1:-}" == "--off" ]]; then
  cmux sidebar select sessions
  rm -f "$dest"
  echo "Back on sessions; removed $dest"
  exit 0
fi

mkdir -p "$(dirname "$dest")"
cat "$repo/demo/demo-data.js" "$repo/sessions.js" > "$dest"
cmux sidebar validate sessions-demo
cmux sidebar reload sessions-demo || true
cmux sidebar select sessions-demo
echo "Showing sessions-demo. Run demo/demo.sh --off to switch back."
