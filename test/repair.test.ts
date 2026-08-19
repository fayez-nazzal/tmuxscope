import { expect, test } from "bun:test";
import { doctorReport } from "../src/doctor.ts";
import { repairPlan } from "../src/repair.ts";
import type { Action, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

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
  panes: [],
};

const NAME_COLLISION: TmuxState = {
  sessions: [{ id: "$0", name: "api", windows: 3, attached: true }],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/webapp" },
    { id: "@1", index: 2, session: "api", path: "/w/webapp/src" },
    { id: "@2", index: 3, session: "api", path: "/w/api-service" },
  ],
  panes: [],
};

const CONTESTED_LOSER: TmuxState = {
  sessions: [
    { id: "$0", name: "web", windows: 1, attached: false },
    { id: "$1", name: "api", windows: 2, attached: true },
  ],
  windows: [
    { id: "@0", index: 1, session: "web", path: "/w/api-service" },
    { id: "@1", index: 1, session: "api", path: "/w/api-service/app" },
    { id: "@2", index: 2, session: "api", path: "/w/webapp" },
  ],
  panes: [],
};

const MIXED_BESIDE_CLEAN: TmuxState = {
  sessions: [
    { id: "$0", name: "work", windows: 3, attached: true },
    { id: "$1", name: "main", windows: 2, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "work", path: "/w/webapp" },
    { id: "@1", index: 2, session: "work", path: "/w/webapp/src" },
    { id: "@2", index: 3, session: "work", path: "/w/api-service" },
    { id: "@3", index: 1, session: "main", path: "/home/me/docs" },
    { id: "@4", index: 2, session: "main", path: "/home/me/dl" },
  ],
  panes: [],
};

const MIXED_HOLDING_HOME: TmuxState = {
  sessions: [
    { id: "$0", name: "work", windows: 3, attached: true },
    { id: "$1", name: "main", windows: 2, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "work", path: "/w/webapp" },
    { id: "@1", index: 2, session: "work", path: "/w/webapp/src" },
    { id: "@2", index: 3, session: "work", path: "/home/me" },
    { id: "@3", index: 1, session: "main", path: "/home/me/docs" },
    { id: "@4", index: 2, session: "main", path: "/home/me/dl" },
  ],
  panes: [],
};

function applyActions(state: TmuxState, actions: Action[]): TmuxState {
  const sessions = state.sessions.map((session) => ({ ...session }));
  const windows = state.windows.map((window) => ({ ...window }));
  let created = 0;
  for (const action of actions) {
    if (action.kind === "new-session") {
      if (sessions.some((session) => session.name === action.name)) {
        throw new Error(`duplicate session: ${action.name}`);
      }
      created = created + 1;
      sessions.push({ id: `$n${created}`, name: action.name, windows: 1, attached: false });
      windows.push({ id: `@n${created}`, index: 1, session: action.name, path: action.cwd });
    }
    if (action.kind === "rename-session") {
      const session = sessions.find((entry) => entry.id === action.id);
      if (!session) {
        throw new Error(`can't find session: ${action.id}`);
      }
      if (sessions.some((entry) => entry.name === action.name && entry.id !== action.id)) {
        throw new Error(`duplicate session: ${action.name}`);
      }
      for (const window of windows) {
        if (window.session === session.name) {
          window.session = action.name;
        }
      }
      session.name = action.name;
    }
    if (action.kind === "move-window") {
      const window = windows.find((entry) => entry.id === action.windowId);
      if (!window) {
        throw new Error(`can't find window: ${action.windowId}`);
      }
      if (!sessions.some((entry) => entry.name === action.session)) {
        throw new Error(`can't find session: ${action.session}`);
      }
      const source = window.session;
      window.session = action.session;
      const emptied = !windows.some((entry) => entry.session === source);
      if (emptied) {
        const index = sessions.findIndex((entry) => entry.name === source);
        sessions.splice(index, 1);
      }
    }
  }
  for (const session of sessions) {
    session.windows = windows.filter((window) => window.session === session.name).length;
  }
  return { sessions, windows };
}

function repair(state: TmuxState): TmuxState {
  const actions = repairPlan(doctorReport(state, SCOPES), state, SCOPES).actions;
  return applyActions(state, actions);
}

