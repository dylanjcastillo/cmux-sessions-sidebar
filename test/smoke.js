// Smoke test for sessions.js: runs the real cmux SidebarRuntime.js in a VM
// with a fake host that applies cmux() group/workspace actions to mock state.
// usage: node test/smoke.js <SidebarRuntime.js> <sessions.js>
const fs = require("fs");
const vm = require("vm");
const [runtimePath, sidebarPath] = process.argv.slice(2);

let state = {
  epoch: 1000,
  selectedId: "W1",
  workspaces: [
    { id: "W1", title: "ddna", tabs: [{ id: "T1", surfaceId: "S1", title: "✳ Tab one" }] },
    { id: "W2", title: "econagents", tabs: [{ id: "T2", surfaceId: "S2", title: "✳ Tab two" }] },
    { id: "W3", title: "blog", tabs: [] },
  ],
  groups: [],
};
let nextId = 1;
const actions = [];
let ops = 0;
let ctx;

function push() {
  const ws = state.workspaces.map((w, index) => ({ ...w, index, selected: w.id === state.selectedId }));
  ctx.__setData("workspaces", JSON.stringify(ws));
  ctx.__setData("groups", JSON.stringify(state.groups.map((g) => ({
    id: g.id, name: g.name, collapsed: g.collapsed, pinned: false, anchorId: g.anchor,
  }))));
  ctx.__setData("selectedId", JSON.stringify(state.selectedId));
  ctx.__setData("clock", JSON.stringify({ epoch: state.epoch, second: state.epoch % 60 }));
  ctx.__setData("unreadTotal", "0");
}
const ws = (id) => state.workspaces.find((w) => w.id === id);
const members = (gid) => state.workspaces.filter((w) => w.group === gid);
function dropGroup(gid) {
  for (const w of members(gid)) delete w.group;
  state.groups = state.groups.filter((g) => g.id !== gid);
}

// Fake host: mirrors the cmux behavior verified against the real socket API.
function host(m, p) {
  for (const k of Object.keys(p)) if (typeof p[k] !== "string") throw new Error("non-string param " + k);
  switch (m) {
    case "workspace.group.create": {
      if (p.child_workspace_ids) throw new Error("child_workspace_ids must be an array");
      const anchor = "GEN" + nextId++;
      const gid = "G" + nextId++;
      state.workspaces.unshift({ id: anchor, title: p.name, tabs: [], group: gid });
      state.groups.push({ id: gid, name: p.name, collapsed: false, anchor });
      state.selectedId = anchor; // cmux focuses the new anchor
      break;
    }
    case "workspace.group.add": {
      const w = ws(p.workspace_id);
      state.workspaces = state.workspaces.filter((x) => x !== w);
      w.group = p.group_id;
      let last = -1;
      state.workspaces.forEach((x, i) => { if (x.group === p.group_id) last = i; });
      state.workspaces.splice(last + 1, 0, w);
      break;
    }
    case "workspace.action": {
      const w = ws(p.workspace_id);
      if (p.action === "set_description") w.description = p.description;
      else if (p.action === "rename") w.title = p.title;
      else if (p.action === "clear_name") w.title = w.id.toLowerCase();
      else throw new Error("unknown workspace.action " + p.action);
      break;
    }
    case "workspace.group.remove": {
      const w = ws(p.workspace_id); const g = state.groups.find((x) => x.id === w.group);
      if (g && g.anchor === w.id) dropGroup(g.id); else delete w.group; // anchor removal dissolves
      break;
    }
    case "workspace.group.set_anchor": state.groups.find((g) => g.id === p.group_id).anchor = p.workspace_id; break;
    case "workspace.group.ungroup": dropGroup(p.group_id); break;
    case "workspace.group.rename": state.groups.find((g) => g.id === p.group_id).name = p.name; break;
    case "workspace.group.collapse": state.groups.find((g) => g.id === p.group_id).collapsed = true; break;
    case "workspace.group.expand": state.groups.find((g) => g.id === p.group_id).collapsed = false; break;
    case "workspace.close": {
      if (p.force !== "true") throw new Error("confirmation_required");
      const w = ws(p.workspace_id); const g = state.groups.find((x) => x.id === w?.group);
      state.workspaces = state.workspaces.filter((x) => x.id !== p.workspace_id);
      if (g && g.anchor === p.workspace_id) {
        const next = members(g.id)[0];
        if (next) g.anchor = next.id; else state.groups = state.groups.filter((x) => x !== g);
      }
      break;
    }
    case "workspace.select": state.selectedId = p.workspace_id; break;
    case "workspace.reorder": {
      const w = ws(p.workspace_id);
      state.workspaces = state.workspaces.filter((x) => x !== w);
      state.workspaces.splice(Number(p.index), 0, w);
      break;
    }
    default: break;
  }
}

