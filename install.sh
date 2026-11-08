#!/usr/bin/env bash
# Install the Sessions sidebar into cmux.
#
#   ./install.sh          symlink sessions.js into ~/.config/cmux/sidebars (edits here go live)
#   ./install.sh --copy   copy it instead (for machines where you won't edit the repo)
#
# An existing ~/.config/cmux/sidebars/sessions.js that isn't already this
# symlink is backed up to sessions.js.bak-<timestamp> first.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
src="$repo/sessions.js"
dir="$HOME/.config/cmux/sidebars"
dest="$dir/sessions.js"
mode="link"
[[ "${1:-}" == "--copy" ]] && mode="copy"

mkdir -p "$dir"

if [[ -L "$dest" && "$(readlink "$dest")" == "$src" && "$mode" == "link" ]]; then
  echo "Already linked: $dest -> $src"
else
  if [[ -e "$dest" || -L "$dest" ]]; then
    backup="$dest.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$dest" "$backup"
    echo "Backed up existing sidebar to $backup"
  fi
  if [[ "$mode" == "copy" ]]; then
    cp "$src" "$dest"
    echo "Copied $src -> $dest"
  else
    ln -s "$src" "$dest"
    echo "Linked $dest -> $src"
  fi
fi

# The Cmd+K search (search/cmux-search) goes into ~/.config/cmux/bin, where the
# action in cmux.json.example runs it from. It's linked or copied like the
# sidebar.
search_src="$repo/search/cmux-search"
search_dest="$HOME/.config/cmux/bin/cmux-search"
mkdir -p "$(dirname "$search_dest")"
if [[ -L "$search_dest" && "$(readlink "$search_dest")" == "$search_src" && "$mode" == "link" ]]; then
  echo "Already linked: $search_dest -> $search_src"
else
  if [[ -e "$search_dest" || -L "$search_dest" ]]; then
    mv "$search_dest" "$search_dest.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  if [[ "$mode" == "copy" ]]; then cp "$search_src" "$search_dest"; else ln -s "$search_src" "$search_dest"; fi
  echo "Installed $search_dest"
fi
command -v fzf >/dev/null 2>&1 || echo "The Cmd+K search needs fzf: brew install fzf"

if command -v cmux >/dev/null 2>&1; then
  cmux sidebar validate sessions
  cmux sidebar reload sessions || true
  echo
  echo "To switch to it: right-click the sidebar toggle button -> \"sessions\""
  echo "             or: cmux sidebar select sessions"
  echo "Custom sidebars are a beta feature; if it isn't listed, enable custom sidebars in cmux Settings."
else
  echo "cmux CLI not found on PATH; open cmux and pick \"sessions\" from the sidebar toggle's right-click menu."
fi
echo
echo "Optional settings (minimal mode, Cmd+K switcher, etc.): see cmux.json.example"
