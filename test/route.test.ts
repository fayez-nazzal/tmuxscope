import { expect, test } from "bun:test";
import { routePlan } from "../src/route.ts";
import { sessionForScope } from "../src/ownership.ts";
import { directoryGroup } from "../src/directory-groups.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "api", patterns: ["/w/api-service*"] },
  { name: "web", patterns: ["/w/webapp"] },
];

const STATE: TmuxState = {
  sessions: [
    { id: "$0", name: "api", windows: 2, attached: true },
    { id: "$1", name: "web", windows: 1, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/api-service" },
    { id: "@1", index: 2, session: "api", path: "/w/api-service.tasks-1" },
    { id: "@2", index: 1, session: "web", path: "/w/webapp" },
  ],
  panes: [],
};

function input(overrides: Partial<Parameters<typeof routePlan>[0]> = {}) {
  const target = overrides.target || "/w/webapp";
  const originPath = overrides.originPath || "/w/api-service";
  return {
    target,
    originPath,
    targetGroup: directoryGroup(target, SCOPES),
    originGroup: directoryGroup(originPath, SCOPES),
    paneWork: 1,
    panesInSession: 3,
    scopes: SCOPES,
    state: STATE,
    ...overrides,
  };
}

test("sessionForScope finds the session holding a scope", () => {
  expect(sessionForScope(STATE, SCOPES, "web")).toBe("web");
  expect(sessionForScope(STATE, SCOPES, "tools")).toBe(null);
});

test("staying inside the current directory group does nothing", () => {
  const plan = routePlan(input({ target: "/w/api-service/src" }));
  expect(plan.actions).toEqual([]);
  expect(plan.origin).toBe("none");
});

test("a child directory reuses its worktree window", () => {
  const scopes: Scope[] = [{ name: "feos", patterns: ["/w/feos*"] }];
  const state: TmuxState = {
    sessions: [{ id: "$0", name: "feos", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "feos", path: "/w/feos.fix" }],
    panes: [],
  };
  const target = "/w/feos.fix/src";
  const plan = routePlan({
    ...input({ target, originPath: "/w/other", scopes, state }),
    targetGroup: directoryGroup(target, scopes),
    originGroup: directoryGroup("/w/other", scopes),
  });
  expect(plan.actions).toEqual([
    { kind: "select-window", windowId: "@0" },
    { kind: "switch", target: "feos" },
  ]);
});

test("two worktrees in one scope use separate windows", () => {
  const scopes: Scope[] = [{ name: "feos", patterns: ["/w/feos*"] }];
  const state: TmuxState = {
    sessions: [{ id: "$0", name: "feos", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "feos", path: "/w/feos.fix" }],
    panes: [],
  };
  const target = "/w/feos.other/src";
  const plan = routePlan({
    ...input({ target, originPath: "/w/other", scopes, state }),
    targetGroup: directoryGroup(target, scopes),
    originGroup: directoryGroup("/w/other", scopes),
  });
  expect(plan.actions).toEqual([
    { kind: "new-window", session: "feos", cwd: target },
    { kind: "switch", target: "feos" },
  ]);
});

test("an unmatched directory uses its own group", () => {
  const target = "/w/elsewhere";
  const plan = routePlan(input({ target, originPath: "/w/other", state: { sessions: [], windows: [], panes: [] } }));
  expect(plan.actions).toEqual([
    { kind: "new-session", name: "misc", cwd: target },
    { kind: "switch", target: "misc" },
  ]);
});

test("an idle window already sitting in the target directory is reused instead of piling up another", () => {
  const plan = routePlan(input());
  expect(plan.actions).toEqual([
    { kind: "select-window", windowId: "@2" },
    { kind: "switch", target: "web" },
  ]);
  expect(plan.message).toBe("→ web  window reused, origin pane restored");
});

test("a child of an exact configured path reuses its directory group window", () => {
  const plan = routePlan(input({ target: "/w/webapp/app" }));
  expect(plan.actions).toEqual([
    { kind: "select-window", windowId: "@2" },
    { kind: "switch", target: "web" },
  ]);
  expect(plan.message).toBe("→ web  window reused, origin pane restored");
});

test("a missing scope session is created first", () => {
  const plan = routePlan(input({ target: "/w/other", state: { sessions: [STATE.sessions[0]!], windows: [STATE.windows[0]!] } }));
  expect(plan.actions).toEqual([
    { kind: "new-session", name: "misc", cwd: "/w/other" },
    { kind: "switch", target: "misc" },
  ]);
});

test("a pane that only ever ran cd is closed instead of restored", () => {
  const plan = routePlan(input({ paneWork: 0 }));
  expect(plan.origin).toBe("close");
  expect(plan.cdPath).toBe("");
  expect(plan.message).toBe("→ web  window reused, empty origin pane closed");
});

test("the last pane of a session is always restored, never closed", () => {
  const plan = routePlan(input({ paneWork: 0, panesInSession: 1 }));
  expect(plan.origin).toBe("restore");
  expect(plan.cdPath).toBe("/w/api-service");
});

test("sessionForScope misattributes a target session when the origin window already shows the new path", () => {
  const staleState: TmuxState = {
    sessions: [{ id: "$0", name: "api", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "api", path: "/w/webapp" }],
    panes: [],
  };
  expect(sessionForScope(staleState, SCOPES, "web")).toBe("api");
});

test("excluding the origin window before planning avoids that misattribution", () => {
  const staleState: TmuxState = {
    sessions: [{ id: "$0", name: "api", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "api", path: "/w/webapp" }],
    panes: [],
  };
  const routeWindows = staleState.windows.filter((window) => window.id !== "@0");
  const routeState: TmuxState = { sessions: staleState.sessions, windows: routeWindows, panes: [] };
  expect(sessionForScope(routeState, SCOPES, "web")).toBe(null);
  const plan = routePlan(input({ state: routeState, panesInSession: 1 }));
  expect(plan.actions).toEqual([
    { kind: "new-session", name: "web", cwd: "/w/webapp" },
    { kind: "switch", target: "web" },
  ]);
});

test("a session left window-less by excluding the origin window is never mistaken for the misc owner", () => {
  const soleSession: TmuxState = {
    sessions: [{ id: "$0", name: "seed", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "seed", path: "/w/api-service" }],
    panes: [],
  };
  const routeState: TmuxState = { sessions: soleSession.sessions, windows: [], panes: [] };
  expect(sessionForScope(routeState, SCOPES, "misc")).toBe(null);
  const plan = routePlan(input({ target: "/w/elsewhere", originPath: "/w/api-service", state: routeState, panesInSession: 1 }));
  expect(plan.actions).toEqual([
    { kind: "new-session", name: "misc", cwd: "/w/elsewhere" },
    { kind: "switch", target: "misc" },
  ]);
});
