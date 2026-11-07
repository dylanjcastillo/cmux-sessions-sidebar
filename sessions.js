// Sessions: a Codex / Claude-desktop style sidebar for cmux.
//
//   Projects  = workspaces (collapsible headers)
//   Sessions  = tabs inside each workspace (agent status, last prompt, age)
//   Search    = live filter over project names, folders, branches, tab titles, prompts
//   Filters   = All / Active (agent working or waiting) / Unread
//   Groups    = divider sections; each is a native cmux workspace group, so it
//               persists across restarts (right-click a project -> Move to Group)
//   Archive   = moves a workspace into a native cmux group named "Archive"
//               (persists across restarts; restore from the Archived section)
//
// Open:     right-click the sidebar toggle button -> "sessions"
//           or: cmux sidebar select sessions
// Preview:  cmux sidebar open sessions   (as a pane, hot-reloads on save)

const ARCHIVE_GROUP = "Archive";

// --- state --------------------------------------------------------------------
const [query, setQuery] = signal("");
const [searchGen, setSearchGen] = signal(0); // bump to remount (clear) the field
const [filter, setFilter] = signal("all"); // all | active | unread
const [archiveOpen, setArchiveOpen] = signal(false);
const [renamingTab, setRenamingTab] = signal(null); // tab id with an open rename field
const [renamingGroup, setRenamingGroup] = signal(null); // group id with an open rename field
const [renamingProject, setRenamingProject] = signal(null); // workspace id with an open rename field
const [newGroupFor, setNewGroupFor] = signal(null); // project id with an open "new group" field

// Per-project collapse (session-local; defaults to expanded).
const collapsed = new Map();
const [collapseTick, setCollapseTick] = signal(0);
function isCollapsed(id) {
  collapseTick();
  return collapsed.get(id) === true;
}
function toggleCollapsed(id) {
  collapsed.set(id, !isCollapsed(id));
  setCollapseTick(collapseTick() + 1);
}

// Optimistic focus: highlight the clicked session immediately; the ~1s data
// refresh reconciles and the override clears itself once the host agrees.
let focusOverride = null; // { wsId, tabId }
const [focusTick, setFocusTick] = signal(0);

// --- data helpers ---------------------------------------------------------------
const allWorkspaces = () => data.workspaces() ?? [];
const wsById = (id) => allWorkspaces().find((w) => w.id === id);
const archiveGroup = () => (data.groups() ?? []).find((g) => g.name === ARCHIVE_GROUP);
const isArchived = (w) => {
  const g = archiveGroup();
  return !!(g && w && w.group === g.id);
};

function baseName(path) {
  if (!path) return "";
  const parts = String(path).split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : path;
}

// Strip Claude Code's spinner / sparkle glyphs from tab titles ("✳ Fix bug").
function cleanTitle(t) {
  const s = String(t ?? "").replace(/^[✳✱✻✽✶·*⠀-⣿\s]+/, "");
  // Raw shell titles ("user@host:~/path") read as noise; the project header
  // already names the folder.
  if (!s || /^[^\s@]+@[^\s:]+:/.test(s)) return "Terminal";
  return s;
}

function subtitleFor(w, t) {
  if (!t) return "";
  const a = agentFor(w, t);
  if (a && a.status === "needs_input") return "Needs your input";
  return t.latestPrompt ?? "";
}

function agentFor(w, t) {
  return (w?.agents ?? []).find((a) => a.panelId === t?.id) ?? null;
}

// working  - agent is thinking / running tools
// waiting  - agent needs input, or finished with output you haven't seen
// inactive - agent session you've already caught up on
// shell    - plain terminal, no agent
function tabState(w, t) {
  const a = agentFor(w, t);
  const raw = String(t?.title ?? "");
  // Claude Code prefixes its title with ✳ whenever it is idle. The hook-based
  // status can stay "working" after an interrupted turn (Esc / mid-turn
  // message skips the Stop hook), so the idle glyph wins over it.
  const idleGlyph = /^[✳✱✻✽✶]/.test(raw);
  if (a) {
    if (a.status === "working" && !idleGlyph) return "working";
    if (a.status === "needs_input") return "waiting";
    if (t?.hasUnread) return "waiting";
    return "inactive";
  }
  // No agent record: fall back to Claude Code's title glyphs
  // (braille spinner while working, ✳ when idle).
  if (/^[⠀-⣿]/.test(raw)) return "working";
  if (t?.hasUnread) return "waiting";
  if (/^[✳✱✻✽✶]/.test(raw)) return "inactive";
  return "shell";
}

const STATE_ICON = {
  working: "circle.dotted",
  waiting: "circle.fill", // filled dot: needs your input / unread output
  inactive: "moon.zzz",
  shell: "terminal",
};

const STATE_COLOR = {
  working: "#4C8DFF",
  waiting: "#4C8DFF",
  inactive: "tertiary",
  shell: "tertiary",
};

