import { expect, test } from "bun:test";
import { doctorReport, repairPlan } from "../src/plan.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/config.ts";

const SCOPES: Scope[] = [
  { name: "db", patterns: ["/w/db-service"] },
  { name: "web", patterns: ["/w/webapp"] },
  { name: "api", patterns: ["/w/api-service*"] },
];

const MIXED: TmuxState = {
  sessions: [{ id: "$0", name: "db", windows: 2, attached: true }],
  windows: [
    { id: "@0", index: 1, session: "db", path: "/w/db-service" },
    { id: "@1", index: 2, session: "db", path: "/w/webapp" },
  ],
};

const SPLIT: TmuxState = {
  sessions: [
    { id: "$0", name: "api", windows: 2, attached: true },
    { id: "$1", name: "api-2", windows: 1, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/api-service" },
    { id: "@1", index: 2, session: "api", path: "/w/api-service.tasks-1" },
    { id: "@2", index: 1, session: "api-2", path: "/w/api-service.tasks-2" },
  ],
};

test("a clean state reports no problems", () => {
  const state: TmuxState = { sessions: [{ id: "$0", name: "web", windows: 1, attached: true }], windows: [{ id: "@0", index: 1, session: "web", path: "/w/webapp" }] };
  expect(doctorReport(state, SCOPES)).toEqual({ mixed: [], split: [], problems: 0 });
});

test("a session holding two scopes is reported as mixed", () => {
  const report = doctorReport(MIXED, SCOPES);
  expect(report.problems).toBe(1);
  expect(report.mixed).toEqual([
    { session: "db", windows: [{ index: 1, path: "/w/db-service", scope: "db" }, { index: 2, path: "/w/webapp", scope: "web" }] },
  ]);
});

test("a scope spread over two sessions is reported as split", () => {
  const report = doctorReport(SPLIT, SCOPES);
  expect(report.problems).toBe(1);
  expect(report.split).toEqual([{ scope: "api", sessions: ["api", "api-2"] }]);
});

test("repair moves a stray window to the owning session", () => {
  const state: TmuxState = { sessions: [...MIXED.sessions, { id: "$1", name: "web", windows: 1, attached: false }], windows: [...MIXED.windows, { id: "@2", index: 1, session: "web", path: "/w/webapp" }] };
  expect(repairPlan(doctorReport(state, SCOPES), state, SCOPES)).toEqual([{ kind: "move-window", windowId: "@1", session: "web" }]);
});

test("repair creates the owning session when it does not exist", () => {
  expect(repairPlan(doctorReport(MIXED, SCOPES), MIXED, SCOPES)).toEqual([
    { kind: "new-session", name: "web", cwd: "/w/webapp" },
    { kind: "move-window", windowId: "@1", session: "web" },
  ]);
});

test("repair folds a split scope into the attached session", () => {
  expect(repairPlan(doctorReport(SPLIT, SCOPES), SPLIT, SCOPES)).toEqual([{ kind: "move-window", windowId: "@2", session: "api" }]);
});

test("repair does not move a window twice when its session is both mixed and part of a split scope", () => {
  const state: TmuxState = {
    sessions: [
      { id: "$0", name: "db", windows: 3, attached: false },
      { id: "$1", name: "api2", windows: 1, attached: true },
    ],
    windows: [
      { id: "@0", index: 1, session: "db", path: "/w/api-service" },
      { id: "@1", index: 2, session: "db", path: "/w/api-service.tasks-1" },
      { id: "@2", index: 3, session: "db", path: "/w/db-service" },
      { id: "@3", index: 1, session: "api2", path: "/w/api-service.tasks-2" },
    ],
  };
  const actions = repairPlan(doctorReport(state, SCOPES), state, SCOPES);
  const moves: { kind: "move-window"; windowId: string; session: string }[] = [];
  for (const action of actions) {
    if (action.kind === "move-window") {
      moves.push(action);
    }
  }
  const movedIds = moves.map((move) => move.windowId);
  expect(new Set(movedIds).size).toBe(movedIds.length);
  const destinationByWindow = new Map(moves.map((move) => [move.windowId, move.session]));
  expect(destinationByWindow.get("@0")).toBe("api2");
  expect(destinationByWindow.get("@1")).toBe("api2");
  expect(destinationByWindow.get("@2")).toBe("db");
  expect(actions).toEqual([
    { kind: "new-session", name: "db", cwd: "/w/db-service" },
    { kind: "move-window", windowId: "@2", session: "db" },
    { kind: "move-window", windowId: "@0", session: "api2" },
    { kind: "move-window", windowId: "@1", session: "api2" },
  ]);
});