ctx = vm.createContext({
  console,
  __host_applyOps: (j) => { ops += JSON.parse(j).length || 1; },
  __host_action: (j) => {
    const a = JSON.parse(j);
    if (a.kind === "cmux") { actions.push(a.method + " " + JSON.stringify(a.params)); queue.push(a); }
    if (a.kind === "log") console.log("LOG", a.message);
  },
  __host_log: (s) => {},
  __host_clipboardWrite: () => true,
});
const queue = [];
// Host processes actions after the JS turn, then pushes fresh data.
function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    if (!queue.length) { state.epoch += 1; push(); continue; }
    while (queue.length) { const a = queue.shift(); host(a.method, a.params); }
    state.epoch += 1;
    push();
  }
}

vm.runInContext(fs.readFileSync(runtimePath, "utf8"), ctx);
ctx.__setData("groups", "[]");
vm.runInContext(fs.readFileSync(sidebarPath, "utf8"), ctx);
push();

const run = (code) => vm.runInContext(code, ctx);
const entryIds = () => run("entries().map(e => e.kind + ':' + (e.wsId || e.groupId || '')).join('  ')");
const summary = (label) => {
  console.log("\n## " + label);
  console.log("groups:", JSON.stringify(state.groups));
  console.log("workspaces:", state.workspaces.map((w) => w.id + (w.group ? "@" + w.group : "") + (w.description ? "[hdr]" : "")).join(" "), "| selected:", state.selectedId);
  console.log("entries:", entryIds());
  console.log("shortcuts:", JSON.stringify(run("shortcutById()")));
};

summary("initial");
run("createGroupWith('Work', wsById('W2'))"); settle();
summary("New Group 'Work' from W2: header hidden + marked, W2 keeps a shortcut, W1 reselected");
run("moveToGroup(wsById('W3'), groupById(userGroups()[0].id))"); settle();
summary("moved W3 into Work");
run("removeFromGroup(wsById('W2'))"); settle();
summary("removed W2 from Work (W3 stays)");
run("toggleGroupCollapsed(groupById(userGroups()[0].id))"); settle();
summary("collapsed Work: W3 hidden and loses its shortcut (cmux skips collapsed members)");
run("toggleGroupCollapsed(groupById(userGroups()[0].id))"); settle();
run("finishGroupRename(userGroups()[0].id, 'Clients')"); settle();
run("finishProjectRename(wsById('W1'), 'Main project')"); settle();
summary("renamed group to Clients and W1 to 'Main project'");
run("archive(wsById('W1'))"); settle();
summary("archived W1: Archive group collapsed, W1 has no shortcut and is hidden");
run("unarchive(wsById('W1'))"); settle();
summary("unarchived W1");
run("ungroupGroup(userGroups().find(g => g.name === 'Clients').id)"); settle();
summary("ungrouped Clients: its hidden header closed, W3 back at top level");
console.log("\nactions:\n  " + actions.join("\n  "));
console.log("\nops applied:", ops);