function toSeconds(e) {
  if (!e) return 0;
  return e > 1e11 ? e / 1000 : e;
}

function ago(epoch) {
  const then = toSeconds(epoch);
  if (!then) return "";
  const now = toSeconds(data.clock()?.epoch) || then;
  const s = Math.max(0, now - then);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d";
  return Math.floor(s / (86400 * 30)) + "mo";
}

function tabTime(w, t) {
  const a = agentFor(w, t);
  return t?.latestAt || a?.lastActivityAt || 0;
}

function lower(s) {
  return String(s ?? "").toLowerCase();
}

function projectHaystack(w) {
  return lower([w.title, w.directory, w.branch, w.description].join(" "));
}

function tabHaystack(w, t) {
  const a = agentFor(w, t);
  return lower([t.title, t.latestPrompt, t.directory, t.branch, a?.title, a?.name].join(" "));
}

function passesFilter(w, t) {
  const f = filter();
  if (f === "all") return true;
  const st = tabState(w, t);
  if (f === "active") return st === "working" || st === "waiting";
  if (f === "unread") return !!t.hasUnread;
  return true;
}

function isFocused(w, t) {
  focusTick();
  if (!w || !t) return false;
  if (focusOverride) {
    const caughtUp = data.selectedId() === focusOverride.wsId &&
      ((wsById(focusOverride.wsId)?.tabs ?? []).find((x) => x.id === focusOverride.tabId)?.focused);
    if (caughtUp) focusOverride = null;
    else return w.id === focusOverride.wsId && t.id === focusOverride.tabId;
  }
  return !!(w.selected && t.focused);
}

// --- actions ----------------------------------------------------------------------
function openSession(w, t) {
  if (!w || !t) return;
  focusOverride = { wsId: w.id, tabId: t.id };
  setFocusTick(focusTick() + 1);
  if (t.surfaceId) {
    cmux("surface.focus", { surface_id: t.surfaceId, workspace_id: w.id });
  } else {
    cmux("workspace.select", { workspace_id: w.id });
  }
}

function selectProject(w) {
  if (w) cmux("workspace.select", { workspace_id: w.id });
}

function newSession(w) {
  if (!w) return;
  cmux("workspace.select", { workspace_id: w.id });
  cmux("surface.create", { workspace_id: w.id });
}

// --- groups -------------------------------------------------------------------
// Divider groups (and the Archive) are native cmux workspace groups, so they
// persist across restarts. Every cmux group is owned by an "anchor" workspace
// that is also a member, and cmux treats the anchor as the group's *header*:
// the anchor never gets a Cmd+1..9 number. So each group keeps a placeholder
// anchor workspace that this sidebar hides (marked by GROUP_HEADER_MARK in its
// description), and real projects are plain members that keep their numbers.
//
// Creating a group: the sidebar bridge sends every param as a string and
// workspace.group.create only accepts an *array* of child ids, so we
// (1) create an empty group, for which cmux generates the placeholder anchor,
// then (2) mark the placeholder and add the project. The watcher below runs
// step 2 once the data shows the new group.
//
// Removing a group's anchor dissolves the whole group, so removeFromGroup
// hands the anchor to another member first (only matters for groups made
// outside this sidebar, where a real project is the anchor).
const GROUP_HEADER_MARK = "cmux-sessions-sidebar:group-header";
const isGroupHeader = (w) => !!(w && w.description === GROUP_HEADER_MARK && w.group &&
  groupById(w.group)?.anchorId === w.id);
const realMembers = (groupId) => allWorkspaces().filter((w) => w.group === groupId && !isGroupHeader(w));

const userGroups = () => {
  const gs = (data.groups() ?? []).filter((g) => g.name !== ARCHIVE_GROUP);
  return [...gs.filter((g) => g.pinned), ...gs.filter((g) => !g.pinned)];
};
const groupById = (id) => (id ? (data.groups() ?? []).find((g) => g.id === id) : undefined);

