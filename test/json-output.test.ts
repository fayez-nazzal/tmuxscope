import { expect, test } from "bun:test";
import { cmdDoctor, cmdList, cmdRepair } from "../src/cli.ts";
import type { Action, PaneContext, Tmux, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "api", patterns: ["/w/api-service*"] },
  { name: "web", patterns: ["/w/webapp"] },
];

const MIXED: TmuxState = {
  sessions: [
    { id: "$0", name: "web", windows: 2, attached: false },
    { id: "$1", name: "api", windows: 1, attached: true },
  ],
  windows: [
    { id: "@0", index: 1, session: "web", path: "/w/webapp" },
    { id: "@1", index: 2, session: "web", path: "/w/api-service" },
    { id: "@2", index: 1, session: "api", path: "/w/api-service" },
  ],
};

function fakeTmux(state: TmuxState, applied: Action[]): Tmux {
  return {
    state(): TmuxState {
      return state;
    },
    paneWork(): number {
      return 1;
    },
    panesInSession(): number {
      return 1;
    },
    paneContext(): PaneContext {
      return { session: "web", windowId: "@0" };
    },
    apply(action: Action) {
      applied.push(action);
    },
    message() {},
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

function jsonFrom(run: () => void): { payload: unknown; exits: number[] } {
  const exit = fakeExit();
  const captured = capturedStdout();
  try {
    run();
  } catch (error) {
    if (exit.calls.length === 0) {
      throw error;
    }
  } finally {
    captured.restore();
    exit.restore();
  }
  return { payload: JSON.parse(captured.lines.join("")), exits: exit.calls };
}

test("list --json prints the rows instead of the table", () => {
  const { payload } = jsonFrom(() => {
    cmdList(fakeTmux(MIXED, []), SCOPES, true);
  });
  const rows = (payload as { rows: { scope: string; session: string; windows: number; patterns: string[] }[] }).rows;
  expect(rows[0]).toMatchObject({ scope: "api", session: "api", windows: 1, patterns: ["/w/api-service*"] });
  expect(rows.map((row) => row.scope)).toContain("web");
});

test("list without --json still prints the table", () => {
  const captured = capturedStdout();
  cmdList(fakeTmux(MIXED, []), SCOPES, false);
  captured.restore();
  expect(captured.lines.join("")).toContain("api");
  expect(captured.lines.join("")[0]).not.toBe("{");
});

test("doctor --json reports the same problems the table reports", () => {
  const { payload, exits } = jsonFrom(() => {
    cmdDoctor(fakeTmux(MIXED, []), SCOPES, true);
  });
  const report = payload as { problems: number; mixed: { session: string }[]; config: unknown[] };
  expect(exits).toEqual([1]);
  expect(report.problems).toBeGreaterThan(0);
  expect(report.mixed[0]).toMatchObject({ session: "web" });
  expect(report.config).toContainEqual({ kind: "missingDirectory", scope: "web", pattern: "/w/webapp" });
});

test("repair --json --dry-run lists the actions and applies nothing", () => {
  const applied: Action[] = [];
  const { payload } = jsonFrom(() => {
    cmdRepair(fakeTmux(MIXED, applied), SCOPES, true, true);
  });
  const plan = payload as { actions: Action[]; unsatisfiable: string[]; applied: boolean };
  expect(plan.applied).toBe(false);
  expect(plan.unsatisfiable).toEqual([]);
  expect(plan.actions.length).toBeGreaterThan(0);
  expect(applied).toEqual([]);
});

test("repair --json on a clean tree reports applied with no actions", () => {
  const clean: TmuxState = { sessions: [{ id: "$0", name: "web", windows: 1, attached: false }], windows: [{ id: "@0", index: 1, session: "web", path: "/w/webapp" }] };
  const applied: Action[] = [];
  const { payload } = jsonFrom(() => {
    cmdRepair(fakeTmux(clean, applied), SCOPES, false, true);
  });
  const result = payload as { actions: Action[]; applied: boolean; after: { problems: number } };
  expect(result).toMatchObject({ actions: [], applied: true });
  expect(result.after.problems).toBe(0);
  expect(applied).toEqual([]);
});
