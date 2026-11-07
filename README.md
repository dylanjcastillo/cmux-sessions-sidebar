# cmux Sessions sidebar

A custom sidebar for [cmux](https://cmux.com) that lists projects (workspaces) and their sessions (tabs), styled like the Codex / Claude desktop session lists.

- **Projects** are collapsible. The open project has a filled blue folder, a bold title and a tint. Hover a project for **+** (new session), **archive**, and **✕** (close).
- **Sessions** show the agent's state (working, waiting for you, idle, plain shell) and how long ago they were last active. Titles wrap to at most two lines.
- **Groups** are divider sections for projects. To add a project to one, right-click it and choose **Move to Group**, then pick a group or **New Group…**. Click a divider to fold it. Right-click a divider to rename the group or ungroup it (ungrouping keeps the projects).
- **Archive** hides a project in a collapsed "Archived" section. Restore it from there.
- **Search and filters**: the search box and the All / Active / Unread chips filter across projects, groups and tab titles.
- **Rename a tab**: right-click it and choose **Rename…**. Enter saves, Esc cancels, and an empty name restores the automatic title.

## Install

Requires cmux with custom sidebars (beta; tested on cmux 0.65.2).

```sh
git clone https://github.com/dylanjcastillo/cmux-sessions-sidebar.git
cd cmux-sessions-sidebar
./install.sh          # symlinks sessions.js into ~/.config/cmux/sidebars
# ./install.sh --copy # copy instead of symlinking
```

Then right-click the sidebar toggle button and choose **sessions**, or run `cmux sidebar select sessions`.

With the symlink install, edits to `sessions.js` in this repo go live. cmux hot-reloads the file on save, and `cmux sidebar reload sessions` forces a reload.

`cmux.json.example` has optional settings that pair well with the sidebar: minimal mode (hides the title bar above the tabs), the Cmd+K switcher, and opening links in your default browser.

## How a few things work

These are cmux limitations that shaped the code. The comments in `sessions.js` have the details.

- **Every `cmux()` param becomes a string** in the sidebar bridge. `workspace.group.create` only accepts an array of child workspaces, so the sidebar creates a group in three steps:
  1. Create an empty group. cmux generates a placeholder "anchor" workspace for it.
  2. Add the project to the group.
  3. Close the placeholder. cmux then makes the project the group's anchor.
- **Removing a group's anchor dissolves the group.** To remove just the anchor project, the sidebar first makes another member the anchor.
- **Closing a project needs `force`**: cmux refuses to close a workspace with a running process, and a sidebar can't show a confirmation dialog. So the ✕ button takes two clicks: the first turns it red, and a second click within 4 seconds closes the project. The project's right-click **Close Project** closes it in one step.
- **No tooltips** in the JS renderer, so long titles wrap instead.

## Smoke test

`test/smoke.js` runs the real cmux sidebar runtime in Node, with a fake host that applies the group and workspace actions the way the cmux socket API does. It runs the group create, move, remove, collapse, rename and archive flows, and checks that every param is a string.

```sh
node test/smoke.js \
  /Applications/cmux.app/Contents/Resources/CmuxSwiftRenderUI_CmuxSwiftRenderUI.bundle/Contents/Resources/SidebarRuntime.js \
  sessions.js
```