// Workspaces in cmux's own order (the order Cmd+1..9 follows).
const cmuxOrder = () => [...allWorkspaces()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

// Cmd+1..9 as cmux assigns them: rows in cmux order, skipping group anchors
// and members of collapsed groups; Cmd+9 is always the last row.
const shortcutById = computed(() => {
  const ids = [];
  for (const w of cmuxOrder()) {
    const g = groupById(w.group);
    if (g && (g.anchorId === w.id || g.collapsed)) continue;
    ids.push(w.id);
  }
  const map = {};
  ids.forEach((id, i) => {
    if (i < 8) map[id] = i + 1;
    else if (i === ids.length - 1) map[id] = 9;
  });
  return map;
});

const GROUP_CREATE_TIMEOUT_SECONDS = 15;
let pendingGroup = null; // { name, wsId, knownGroupIds, knownWsIds, selectedId, at, stage, groupId?, anchorId? }

function isPendingPlaceholder(w) {
  const p = pendingGroup;
  return !!(p && w && w.id !== p.wsId && !p.knownWsIds.has(w.id));
}

function createGroupWith(name, w) {
  if (!w || !name || pendingGroup) return;
  pendingGroup = {
    name,
    wsId: w.id,
    knownGroupIds: new Set((data.groups() ?? []).map((g) => g.id)),
    knownWsIds: new Set(allWorkspaces().map((x) => x.id)),
    selectedId: data.selectedId(),
    at: nowSeconds(),
    stage: "create",
  };
  if (w.group) removeFromGroup(w);
  cmux("workspace.group.create", { name });
}

computed(() => {
  const groups = data.groups() ?? [];
  const wss = allWorkspaces();
  const now = nowSeconds();
  const p = pendingGroup;
  if (!p) return;
  if (now - p.at > GROUP_CREATE_TIMEOUT_SECONDS) {
    pendingGroup = null; // something failed; never act on stale state
    return;
  }
  if (p.stage === "create") {
    const g = groups.find((x) => !p.knownGroupIds.has(x.id) && x.name === p.name);
    if (!g) return;
    p.groupId = g.id;
    p.stage = "add";
    // Only ever mark the placeholder cmux just generated: it must be a
    // workspace that didn't exist before we started.
    if (g.anchorId && g.anchorId !== p.wsId && !p.knownWsIds.has(g.anchorId)) {
      cmux("workspace.action", { action: "set_description", workspace_id: g.anchorId, description: GROUP_HEADER_MARK });
    }
    cmux("workspace.group.add", { group_id: g.id, workspace_id: p.wsId });
    // Archived projects live in a collapsed group so they don't take Cmd+N.
    if (g.name === ARCHIVE_GROUP && !g.collapsed) cmux("workspace.group.collapse", { group_id: g.id });
    return;
  }
  if (p.stage === "add") {
    const w = wss.find((x) => x.id === p.wsId);
    if (!w || w.group !== p.groupId) return;
    pendingGroup = null;
    // cmux focuses the new group's anchor; go back to where the user was.
    if (p.selectedId) cmux("workspace.select", { workspace_id: p.selectedId });
  }
});

// Order sync: keep ungrouped workspaces ahead of grouped ones in cmux's own
// order (cmux puts new groups at the top), so cmux's ⌘1-9 numbering matches
// the sidebar's ungrouped-first layout. One reorder per data update: move the
// first ungrouped workspace that sits after a grouped one up to just below
// the ungrouped block. Gives up after ORDER_SYNC_MAX_MOVES moves without
// converging, so it can never loop against cmux's own ordering rules.
const ORDER_SYNC_MAX_MOVES = 30;
let orderSync = { moves: 0, last: null }; // last = { id, index, at }
computed(() => {
  const order = cmuxOrder();
  const now = nowSeconds();
  if (pendingGroup) return; // let group creation settle first
  let ungroupedSeen = 0;
  let groupedSeen = false;
  let misplaced = null;
  for (const w of order) {
    const grouped = !!groupById(w.group);
    if (grouped) {
      groupedSeen = true;
      continue;
    }
    if (groupedSeen) {
      misplaced = { id: w.id, index: ungroupedSeen };
      break;
    }
    ungroupedSeen++;
  }
  if (!misplaced) {
    orderSync = { moves: 0, last: null };
    return;
  }
  if (orderSync.moves >= ORDER_SYNC_MAX_MOVES) return;
  const last = orderSync.last;
  // Same request still in flight: wait for cmux's data to catch up.
  if (last && last.id === misplaced.id && last.index === misplaced.index && now - last.at < 2) return;
  orderSync.moves++;
  orderSync.last = { ...misplaced, at: now };
  cmux("workspace.reorder", { workspace_id: misplaced.id, index: misplaced.index });
});

function removeFromGroup(w) {
  if (!w || !w.group) return;
  const g = groupById(w.group);
  if (g && g.anchorId === w.id) {
    const other = allWorkspaces().find((x) => x.group === g.id && x.id !== w.id);
    if (!other) {
      // Last member: dissolving the group keeps the workspace open.
      cmux("workspace.group.ungroup", { group_id: g.id });
      return;
    }
    cmux("workspace.group.set_anchor", { group_id: g.id, workspace_id: other.id });
  }
  cmux("workspace.group.remove", { workspace_id: w.id });
}

function moveToGroup(w, g) {
  if (!w || !g || w.group === g.id) return;
  if (w.group) removeFromGroup(w);
  cmux("workspace.group.add", { group_id: g.id, workspace_id: w.id });
}

// Dissolve a group: its projects move back to the top level and its hidden
// placeholder header is closed. (The bridge can't send the boolean
// remove_generated_anchor, so the placeholder is closed explicitly.)
function ungroupGroup(groupId) {
  const g = groupById(groupId);
  if (!g) return;
  const header = allWorkspaces().find((w) => w.id === g.anchorId && isGroupHeader(w));
  cmux("workspace.group.ungroup", { group_id: g.id });
  if (header) cmux("workspace.close", { workspace_id: header.id, force: true });
}

function finishProjectRename(w, text) {
  setRenamingProject(null);
  if (!w) return;
  const name = String(text ?? "").trim();
  if (name.length === 0) {
    cmux("workspace.action", { action: "clear_name", workspace_id: w.id });
  } else if (name !== projectTitle(w)) {
    cmux("workspace.action", { action: "rename", workspace_id: w.id, title: name });
  }
}

function toggleGroupCollapsed(g) {
  if (!g) return;
  cmux(g.collapsed ? "workspace.group.expand" : "workspace.group.collapse", { group_id: g.id });
}

function finishGroupRename(groupId, text) {
  setRenamingGroup(null);
  const name = String(text ?? "").trim();
  const g = groupById(groupId);
  if (g && name && name !== g.name) cmux("workspace.group.rename", { group_id: g.id, name });
}

function archive(w) {
  if (!w) return;
  const g = archiveGroup();
  if (g) {
    moveToGroup(w, g);
    if (!g.collapsed) cmux("workspace.group.collapse", { group_id: g.id });
  } else {
    createGroupWith(ARCHIVE_GROUP, w);
  }
}

function unarchive(w) {
  removeFromGroup(w);
}

// cmux refuses workspace.close while any tab has a running process (every
// Claude/shell tab) unless `force: true`, and a sidebar can't show a confirm
// dialog. So the ✕ button is two-step: first click arms it (turns red),
// a second click within CLOSE_ARM_SECONDS force-closes the project.
const CLOSE_ARM_SECONDS = 4;
let closeArmed = null; // { wsId, at }
const [closeTick, setCloseTick] = signal(0);
function nowSeconds() {
  return toSeconds(data.clock()?.epoch) || 0;
}
function isCloseArmed(id) {
  closeTick();
  return !!(closeArmed && closeArmed.wsId === id &&
    nowSeconds() - closeArmed.at < CLOSE_ARM_SECONDS);
}
function forceCloseProject(w) {
  if (w) cmux("workspace.close", { workspace_id: w.id, force: true });
}
function closeButtonTap(w) {
  if (!w) return;
  if (isCloseArmed(w.id)) {
    closeArmed = null;
    forceCloseProject(w);
  } else {
    closeArmed = { wsId: w.id, at: nowSeconds() };
  }
  setCloseTick(closeTick() + 1);
}

function firstMatch() {
  const e = entries().find((x) => x.kind === "tab");
  if (!e) return;
  const w = wsById(e.wsId);
  openSession(w, (w?.tabs ?? []).find((t) => t.id === e.tabId));
}

// --- flat entry list ----------------------------------------------------------------
const entries = computed(() => {
  const q = lower(query()).trim();
  const f = filter();
  const narrowing = q.length > 0 || f !== "all";
  const ws = allWorkspaces();
  const groups = userGroups();
  const out = [];

  // Project rows embed the group list and the project's own group in their
  // key, so the right-click "Move to Group" menu is rebuilt when they change.
  const groupsSig = groups.map((g) => g.id + "=" + g.name).join("|");

  function pushProject(w, list) {
    const tabs = w.tabs ?? [];
    const projectHit = q.length > 0 && projectHaystack(w).includes(q);
    const shown = tabs.filter((t) =>
      passesFilter(w, t) && (q.length === 0 || projectHit || tabHaystack(w, t).includes(q)));
    if (narrowing && shown.length === 0 && !(projectHit && f === "all")) return;
    const editing = renamingProject() === w.id;
    list.push({
      kind: "project",
      id: "p:" + w.id + ":" + (w.group ?? "") + ":" + groupsSig + (editing ? ":edit" : ""),
      wsId: w.id,
      editing,
    });
    if (newGroupFor() === w.id) list.push({ kind: "newGroup", id: "ng:" + w.id, wsId: w.id });
    if (narrowing || !isCollapsed(w.id)) {
      for (const t of shown) {
        // Title-only rows (the last prompt is still searchable).
        // A tab being renamed gets its own key so the row remounts with the
        // text field in place of the title.
        const editing = renamingTab() === t.id;
        list.push({ kind: "tab", id: "t:" + t.id + (editing ? ":edit" : ""), wsId: w.id, tabId: t.id, sub: false, editing });
      }
    }
  }

  // Ungrouped projects first, then one divider section per group, each in
  // cmux's own order. orderSync (below) moves ungrouped workspaces ahead of
  // grouped ones in cmux too, so the ⌘1-9 hints still read top to bottom.
  const ungrouped = [];
  const runs = []; // { groupId, projects: [] } in order of first appearance
  for (const w of cmuxOrder()) {
    if (isArchived(w) || isPendingPlaceholder(w)) continue;
    const g = groupById(w.group);
    if (!g || g.name === ARCHIVE_GROUP) {
      ungrouped.push(w);
      continue;
    }
    let run = runs.find((r) => r.groupId === g.id);
    if (!run) {
      run = { groupId: g.id, projects: [] };
      runs.push(run);
    }
    if (!isGroupHeader(w)) run.projects.push(w);
  }

  for (const w of ungrouped) pushProject(w, out);

  for (const run of runs) {
    const section = [];
    for (const w of run.projects) pushProject(w, section);
    const g = groupById(run.groupId);
    const nameHit = q.length > 0 && lower(g.name).includes(q);
    if (narrowing && section.length === 0 && !nameHit) continue;
    const editing = renamingGroup() === g.id;
    out.push({ kind: "group", id: "g:" + g.id + (editing ? ":edit" : ""), groupId: g.id, editing });
    if (narrowing || !g.collapsed) out.push(...section);
  }

  if (narrowing && out.length === 0) out.push({ kind: "empty", id: "empty" });

  const archived = ws.filter((w) => isArchived(w) && !isGroupHeader(w));
  const archivedShown = q.length > 0
    ? archived.filter((w) => projectHaystack(w).includes(q))
    : archived;
  if (archivedShown.length > 0) {
    out.push({ kind: "archHeader", id: "archHeader" });
    if (archiveOpen() || q.length > 0) {
      for (const w of archivedShown) out.push({ kind: "arch", id: "a:" + w.id, wsId: w.id });
    }
  }
  return out;
});

// --- views ----------------------------------------------------------------------------
function chip(label, value) {
  const on = () => filter() === value;
  return Text(label)
    .font(11)
    .weight(() => (on() ? "semibold" : "regular"))
    .color(() => (on() ? "primary" : "secondary"))
    .paddingHorizontal(8)
    .paddingVertical(3)
    .cornerRadius(6)
    .background(() => (on() ? "#7f7f7f33" : null))
    .hoverBackground(() => (on() ? "#7f7f7f33" : "#7f7f7f1c"))
    .cursor("pointer")
    .onTap(() => setFilter(value));
}

function searchField() {
  return HStack({ spacing: 6 }, [
    Image("magnifyingglass").font(11).color("tertiary"),
    TextField("", {
      placeholder: "Search sessions",
      autofocus: false,
      onEdit: (t) => setQuery(t ?? ""),
      onSubmit: () => firstMatch(),
      onCancel: () => {
        setQuery("");
        setSearchGen(searchGen() + 1);
      },
    }).font(12),
    Image("xmark.circle.fill")
      .font(11)
      .color("tertiary")
      .opacity(() => (query().length > 0 ? 1 : 0))
      .cursor("pointer")
      .onTap(() => {
        setQuery("");
        setSearchGen(searchGen() + 1);
      }),
  ])
    .paddingHorizontal(8)
    .paddingVertical(5)
    .cornerRadius(8)
    .background("#7f7f7f1f")
    .frame({ maxWidth: "infinity" });
}

function header() {
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 6 }, [
      Text("Sessions").font(13).weight("semibold"),
      Text(() => {
        const n = data.unreadTotal() ?? 0;
        return n > 0 ? String(n) : "";
      })
        .font("caption2").bold().color("white")
        .paddingHorizontal(() => ((data.unreadTotal() ?? 0) > 0 ? 5 : 0))
        .paddingVertical(() => ((data.unreadTotal() ?? 0) > 0 ? 1 : 0))
        .background(() => ((data.unreadTotal() ?? 0) > 0 ? "#E4573D" : null))
        .cornerRadius(7),
      Spacer(),
      Image("bell.badge")
        .font(11).color("secondary")
        .padding(4).cornerRadius(6)
        .hoverBackground("#7f7f7f2a")
        .cursor("pointer")
        .onTap(() => cmux("notification.jump_to_unread", {})),
      Image("plus")
        .font(12).weight("semibold").color("secondary")
        .padding(4).cornerRadius(6)
        .hoverBackground("#7f7f7f2a")
        .cursor("pointer")
        .onTap(() => cmux("workspace.create", {})),
    ]).paddingHorizontal(4),
    ForEach(
      { items: () => [{ id: "search:" + searchGen() }], key: (x) => x.id },
      () => searchField()
    ),
    HStack({ spacing: 4 }, [
      chip("All", "all"),
      chip("Active", "active"),
      chip("Unread", "unread"),
      Spacer(),
    ]),
  ]).paddingBottom(4);
}

