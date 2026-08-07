import { expect, test } from "bun:test";
import { doctorReport, repairPlan } from "../src/plan.ts";
import type { Action, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/config.ts";

const SCOPES: Scope[] = [
  { name: "db", patterns: ["/w/db-service"] },
  { name: "web", patterns: ["/w/webapp"] },
  { name: "api", patterns: ["/w/api-service*"] },
];

const TWO_MIXED: TmuxState = {
  sessions: [
    { id: "$0", name: "db", windows: 3, attached: true },
    { id: "$1", name: "api", windows: 3, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "db", path: "/w/db-service" },
    { id: "@1", index: 2, session: "db", path: "/w/db-service/lib" },
    { id: "@2", index: 3, session: "db", path: "/w/webapp" },
    { id: "@3", index: 1, session: "api", path: "/w/api-service" },
    { id: "@4", index: 2, session: "api", path: "/w/api-service/app" },
    { id: "@5", index: 3, session: "api", path: "/w/webapp/src" },
  ],
};

const NAME_COLLISION: TmuxState = {
  sessions: [{ id: "$0", name: "api", windows: 3, attached: true }],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/webapp" },
    { id: "@1", index: 2, session: "api", path: "/w/webapp/src" },
    { id: "@2", index: 3, session: "api", path: "/w/api-service" },
  ],
};

function applyActions(state: TmuxState, actions: Action[]): TmuxState {
  const sessions = state.sessions.map((session) => ({ ...session }));
  const windows = state.windows.map((window) => ({ ...window }));
  let created = 0;
  for (const action of actions) {
    if (action.kind === "new-session") {
      const duplicate = sessions.some((session) => session.name === action.name);
      expect(duplicate).toBe(false);
      created = created + 1;
      sessions.push({ id: `$n${created}`, name: action.name, windows: 1, attached: false });
      windows.push({ id: `@n${created}`, index: 1, session: action.name, path: action.cwd });
    }
    if (action.kind === "rename-session") {
      const session = sessions.find((entry) => entry.id === action.id);
      if (session) {
        for (const window of windows) {
          if (window.session === session.name) {
            window.session = action.name;
          }
        }
        session.name = action.name;
      }
    }
    if (action.kind === "move-window") {
      const window = windows.find((entry) => entry.id === action.windowId);
      const target = sessions.find((entry) => entry.name === action.session);
      expect(window).toBeDefined();
      expect(target).toBeDefined();
      if (window) {
        window.session = action.session;
      }
    }
  }
  const live = sessions.filter((session) => windows.some((window) => window.session === session.name));
  for (const session of live) {
    session.windows = windows.filter((window) => window.session === session.name).length;
  }
  return { sessions: live, windows };
}

function repair(state: TmuxState): TmuxState {
  const actions = repairPlan(doctorReport(state, SCOPES), state, SCOPES);
  return applyActions(state, actions);
}

test("repair converges when two mixed sessions hold windows of the same third scope", () => {
  const before = doctorReport(TWO_MIXED, SCOPES);
  expect(before.problems).toBeGreaterThan(0);
  const actions = repairPlan(before, TWO_MIXED, SCOPES);
  expect(actions).toEqual([
    { kind: "new-session", name: "web", cwd: "/w/webapp" },
    { kind: "move-window", windowId: "@2", session: "web" },
    { kind: "move-window", windowId: "@5", session: "web" },
  ]);
  const after = repair(TWO_MIXED);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
  expect(repairPlan(doctorReport(after, SCOPES), after, SCOPES)).toEqual([]);
});

test("repair never plans a session name that already exists", () => {
  const before = doctorReport(NAME_COLLISION, SCOPES);
  expect(before.problems).toBeGreaterThan(0);
  const actions = repairPlan(before, NAME_COLLISION, SCOPES);
  expect(actions).toEqual([
    { kind: "rename-session", id: "$0", name: "web" },
    { kind: "new-session", name: "api", cwd: "/w/api-service" },
    { kind: "move-window", windowId: "@2", session: "api" },
  ]);
  const after = repair(NAME_COLLISION);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
  expect(repairPlan(doctorReport(after, SCOPES), after, SCOPES)).toEqual([]);
});

test("repair only ever moves windows, it never kills them", () => {
  const states = [TWO_MIXED, NAME_COLLISION];
  for (const state of states) {
    const after = repair(state);
    expect(after.windows.length).toBeGreaterThanOrEqual(state.windows.length);
    for (const window of state.windows) {
      expect(after.windows.some((entry) => entry.id === window.id)).toBe(true);
    }
  }
});

test("a second repair pass is a no op for every fixture", () => {
  const states = [TWO_MIXED, NAME_COLLISION];
  for (const state of states) {
    const once = repair(state);
    const twice = repair(once);
    expect(twice.sessions.map((session) => session.name).sort()).toEqual(once.sessions.map((session) => session.name).sort());
    expect(doctorReport(twice, SCOPES).problems).toBe(0);
  }
});
