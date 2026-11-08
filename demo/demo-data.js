// Demo data for screenshots. demo/demo.sh puts this file in front of
// sessions.js, so these two bindings shadow the runtime's `data` and `cmux`
// globals:
//   - `data` serves made-up projects and sessions instead of your real
//     workspaces, so nothing from your machine shows up in the sidebar.
//   - `cmux` is a no-op, so clicking around the demo never changes your real
//     workspaces.
// Times are relative to a fixed clock, so the "ago" labels stay put.

const DEMO_NOW = 1_800_000_000;
const DEMO_MIN = 60;
const DEMO_HOUR = 3600;
const DEMO_DAY = 86400;

const DEMO_HEADER = "cmux-sessions-sidebar:group-header";

// One entry per project: [id, title, directory, branch, group, tabs]
// tab: [title, state, latestPrompt, secondsAgo, extra]
//   state: working | waiting | idle | unread | shell
const DEMO_PROJECTS = [
  ["W1", "portfolio-site", "~/code/portfolio-site", "main", null, [
    ["Add a contact form", "working", "Add a contact form that emails me new messages", 20, { focused: true }],
    ["Write the README", "idle", "Document how to run the site locally", 2 * DEMO_HOUR],
  ]],
  ["W2", "dotfiles", "~/code/dotfiles", "main", null, [
    ["Terminal", "shell", "", 3 * DEMO_DAY],
  ]],
  ["W3", "acme-api", "~/code/acme-api", "feat/rate-limits", "G1", [
    ["Add rate limiting to the public API", "waiting", "", 4 * DEMO_MIN],
    ["Fix flaky auth tests", "idle", "The token refresh test fails about one run in ten", 5 * DEMO_HOUR],
  ]],
  ["W4", "web-dashboard", "~/code/web-dashboard", "main", "G1", [
    ["Dark mode for the charts page", "unread", "Make every chart readable in dark mode", 12 * DEMO_MIN],
    ["Terminal", "shell", "", DEMO_DAY],
  ]],
  ["W5", "data-pipeline", "~/code/data-pipeline", "main", "G1", [
    ["Speed up the nightly export job", "working", "Profile the export and cut the runtime in half", 50],
  ]],
  ["W6", "recipe-app", "~/code/recipe-app", "main", "G2", [
    ["Import recipes from a URL", "idle", "Parse schema.org recipe markup from a pasted link", 2 * DEMO_DAY],
  ]],
  ["W7", "old-prototype", "~/code/old-prototype", "main", "G3", [
    ["Terminal", "shell", "", 40 * DEMO_DAY],
  ]],
];

const DEMO_GROUPS = [
  { id: "G1", name: "Work", anchorId: "H1" },
  { id: "G2", name: "Side projects", anchorId: "H2" },
  { id: "G3", name: "Archive", anchorId: "H3", collapsed: true },
];

function demoWorkspaces() {
  const out = [];
  const add = (w) => out.push({ ...w, index: out.length });
  const project = ([id, title, directory, branch, group, tabs]) => {
    const agents = [];
    const ts = tabs.map(([tabTitle, state, latestPrompt, secondsAgo, extra], i) => {
      const tabId = `${id}-T${i + 1}`;
      const at = DEMO_NOW - secondsAgo;
      const glyph = state === "working" ? "⠋ " : state === "shell" ? "" : "✳ ";
      if (state !== "shell") {
        agents.push({
          panelId: tabId,
          index: i,
          name: "claude",
          title: tabTitle,
          status: state === "working" ? "working" : state === "waiting" ? "needs_input" : "idle",
          lastActivityAt: at,
        });
      }
      return {
        id: tabId,
        surfaceId: `${tabId}-S`,
        title: glyph + tabTitle,
        latestPrompt,
        latestAt: at,
        hasUnread: state === "unread",
        focused: false,
        directory,
        branch,
        ...(extra ?? {}),
      };
    });
    return { id, title, directory, branch, group: group ?? undefined, tabs: ts, agents, selected: id === "W1" };
  };
  // cmux order: ungrouped projects first, then each group's hidden header
  // followed by its members.
  for (const p of DEMO_PROJECTS.filter((p) => !p[4])) add(project(p));
  for (const g of DEMO_GROUPS) {
    add({ id: g.anchorId, title: g.name, description: DEMO_HEADER, group: g.id, tabs: [], agents: [] });
    for (const p of DEMO_PROJECTS.filter((p) => p[4] === g.id)) add(project(p));
  }
  return out;
}

const DEMO_DATA = {
  workspaces: demoWorkspaces(),
  groups: DEMO_GROUPS.map((g) => ({ collapsed: false, pinned: false, ...g })),
  selectedId: "W1",
  clock: { epoch: DEMO_NOW, second: DEMO_NOW % 60 },
  unreadTotal: 1,
};

const data = new Proxy({}, {
  get(_t, key) {
    return () => DEMO_DATA[key];
  },
});

const cmux = () => {};

// --- sessions.js follows ------------------------------------------------------