function projectMenu(w) {
  return [
    Button("Open Project", () => selectProject(w())),
    Button("Rename Project…", () => setRenamingProject(w()?.id ?? null)),
    Button("New Session", () => newSession(w())),
    Button(() => (isCollapsed(w()?.id) ? "Expand" : "Collapse"), () => toggleCollapsed(w().id)),
    Divider(),
    Button(() => (w()?.pinned ? "Unpin Project" : "Pin Project"), () =>
      cmux("workspace.action", { action: w()?.pinned ? "unpin" : "pin", workspace_id: w().id })),
    Button(() => (w()?.unread > 0 ? "Mark as Read" : "Mark as Unread"), () =>
      cmux("workspace.action", { action: w()?.unread > 0 ? "mark_read" : "mark_unread", workspace_id: w().id })),
    Button("Copy Path", () => clipboard.write(w()?.directory ?? "")),
    Divider(),
    // Built when the row mounts; the row's key includes the group list, so
    // it remounts (and rebuilds this menu) whenever groups change.
    Menu("Move to Group", [
      ...userGroups()
        .filter((g) => g.id !== w()?.group)
        .map((g) => Button(g.name, () => moveToGroup(w(), groupById(g.id)))),
      ...(userGroups().some((g) => g.id !== w()?.group) ? [Divider()] : []),
      Button("New Group…", () => setNewGroupFor(w()?.id ?? null)),
    ]),
    ...(groupById(w()?.group) && !isArchived(w())
      ? [Button("Remove from Group", () => removeFromGroup(w()))]
      : []),
    Button("Archive Project", () => archive(w())),
    Button("Close Project", () => forceCloseProject(w())).destructive(),
  ];
}