function touched(actions: Action[], state: TmuxState, name: string): boolean {
  const session = state.sessions.find((entry) => entry.name === name);
  const held = state.windows.filter((window) => window.session === name);
  let hit = false;
  for (const action of actions) {
    if (action.kind === "rename-session" && session && action.id === session.id) {
      hit = true;
    }
    if (action.kind === "move-window" && held.some((window) => window.id === action.windowId)) {
      hit = true;
    }
    if (action.kind === "move-window" && action.session === name) {
      hit = true;
    }
  }
  return hit;
}

test("the simulator destroys a session the moment its last window leaves", () => {
  const drained = applyActions(CONTESTED_LOSER, [{ kind: "move-window", windowId: "@0", session: "api" }]);
  expect(drained.sessions.map((session) => session.name)).toEqual(["api"]);
});

test("the simulator refuses a move into a session an earlier move destroyed", () => {
  const doomed: Action[] = [
    { kind: "move-window", windowId: "@0", session: "api" },
    { kind: "move-window", windowId: "@2", session: "web" },
  ];
  expect(() => applyActions(CONTESTED_LOSER, doomed)).toThrow("can't find session: web");
});

test("repair fills a contested loser session before it drains it", () => {
  const report = doctorReport(CONTESTED_LOSER, SCOPES);
  expect(report.problems).toBeGreaterThan(0);
  expect(report.ambiguous).toEqual([{ session: "api", candidates: ["api", "web"], count: 1, rule: "session name matches scope name" }]);
  const actions = repairPlan(report, CONTESTED_LOSER, SCOPES).actions;
  expect(actions).toEqual([
    { kind: "new-session", name: "web-2", cwd: "/w/webapp" },
    { kind: "move-window", windowId: "@1", session: "web" },
    { kind: "move-window", windowId: "@2", session: "web-2" },
  ]);
  const after = repair(CONTESTED_LOSER);
  expect(after.sessions.map((session) => session.name).sort()).toEqual(["web", "web-2"]);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
});

test("repair leaves a session doctor reports as clean untouched", () => {
  const report = doctorReport(MIXED_BESIDE_CLEAN, SCOPES);
  expect(report.mixed.map((mixed) => mixed.session)).toEqual(["work"]);
  expect(report.split).toEqual([]);
  const actions = repairPlan(report, MIXED_BESIDE_CLEAN, SCOPES).actions;
  expect(touched(actions, MIXED_BESIDE_CLEAN, "main")).toBe(false);
  expect(actions).toEqual([
    { kind: "rename-session", id: "$0", name: "web" },
    { kind: "new-session", name: "api", cwd: "/w/api-service" },
    { kind: "move-window", windowId: "@2", session: "api" },
  ]);
  const after = repair(MIXED_BESIDE_CLEAN);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
});

test("repair never renames a session doctor did not report, even to home a stray window", () => {
  const report = doctorReport(MIXED_HOLDING_HOME, SCOPES);
  expect(report.mixed.map((mixed) => mixed.session)).toEqual(["work"]);
  const actions = repairPlan(report, MIXED_HOLDING_HOME, SCOPES).actions;
  const renamed = actions.filter((action) => action.kind === "rename-session");
  expect(renamed).toEqual([{ kind: "rename-session", id: "$0", name: "web" }]);
  const drained = actions.filter((action) => action.kind === "move-window" && ["@3", "@4"].includes(action.windowId));
  expect(drained).toEqual([]);
  const after = repair(MIXED_HOLDING_HOME);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
});

test("repair converges when two mixed sessions hold windows of the same third scope", () => {
  const before = doctorReport(TWO_MIXED, SCOPES);
  expect(before.problems).toBeGreaterThan(0);
  const actions = repairPlan(before, TWO_MIXED, SCOPES).actions;
  expect(actions).toEqual([
    { kind: "new-session", name: "web", cwd: "/w/webapp" },
    { kind: "move-window", windowId: "@2", session: "web" },
    { kind: "move-window", windowId: "@5", session: "web" },
  ]);
  const after = repair(TWO_MIXED);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
  expect(repairPlan(doctorReport(after, SCOPES), after, SCOPES).actions).toEqual([]);
});

