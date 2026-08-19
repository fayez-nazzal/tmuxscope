import { expect, test } from "bun:test";
import { cmdOrganize } from "../src/cli.ts";
import type { Action, PaneContext, Tmux, TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "web", patterns: ["/w/webapp"] },
  { name: "api", patterns: ["/w/api-service*"] },
];

const CLEAN: TmuxState = {
  sessions: [{ id: "$0", name: "web", windows: 1, attached: true }],
  windows: [{ id: "@0", index: 1, session: "web", path: "/w/webapp" }],
  panes: [{ id: "%0", index: 0, windowId: "@0", session: "web", path: "/w/webapp", active: true }],
};

const MIXED: TmuxState = {
  sessions: [
    { id: "$0", name: "web", windows: 1, attached: true },
    { id: "$1", name: "api", windows: 1, attached: false },
  ],
  windows: [
    { id: "@0", index: 1, session: "web", path: "/w/webapp" },
    { id: "@1", index: 1, session: "api", path: "/w/api-service" },
  ],
  panes: [
    { id: "%0", index: 0, windowId: "@0", session: "web", path: "/w/webapp", active: true },
    { id: "%1", index: 1, windowId: "@0", session: "web", path: "/w/api-service", active: false },
    { id: "%2", index: 0, windowId: "@1", session: "api", path: "/w/api-service", active: true },
  ],
};

const MIXED_DESTINATION: TmuxState = {
  ...MIXED,
  windows: [...MIXED.windows, { id: "@2", index: 2, session: "api", path: "/w/api-service" }],
  panes: [
    ...MIXED.panes,
    { id: "%5", index: 1, windowId: "@1", session: "api", path: "/w/webapp", active: false },
    { id: "%3", index: 0, windowId: "@2", session: "api", path: "/w/api-service", active: true },
    { id: "%4", index: 1, windowId: "@2", session: "api", path: "/w/webapp", active: false },
  ],
};

function client(state: TmuxState, applied: Action[], setting = ""): Tmux {
  return {
    state: () => state,
    paneWork: () => 0,
    panesInSession: () => 1,
    paneContext: () => ({ session: "web", windowId: "@0" }),
    apply: (action) => applied.push(action),
    message: () => undefined,
    option: () => setting,
  };
}

function capture(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    output.push(String(chunk));
    return true;
  }) as never;
  return { output, restore: () => { process.stdout.write = original; } };
}

test("clean windows produce no pane actions", () => {
  const applied: Action[] = [];
  cmdOrganize(client(CLEAN, applied), SCOPES, false, "", false);
  expect(applied).toEqual([]);
});

test("mixed windows move only panes from the other directory group", () => {
  const applied: Action[] = [];
  cmdOrganize(client(MIXED, applied), SCOPES, false, "@0", false);
  expect(applied).toEqual([{ kind: "move-pane", paneId: "%1", session: "api", windowId: "@1" }]);
});

test("mixed destination windows are not reused", () => {
  const applied: Action[] = [];
  cmdOrganize(client(MIXED_DESTINATION, applied), SCOPES, false, "@0", false);
  expect(applied).toEqual([{ kind: "move-pane", paneId: "%1", session: "api" }]);
});

test("zero and off disable organization", () => {
  for (const setting of ["0", "off"]) {
    const applied: Action[] = [];
    cmdOrganize(client(MIXED, applied, setting), SCOPES, false, "@0", false);
    expect(applied).toEqual([]);
  }
});

test("hook mode applies actions without printing text", () => {
  const applied: Action[] = [];
  const output = capture();
  cmdOrganize(client(MIXED, applied), SCOPES, true, "@0", false);
  output.restore();
  expect(applied).toHaveLength(1);
  expect(output.output).toEqual([]);
});

test("json mode reports applied actions", () => {
  const applied: Action[] = [];
  const output = capture();
  cmdOrganize(client(MIXED, applied), SCOPES, true, "@0", true);
  output.restore();
  expect(JSON.parse(output.output.join(""))).toEqual({ actions: [{ kind: "move-pane", paneId: "%1", session: "api", windowId: "@1" }], applied: true });
});