function projectTitle(w) {
  const t = String(w?.title ?? "");
  // Workspaces that never got a name show the shell title ("user@host:path").
  if (!t || /^[^\s@]+@[^\s:]+:/.test(t)) return baseName(w?.directory) || "Untitled";
  return t;
}

function projectRow(wsId, editing) {
  const w = () => wsById(wsId);
  const active = () => !!w()?.selected;
  // Rename: Enter saves, Esc cancels, an empty name restores the automatic
  // (folder-based) name.
  const titleView = editing
    ? TextField(projectTitle(w()), {
        placeholder: "Project name (empty = automatic)",
        onSubmit: (text) => finishProjectRename(w(), text),
        onCancel: () => setRenamingProject(null),
      }).font(12)
    : Text(() => projectTitle(w()))
      .font(12)
      .weight(() => (active() ? "bold" : "medium"))
      .lineLimit(1).truncation("tail")
      .color(() => (active() ? "primary" : "secondary"));
  // One HStack, no overlay: the trailing cluster reserves its own width, so
  // the title truncates before it instead of running underneath it.
  // The gap above each project sits on an outer wrapper so the hover
  // highlight is evenly padded around the row instead of tall on top.
  // The open project gets a filled, accent-colored folder, a bolder title
  // and a persistent tint.
  return VStack({ spacing: 0 }, [HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(9).weight("semibold").color("tertiary")
      .rotation(() => (isCollapsed(wsId) && query().length === 0 ? 0 : 90))
      .frame({ width: 12, height: 16 }),
    Image(() => (w()?.pinned ? "pin.fill" : active() ? "folder.fill" : "folder"))
      .font(11)
      .color(() => w()?.color ?? (active() ? "#4C8DFF" : "tertiary")),
    titleView,
    Spacer({ minLength: 4 }),
    ZStack({ alignment: "trailing" }, [
      // ⌘N shortcut hint, numbered exactly as cmux assigns ⌘1–9.
      // Yields to the unread badge, and to the action buttons on hover.
      Text(() => {
        const ww = w();
        const n = ww ? shortcutById()[ww.id] : undefined;
        if (!ww || ww.unread > 0 || !n) return "";
        return "⌘" + n;
      })
        .font(9).monospaced().color("tertiary")
        .opacity(0.45)
        .hideOnHover(),
      Text(() => (w()?.unread > 0 ? String(w().unread) : ""))
        .font("caption2").bold().color("white")
        .paddingHorizontal(() => (w()?.unread > 0 ? 5 : 0))
        .paddingVertical(() => (w()?.unread > 0 ? 1 : 0))
        .background(() => (w()?.unread > 0 ? "#E4573D" : null))
        .cornerRadius(7)
        .hideOnHover(),
      HStack({ spacing: 2 }, [
        Image("plus")
          .font(10).weight("semibold").color("secondary")
          .padding(3).cornerRadius(5)
          .hoverBackground("#7f7f7f4a")
          .onTap(() => newSession(w())),
        Image("archivebox")
          .font(10).color("secondary")
          .padding(3).cornerRadius(5)
          .hoverBackground("#7f7f7f4a")
          .onTap(() => archive(w())),
        Image(() => (isCloseArmed(wsId) ? "xmark.circle.fill" : "xmark"))
          .font(10).weight("semibold")
          .color(() => (isCloseArmed(wsId) ? "#E4573D" : "secondary"))
          .padding(3).cornerRadius(5)
          .hoverBackground("#E4573D40")
          .onTap(() => closeButtonTap(w())),
      ]).showOnHover(),
    ]).fixedSize().layoutPriority(2),
  ])
    .paddingLeading(4)
    .paddingTrailing(6)
    .paddingVertical(4)
    .cornerRadius(8)
    .background(() => (active() ? "#4C8DFF0d" : null))
    .hoverBackground(() => (active() ? "#4C8DFF14" : "#7f7f7f12"))
    .frame({ maxWidth: "infinity" })
    .cursor("pointer")
    .onTap(() => {
      if (!editing) toggleCollapsed(wsId);
    })
    .onDoubleTap(() => selectProject(w()))
    .contextMenu(projectMenu(w))])
    .paddingTop(5)
    .frame({ maxWidth: "infinity" });
}