test("repair never plans a session name that already exists", () => {
  const before = doctorReport(NAME_COLLISION, SCOPES);
  expect(before.problems).toBeGreaterThan(0);
  const actions = repairPlan(before, NAME_COLLISION, SCOPES).actions;
  expect(actions).toEqual([
    { kind: "new-session", name: "web", cwd: "/w/webapp" },
    { kind: "move-window", windowId: "@0", session: "web" },
    { kind: "move-window", windowId: "@1", session: "web" },
  ]);
  const after = repair(NAME_COLLISION);
  expect(doctorReport(after, SCOPES).problems).toBe(0);
  expect(repairPlan(doctorReport(after, SCOPES), after, SCOPES).actions).toEqual([]);
});

test("repair only ever moves windows, it never kills them", () => {
  const states = [TWO_MIXED, NAME_COLLISION, CONTESTED_LOSER, MIXED_BESIDE_CLEAN, MIXED_HOLDING_HOME];
  for (const state of states) {
    const after = repair(state);
    expect(after.windows.length).toBeGreaterThanOrEqual(state.windows.length);
    for (const window of state.windows) {
      expect(after.windows.some((entry) => entry.id === window.id)).toBe(true);
    }
  }
});

test("a second repair pass is a no op for every fixture", () => {
  const states = [TWO_MIXED, NAME_COLLISION, CONTESTED_LOSER, MIXED_BESIDE_CLEAN, MIXED_HOLDING_HOME];
  for (const state of states) {
    const once = repair(state);
    const twice = repair(once);
    expect(twice.sessions.map((session) => session.name).sort()).toEqual(once.sessions.map((session) => session.name).sort());
    expect(doctorReport(twice, SCOPES).problems).toBe(0);
  }
});

const NAMES = ["db", "web", "api", "work", "main", "misc"];
const PATHS = [
  "/w/db-service",
  "/w/db-service/lib",
  "/w/webapp",
  "/w/webapp/src",
  "/w/api-service",
  "/w/api-service.tasks-1/app",
  "/home/me",
  "/home/me/dl",
];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = state + 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fuzzState(random: () => number): TmuxState {
  const state: TmuxState = { sessions: [], windows: [], panes: [] };
  const pool = NAMES.slice();
  const sessionCount = 1 + Math.floor(random() * 4);
  let windowId = 0;
  for (let index = 0; index < sessionCount; index++) {
    const name = pool.splice(Math.floor(random() * pool.length), 1)[0]!;
    const windowCount = 1 + Math.floor(random() * 4);
    state.sessions.push({ id: `$${index}`, name, windows: windowCount, attached: random() < 0.3 });
    for (let slot = 0; slot < windowCount; slot++) {
      const path = PATHS[Math.floor(random() * PATHS.length)]!;
      state.windows.push({ id: `@${windowId}`, index: slot + 1, session: name, path });
      windowId = windowId + 1;
    }
  }
  return state;
}

test("a fuzz over three thousand broken states plans nothing unapplicable and always converges", () => {
  const random = seeded(20260807);
  let checked = 0;
  let generated = 0;
  while (checked < 3000) {
    const state = fuzzState(random);
    generated = generated + 1;
    const report = doctorReport(state, SCOPES);
    if (report.problems > 0) {
      checked = checked + 1;
      const actions = repairPlan(report, state, SCOPES).actions;
      const after = applyActions(state, actions);
      expect(doctorReport(after, SCOPES).problems).toBe(0);
      expect(repairPlan(doctorReport(after, SCOPES), after, SCOPES).actions).toEqual([]);
      for (const window of state.windows) {
        expect(after.windows.some((entry) => entry.id === window.id)).toBe(true);
      }
      const clean = state.sessions.filter((session) => !report.mixed.some((mixed) => mixed.session === session.name) && !report.split.some((split) => split.sessions.includes(session.name)));
      for (const session of clean) {
        const renamed = actions.some((action) => action.kind === "rename-session" && action.id === session.id);
        const drained = actions.some((action) => action.kind === "move-window" && state.windows.some((window) => window.id === action.windowId && window.session === session.name));
        expect(renamed).toBe(false);
        expect(drained).toBe(false);
      }
    }
  }
  expect(generated).toBeGreaterThan(checked);
});
