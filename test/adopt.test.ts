import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptPlan } from "../src/adopt.ts";
import { FIELD } from "../src/tmux.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

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
  panes: [],
};

function stubTmux(state: TmuxState): { log: string; env: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "tmuxscope-adopt-"));
  const sessionLines = state.sessions.map((session) => [session.id, session.name, String(session.windows), "0"].join(FIELD));
  const windowLines = state.windows.map((window) => [window.id, String(window.index), window.session, window.path].join(FIELD));
  const paneLines = state.windows.map((window) => [`${window.id}:0`, "0", window.id, window.session, window.path, "1"].join(FIELD));
  writeFileSync(join(dir, "sessions"), `${sessionLines.join("\n")}\n`);
  writeFileSync(join(dir, "windows"), `${windowLines.join("\n")}\n`);
  writeFileSync(join(dir, "panes"), `${paneLines.join("\n")}\n`);
  const config = join(dir, "scopes.conf");
  writeFileSync(config, SCOPES.map((scope) => `${scope.name} = ${scope.patterns.join(" ")}`).join("\n"));
  const log = join(dir, "log");
  writeFileSync(log, "");
  const stub = join(dir, "tmux");
  writeFileSync(stub, `#!/bin/sh\ncase "$1" in\n  list-sessions) cat ${dir}/sessions ;;\n  list-windows) cat ${dir}/windows ;;\n  list-panes) cat ${dir}/panes ;;\n  *) echo "$@" >> ${log} ;;\nesac\n`);
  chmodSync(stub, 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMUXSCOPE_CONFIG: config } as Record<string, string>;
  return { log, env };
}

function runAdopt(state: TmuxState, sessionId: string): string {
  const stub = stubTmux(state);
  const result = Bun.spawnSync(["bun", CLI, "adopt", sessionId], { env: stub.env });
  expect(result.exitCode).toBe(0);
  return readFileSync(stub.log, "utf8");
}

test("a new session in a free scope is renamed to the scope", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "scratch", windows: [{ id: "@9", path: "/w/toolkit" }], scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([{ kind: "rename-session", id: "$9", name: "tools" }]);
  expect(plan.message).toBe("renamed scratch to tools");
});

test("the windows of the new session itself never make it look like the scope already has an owner", () => {
  const lonely: TmuxState = {
    sessions: [{ id: "$9", name: "scratch", windows: 2, attached: false }],
    windows: [
      { id: "@8", index: 1, session: "scratch", path: "/w/toolkit" },
      { id: "@9", index: 2, session: "scratch", path: "/w/toolkit/app" },
    ],
    panes: [],
  };
  const windows = [{ id: "@8", path: "/w/toolkit" }, { id: "@9", path: "/w/toolkit/app" }];
  const plan = adoptPlan({ sessionId: "$9", sessionName: "scratch", windows, scopes: SCOPES, state: lonely, attached: false });
  expect(plan.actions).toEqual([{ kind: "rename-session", id: "$9", name: "tools" }]);
});

test("an attached session in a taken scope is left alone so the seat of the user survives", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windows: [{ id: "@9", path: "/w/webapp/app" }], scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([]);
  expect(plan.message).toBe("web already owns web, leaving web2 attached");
});

test("a detached session in a taken scope is merged into the owner without switching focus", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windows: [{ id: "@9", path: "/w/webapp/app" }], scopes: SCOPES, state: STATE, attached: false });
  expect(plan.actions).toEqual([{ kind: "move-window", windowId: "@9", session: "web" }]);
  expect(plan.message).toBe("merged into web");
});

test("a merge takes every window of the restored session, not just the first", () => {
  const windows = [{ id: "@8", path: "/w/webapp" }, { id: "@9", path: "/w/webapp/app" }];
  const plan = adoptPlan({ sessionId: "$9", sessionName: "web2", windows, scopes: SCOPES, state: STATE, attached: false });
  expect(plan.actions).toEqual([
    { kind: "move-window", windowId: "@8", session: "web" },
    { kind: "move-window", windowId: "@9", session: "web" },
  ]);
});

test("a session already named after its scope is left alone", () => {
  const plan = adoptPlan({ sessionId: "$0", sessionName: "web", windows: [{ id: "@0", path: "/w/webapp" }], scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([]);
  expect(plan.message).toBe("");
});

test("a session named after its scope survives an origin window that still shows the new path", () => {
  const afterRoute: TmuxState = {
    sessions: [
      { id: "$0", name: "api", windows: 1, attached: true },
      { id: "$7", name: "web", windows: 1, attached: false },
    ],
    windows: [
      { id: "@0", index: 1, session: "api", path: "/w/webapp" },
      { id: "@7", index: 1, session: "web", path: "/w/webapp" },
    ],
    panes: [],
  };
  const plan = adoptPlan({ sessionId: "$7", sessionName: "web", windows: [{ id: "@7", path: "/w/webapp" }], scopes: SCOPES, state: afterRoute, attached: false });
  expect(plan.actions).toEqual([]);
  expect(plan.message).toBe("");
});

test("an unmatched path becomes the misc session", () => {
  const plan = adoptPlan({ sessionId: "$9", sessionName: "notes", windows: [{ id: "@9", path: "/w/downloads" }], scopes: SCOPES, state: STATE, attached: true });
  expect(plan.actions).toEqual([{ kind: "rename-session", id: "$9", name: "misc" }]);
  expect(plan.message).toBe("renamed notes to misc");
});

test("adopt renames a new session through the real command", () => {
  const log = runAdopt(STATE, "$9");
  expect(log).toContain("rename-session -t $9 tools");
});

test("adopt leaves the session route just created where it is", () => {
  const afterRoute: TmuxState = {
    sessions: [
      { id: "$0", name: "api", windows: 1, attached: true },
      { id: "$7", name: "web", windows: 1, attached: false },
    ],
    windows: [
      { id: "@0", index: 1, session: "api", path: "/w/webapp" },
      { id: "@7", index: 1, session: "web", path: "/w/webapp" },
    ],
    panes: [],
  };
  expect(runAdopt(afterRoute, "$7")).toBe("");
});

test("adopt does nothing for a session id that is gone", () => {
  expect(runAdopt(STATE, "$404")).toBe("");
});