// Rename: Enter saves, Esc cancels, an empty name restores the automatic title.
function finishRename(w, t, text) {
  setRenamingTab(null);
  if (!w || !t?.surfaceId) return;
  const name = String(text ?? "").trim();
  const target = { surface_id: t.surfaceId, workspace_id: w.id };
  if (name.length === 0) {
    cmux("surface.action", { action: "clear_name", ...target });
  } else if (name !== cleanTitle(t.title)) {
    cmux("surface.action", { action: "rename", title: name, ...target });
  }
}

function tabMenu(w, t) {
  return [
    Button("Open", () => openSession(w(), t())),
    Button("Rename…", () => setRenamingTab(t()?.id ?? null)),
    Button(() => (t()?.pinned ? "Unpin Tab" : "Pin Tab"), () =>
      cmux("surface.action", { action: t()?.pinned ? "unpin" : "pin", surface_id: t()?.surfaceId, workspace_id: w()?.id })),
    Button("Copy Last Prompt", () => clipboard.write(t()?.latestPrompt ?? "")),
    Divider(),
    Button("Close Session", () =>
      cmux("surface.close", { surface_id: t()?.surfaceId, workspace_id: w()?.id })).destructive(),
  ];
}

function tabRow(wsId, tabId, hasSubtitle, editing) {
  const w = () => wsById(wsId);
  const t = () => (w()?.tabs ?? []).find((x) => x.id === tabId);
  const st = () => tabState(w(), t());
  const focused = () => isFocused(w(), t());
  // Titles wrap to at most 2 lines, then truncate with "…" (more lines looked
  // messy, e.g. long paths). No marquee: the JS renderer has no tooltips and
  // a fixed, slow marquee speed.
  const titleView = editing
    ? TextField(cleanTitle(t()?.title), {
        placeholder: "Tab name (empty = automatic)",
        onSubmit: (text) => finishRename(w(), t(), text),
        onCancel: () => setRenamingTab(null),
      }).font(13)
    : Text(() => cleanTitle(t()?.title))
      .font(13)
      .lineLimit(2).truncation("tail")
      .color(() => (focused() ? "primary" : "secondary"));
  const titleLine = HStack({ spacing: 6, alignment: "top" }, [
    titleView,
    Spacer({ minLength: 0 }),
    Text(() => ago(tabTime(w(), t())))
      .font(10).monospaced().color("tertiary")
      .fixedSize(),
  ]);
  const lines = hasSubtitle
    ? [
        titleLine,
        Text(() => subtitleFor(w(), t()))
          .font(11)
          .lineLimit(1).truncation("tail")
          .color(() => (agentFor(w(), t())?.status === "needs_input" ? "#F5A623" : "tertiary")),
      ]
    : [titleLine];
  return HStack({ spacing: 8, alignment: "top" }, [
    Image(() => STATE_ICON[st()] ?? "terminal")
      .font(() => (st() === "waiting" ? 7 : 10))
      .weight(() => (st() === "working" ? "semibold" : "regular"))
      .color(() => STATE_COLOR[st()] ?? "tertiary")
      .frame({ width: 14, height: 17 }),
    VStack({ spacing: 2, alignment: "leading" }, lines).frame({ maxWidth: "infinity" }),
  ])
    .paddingHorizontal(8)
    .paddingVertical(hasSubtitle ? 5 : 4)
    .marginLeading(14)
    .cornerRadius(8)
    .background(() => (focused() ? "#7f7f7f1a" : null))
    .hoverBackground(() => (focused() ? "#7f7f7f1f" : "#7f7f7f12"))
    .frame({ maxWidth: "infinity" })
    .cursor("pointer")
    .onTap(() => {
      if (!editing) openSession(w(), t());
    })
    .contextMenu(tabMenu(w, t));
}

