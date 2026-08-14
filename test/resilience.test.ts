import { expect, test } from "bun:test";
import { adoptPlan } from "../src/adopt.ts";
import { sessionForScope } from "../src/ownership.ts";
import { matchScore } from "../src/resolve.ts";
import { realpathSync } from "node:fs";
import { applyAll } from "../src/tmux.ts";
import type { Action, PaneContext, Tmux, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "api", patterns: ["/w/api-service*"] },
  { name: "web", patterns: ["/w/webapp"] },
];

const STRAY: TmuxState = {
  sessions: [{ id: "$0", name: "api", windows: 3, attached: true }],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/api-service" },
    { id: "@1", index: 2, session: "api", path: "/w/api-service.tasks-1" },
    { id: "@2", index: 3, session: "api", path: "/w/webapp" },
  ],
};

function fakeTmux(failOn: Action["kind"][]): { client: Tmux; applied: Action[] } {
  const applied: Action[] = [];
  const client: Tmux = {
    state(): TmuxState {
      return STRAY;
    },
    paneWork(): number {
      return 0;
    },
    panesInSession(): number {
      return 1;
    },
    paneContext(): PaneContext {
      return { session: "api", windowId: "@0" };
    },
    apply(action: Action) {
      if (failOn.includes(action.kind)) {
        throw new Error(`tmux ${action.kind} failed: no current client`);
      }
      applied.push(action);
    },
    message() {},
  };
  return { client, applied };
}

test("a session that only holds a stray window of a scope does not own that scope", () => {
  expect(sessionForScope(STRAY, SCOPES, "web")).toBe(null);
});

test("a session whose windows are mostly one scope owns that scope even when it is named otherwise", () => {
  const renamed: TmuxState = { sessions: [{ id: "$0", name: "old", windows: 1, attached: false }], windows: [{ id: "@0", index: 1, session: "old", path: "/w/webapp" }] };
  expect(sessionForScope(renamed, SCOPES, "web")).toBe("old");
});

test("a failed switch does not stop the rest of the plan", () => {
  const { client, applied } = fakeTmux(["switch"]);
  const actions: Action[] = [
    { kind: "new-window", session: "web", cwd: "/w/webapp" },
    { kind: "switch", target: "web" },
    { kind: "rename-session", id: "$0", name: "web" },
  ];
  expect(applyAll(client, actions)).toBe("");
  expect(applied).toEqual([actions[0]!, actions[2]!]);
});

test("a failed move reports the reason and stops the plan", () => {
  const { client, applied } = fakeTmux(["move-window"]);
  const actions: Action[] = [
    { kind: "move-window", windowId: "@2", session: "web" },
    { kind: "rename-session", id: "$0", name: "web" },
  ];
  expect(applyAll(client, actions)).toBe("tmux move-window failed: no current client");
  expect(applied).toEqual([]);
});

test("a scope pattern behind a symlink still owns the path tmux reports", () => {
  const real = realpathSync("/tmp");
  expect(real).not.toBe("/tmp");
  expect(matchScore("/tmp", `${real}/anything`)).toBeGreaterThan(-1);
});

test("adopt never drains the session a client is sitting in", () => {
  const state: TmuxState = {
    sessions: [
      { id: "$0", name: "web", windows: 1, attached: false },
      { id: "$9", name: "web2", windows: 1, attached: true },
    ],
    windows: [
      { id: "@0", index: 1, session: "web", path: "/w/webapp" },
      { id: "@9", index: 1, session: "web2", path: "/w/webapp" },
    ],
  };
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windows: [{ id: "@9", path: "/w/webapp" }], scopes: SCOPES, state, attached: true });
  expect(plan.actions).toEqual([]);
});
