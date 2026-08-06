import { expect, test } from "bun:test";
import { routePlan, sessionForScope } from "../src/plan.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/config.ts";

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
};

function input(overrides: Partial<Parameters<typeof routePlan>[0]> = {}) {
  return {
    target: "/w/webapp",
    originPath: "/w/api-service",
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

test("staying inside the current scope does nothing", () => {
  const plan = routePlan(input({ target: "/w/api-service.tasks-1/src" }));
  expect(plan.actions).toEqual([]);
  expect(plan.origin).toBe("none");
});

test("an existing scope session gets a new window and the client switches", () => {
  const plan = routePlan(input());
  expect(plan.actions).toEqual([
    { kind: "new-window", session: "web", cwd: "/w/webapp" },
    { kind: "switch", target: "web" },
  ]);
  expect(plan.message).toBe("→ web  new window, origin pane restored");
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
  expect(plan.message).toBe("→ web  new window, empty origin pane closed");
});

test("the last pane of a session is always restored, never closed", () => {
  const plan = routePlan(input({ paneWork: 0, panesInSession: 1 }));
  expect(plan.origin).toBe("restore");
  expect(plan.cdPath).toBe("/w/api-service");
});
