import { expect, test } from "bun:test";
import { cmdRepair } from "../src/cli.ts";
import type { Action, PaneContext, Tmux, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "db", patterns: ["/w/db-service"] },
  { name: "web", patterns: ["/w/webapp"] },
  { name: "api", patterns: ["/w/api-service*"] },
];

const MIXED: TmuxState = {
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
  panes: [],
};

function fakeExit(): { calls: number[]; restore: () => void } {
  const original = process.exit;
  const calls: number[] = [];
  process.exit = ((code?: number) => {
    calls.push(code || 0);
    throw new Error(`exit ${code}`);
  }) as never;
  return {
    calls,
    restore: () => {
      process.exit = original;
    },
  };
}

function capturedStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as never;
  return {
    lines,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

test("a fake whose third apply throws prints only the landed actions, names the failure, and exits without success lines for actions it never ran", () => {
  const applied: Action[] = [];
  let calls = 0;
  const client: Tmux = {
    state(): TmuxState {
      return MIXED;
    },
    paneWork(): number {
      return 0;
    },
    panesInSession(): number {
      return 1;
    },
    paneContext(): PaneContext {
      return { session: "db", windowId: "@0" };
    },
    apply(action: Action) {
      calls = calls + 1;
      if (calls === 3) {
        throw new Error("tmux move-window failed: no current client");
      }
      applied.push(action);
    },
    message() {},
  };
  const out = capturedStdout();
  const exit = fakeExit();
  let threw = false;
  try {
    cmdRepair(client, SCOPES, false, false);
  } catch (error) {
    threw = true;
  }
  out.restore();
  exit.restore();
  expect(threw).toBe(true);
  expect(exit.calls).toEqual([4]);
  expect(out.lines.length).toBe(applied.length);
  expect(applied.length).toBeGreaterThan(0);
});

test("a fixable state ends clean and exits with no error", () => {
  const state: TmuxState = { sessions: [...MIXED.sessions], windows: [...MIXED.windows], panes: [] };
  const client: Tmux = {
    state(): TmuxState {
      return state;
    },
    paneWork(): number {
      return 0;
    },
    panesInSession(): number {
      return 1;
    },
    paneContext(): PaneContext {
      return { session: "db", windowId: "@0" };
    },
    apply(action: Action) {
      if (action.kind === "new-session") {
        state.sessions.push({ id: "$new", name: action.name, windows: 0, attached: false });
        state.windows.push({ id: "@new", index: 1, session: action.name, path: action.cwd });
      }
      if (action.kind === "rename-session") {
        const session = state.sessions.find((entry) => entry.id === action.id)!;
        for (const window of state.windows) {
          if (window.session === session.name) {
            window.session = action.name;
          }
        }
        session.name = action.name;
      }
      if (action.kind === "move-window") {
        const window = state.windows.find((entry) => entry.id === action.windowId)!;
        window.session = action.session;
      }
    },
    message() {},
  };
  const out = capturedStdout();
  const exit = fakeExit();
  let threw = false;
  try {
    cmdRepair(client, SCOPES, false, false);
  } catch (error) {
    threw = true;
  }
  out.restore();
  exit.restore();
  expect(threw).toBe(false);
  expect(exit.calls).toEqual([]);
});
