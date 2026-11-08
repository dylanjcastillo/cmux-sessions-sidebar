# Agent guide

This repo is a custom sidebar for [cmux](https://cmux.com) that lists projects (cmux workspaces) and their sessions (tabs). `README.md` says what it does and how to install it. Read it first.

## Where to look

- The sidebar: `sessions.js`. It runs in cmux's sidebar runtime, not in a browser or in Node. The runtime is `SidebarRuntime.js` inside the cmux app bundle (the path is in `README.md`). Read it before using a runtime feature you haven't seen in `sessions.js`.
- The Cmd+K search: `search/cmux-search`, a Python script that lists projects and tabs in fzf.
- The installer: `install.sh`. It links or copies `sessions.js` and `search/cmux-search` into `~/.config/cmux`.
- Suggested cmux settings: `cmux.json.example`.
- The smoke test: `test/smoke.js`. It runs `sessions.js` in the real runtime against a fake cmux.
- Demo data for screenshots: `demo/`. `demo/demo.sh` switches the sidebar to made-up projects, and `demo/demo.sh --off` switches it back.

## How cmux shapes the code

These cmux limits explain code that looks odd. The comments in `sessions.js` have the details.

- **Every group keeps a hidden header workspace.** cmux treats one workspace in each group, the anchor, as the group's header and never gives it a ⌘ shortcut. The sidebar keeps the placeholder anchor cmux creates, marks it with the description `cmux-sessions-sidebar:group-header` and hides it.
- **Every `cmux()` param arrives as a string.** Methods that need an array, such as `workspace.group.create` with child workspaces or `workspace.reorder_many`, can't be used. The sidebar creates an empty group first, then adds the project, and moves projects one at a time with `workspace.reorder`.
- **Removing a group's anchor deletes the group.** Before removing a project that is the anchor, the sidebar makes another member the anchor.
- **Archived is a folded group called `Archive`.** cmux gives no ⌘ shortcut to projects in a folded group.
- **A sidebar can't show dialogs or tooltips.** That is why ✕ takes two clicks and long titles wrap.

## Rules

1. **Run the smoke test after changing `sessions.js`.** The command is in `README.md`. To check a change in cmux itself, run `cmux sidebar reload sessions`; the install links the file, so cmux shows the repo's copy.
2. **Keep screenshots free of real data.** Take them with `demo/demo.sh` in a new cmux window, and open the image to check it before you commit. Never capture a window that shows real projects, terminal output, names or email addresses.
3. **Keep `README.md` in plain English.** Short sentences, sentence case headings, no em dashes. Update it when you change what the sidebar does or how to install it.
4. **Don't push without asking.** Commit when asked. Push only when Dylan says so.