// Group divider: chevron + NAME + a hairline filling the row.
// Click folds the group (persisted by cmux); right-click to rename/ungroup.
function groupRow(groupId, editing) {
  const g = () => groupById(groupId);
  const label = editing
    ? TextField(g()?.name ?? "", {
        placeholder: "Group name",
        onSubmit: (text) => finishGroupRename(groupId, text),
        onCancel: () => setRenamingGroup(null),
      }).font(11)
    : Text(() => String(g()?.name ?? "").toUpperCase())
      .font(10).weight("semibold").color("tertiary")
      .lineLimit(1).truncation("tail");
  return VStack({ spacing: 0 }, [HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(8).weight("bold").color("tertiary")
      .rotation(() => (g()?.collapsed && query().length === 0 ? 0 : 90))
      .frame({ width: 12, height: 14 }),
    label,
    Rectangle().fill("#7f7f7f40").frame({ height: 1, maxWidth: "infinity" }),
  ])
    .paddingLeading(4)
    .paddingTrailing(6)
    .paddingVertical(4)
    .cornerRadius(6)
    .hoverBackground("#7f7f7f14")
    .frame({ maxWidth: "infinity" })
    .cursor("pointer")
    .onTap(() => {
      if (!editing) toggleGroupCollapsed(g());
    })
    .contextMenu([
      Button("Rename Group…", () => setRenamingGroup(groupId)),
      Button(() => (g()?.collapsed ? "Expand" : "Collapse"), () => toggleGroupCollapsed(g())),
      Divider(),
      // Dissolves the divider only; its projects stay open, ungrouped.
      Button("Ungroup", () => ungroupGroup(groupId)),
    ])])
    .paddingTop(10)
    .frame({ maxWidth: "infinity" });
}


