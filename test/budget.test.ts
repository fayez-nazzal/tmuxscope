import { expect, test } from "bun:test";
import { cmdRoute } from "../src/cli.ts";
import type { RouteEnvironment } from "../src/cli.ts";
import { resolveScope } from "../src/resolve.ts";
import { zshRules } from "../src/rules.ts";
import type { Action, PaneContext, Tmux, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "api", patterns: ["/w/api-service*"] },
  { name: "web", patterns: ["/w/webapp"] },
];

const STATE: TmuxState = {
  sessions: [
    { id: "$0", name: "api", windows: 1, attached: true },
    { id: "$1", name: "web", windows: 1, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "api", path: "/w/api-service" },
    { id: "@1", index: 1, session: "web", path: "/w/webapp" },
  ],
  panes: [],
};

function countingTmux(): { client: Tmux; calls: () => number } {
  let calls = 0;
  const client: Tmux = {
    state(): TmuxState {
      calls = calls + 1;
      return STATE;
    },
    paneWork(): number {
      calls = calls + 1;
      return 1;
    },
    panesInSession(): number {
      calls = calls + 1;
      return 2;
    },
    paneContext(): PaneContext {
      calls = calls + 1;
      return { session: "api", windowId: "@0" };
    },
    apply(_action: Action) {
      calls = calls + 1;
    },
    message() {
      calls = calls + 1;
    },
  };
  return { client, calls: () => calls };
}

test("route makes exactly the stated number of tmux round trips, never one more", () => {
  const { client, calls } = countingTmux();
  const writes: Record<string, string> = {};
  const env: RouteEnvironment = {
    insideTmux: true,
    paneId: "%1",
    originPath: "/w/api-service",
    cdFile: "/tmp/cd",
    execFile: "",
    write: (path: string, data: string) => {
      writes[path] = data;
    },
  };
  cmdRoute(client, "/w/webapp", SCOPES, env);
  expect(calls()).toBe(6);
  expect(writes["/tmp/cd"]).toBe("/w/api-service");
});

test("resolveScope and zshRules stay under a stated wall clock budget for a large config", () => {
  const scopes: Scope[] = [];
  for (let index = 0; index < 500; index++) {
    scopes.push({ name: `scope-${index}`, patterns: [`~/code/project-${index}*`] });
  }
  const start = performance.now();
  for (let index = 0; index < 200; index++) {
    resolveScope(`~/code/project-${index % 500}/src`, scopes);
    zshRules(`scope-${index % 500}`, scopes);
  }
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(500);
});
