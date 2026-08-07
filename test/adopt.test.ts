import { expect, test } from "bun:test";
import { adoptPlan } from "../src/plan.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/config.ts";

const SCOPES: Scope[] = [
  { name: "web", patterns: ["/w/webapp"] },
  { name: "tools", patterns: ["/w/toolkit"] },
];

const STATE: TmuxState = {
  sessions: [
    { id: "$0", name: "web", windows: 1, attached: true },
    { id: "$9", name: "scratch", windows: 1, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "web", path: "/w/webapp" },
    { id: "@9", index: 1, session: "scratch", path: "/w/toolkit" },
  ],
};

test("a new session in a free scope is renamed to the scope", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "scratch", windowId: "@9", windowPath: "/w/toolkit", scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([{ kind: "rename-session", id: "$9", name: "tools" }]);
  expect(plan.message).toBe("renamed scratch to tools");
});

test("an attached session in a taken scope is merged into the owner and switches focus", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windowId: "@9", windowPath: "/w/webapp/app", scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([
    { kind: "move-window", windowId: "@9", session: "web" },
    { kind: "switch", target: "web" },
  ]);
  expect(plan.message).toBe("merged into web");
});

test("a detached session in a taken scope is merged into the owner without switching focus", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windowId: "@9", windowPath: "/w/webapp/app", scopes: SCOPES, state: STATE, attached: false });
  expect(plan.actions).toEqual([{ kind: "move-window", windowId: "@9", session: "web" }]);
  expect(plan.message).toBe("merged into web");
});

test("a session already named after its scope is left alone", () => {
  const plan = adoptPlan({ sessionId: "$0", sessionName: "web", windowId: "@0", windowPath: "/w/webapp", scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([]);
  expect(plan.message).toBe("");
});

test("an unmatched path becomes the misc session", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "notes", windowId: "@9", windowPath: "/w/downloads", scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([{ kind: "rename-session", id: "$9", name: "misc" }]);
  expect(plan.message).toBe("renamed notes to misc");
});