// Inline name field shown under a project after "Move to Group > New Group…".
function newGroupRow(wsId) {
  return HStack({ spacing: 6 }, [
    Image("folder.badge.plus").font(11).color("secondary"),
    TextField("", {
      placeholder: "New group name",
      onSubmit: (text) => {
        const name = String(text ?? "").trim();
        setNewGroupFor(null);
        if (name) createGroupWith(name, wsById(wsId));
      },
      onCancel: () => setNewGroupFor(null),
    }).font(12),
  ])
    .paddingHorizontal(8)
    .paddingVertical(5)
    .marginLeading(14)
    .cornerRadius(8)
    .background("#7f7f7f1f")
    .frame({ maxWidth: "infinity" });
}

function archiveHeader() {
  const count = () => allWorkspaces().filter((w) => isArchived(w) && !isGroupHeader(w)).length;
  return HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(9).weight("semibold").color("tertiary")
      .rotation(() => (archiveOpen() || query().length > 0 ? 90 : 0))
      .frame({ width: 12, height: 16 }),
    Image("archivebox").font(11).color("tertiary"),
    Text(() => "Archived · " + count()).font(11).weight("semibold").color("tertiary"),
    Spacer(),
  ])
    .paddingLeading(4)
    .paddingVertical(5)
    .paddingTop(10)
    .cornerRadius(8)
    .hoverBackground("#7f7f7f12")
    .frame({ maxWidth: "infinity" })
    .cursor("pointer")
    .onTap(() => setArchiveOpen(!archiveOpen()));
}

function archivedRow(wsId) {
  const w = () => wsById(wsId);
  return ZStack({ alignment: "trailing" }, [
    HStack({ spacing: 6 }, [
      Image("folder").font(11).color("tertiary"),
      Text(() => projectTitle(w())).font(12).color("tertiary").lineLimit(1).truncation("tail"),
      Text(() => String((w()?.tabs ?? []).length)).font(10).color("tertiary"),
      Spacer({ minLength: 0 }),
    ]).frame({ maxWidth: "infinity" }),
    Image("arrow.uturn.backward")
      .font(10).color("secondary")
      .padding(3).cornerRadius(5)
      .hoverBackground("#7f7f7f4a")
      .showOnHover()
      .onTap(() => unarchive(w())),
  ])
    .paddingHorizontal(8)
    .paddingVertical(4)
    .marginLeading(14)
    .cornerRadius(8)
    .hoverBackground("#7f7f7f12")
    .frame({ maxWidth: "infinity" })
    .cursor("pointer")
    .onTap(() => selectProject(w()))
    .contextMenu([
      Button("Open", () => selectProject(w())),
      Button("Restore", () => unarchive(w())),
      Divider(),
      Button("Close Project", () => forceCloseProject(w())).destructive(),
    ]);
}

function emptyRow() {
  return Text(() => (query().length > 0 ? "No sessions match “" + query() + "”" : "Nothing here"))
    .font(12).color("tertiary")
    .padding(10)
    .frame({ maxWidth: "infinity" });
}

// --- root ---------------------------------------------------------------------------------
sidebar(() =>
  VStack({ spacing: 2 }, [
    header(),
    ForEach(
      { items: entries, key: (e) => e.id },
      (e) => {
        const entry = e(); // kind and ids are stable per key
        if (entry.kind === "project") return projectRow(entry.wsId, entry.editing);
        if (entry.kind === "tab") return tabRow(entry.wsId, entry.tabId, entry.sub, entry.editing);
        if (entry.kind === "group") return groupRow(entry.groupId, entry.editing);
        if (entry.kind === "newGroup") return newGroupRow(entry.wsId);
        if (entry.kind === "archHeader") return archiveHeader();
        if (entry.kind === "arch") return archivedRow(entry.wsId);
        return emptyRow();
      }
    ),
    Spacer(),
  ]).padding(8),
  { surface: "glass" }
);
