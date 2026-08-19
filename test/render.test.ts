import { expect, test } from "bun:test";
import { renderAction, renderList, renderDoctor } from "../src/render.ts";
import { listRows } from "../src/ownership.ts";
import { doctorReport } from "../src/doctor.ts";
import type { TmuxState } from "../src/tmux.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "web", patterns: ["/w/webapp"] },
  { name: "tools", patterns: ["/w/toolkit"] },
];

const STATE: TmuxState = {
  sessions: [{ id: "$0", name: "web", windows: 2, attached: true }],
  windows: [{ id: "@0", index: 1, session: "web", path: "/w/webapp" }],
  panes: [],
};

test("listRows covers every configured scope plus misc", () => {
  const rows = listRows(STATE, SCOPES);
  expect(rows.map((row) => row.scope)).toEqual(["web", "tools", "misc"]);
  expect(rows[0]).toEqual({ scope: "web", session: "web", windows: 2, attached: true, patterns: ["/w/webapp"] });
  expect(rows[1]).toMatchObject({ scope: "tools", session: "", windows: 0, attached: false });
});

test("renderList marks the attached session and dashes the empty ones", () => {
  const text = renderList(listRows(STATE, SCOPES));
  expect(text).toContain("SCOPE");
  expect(text).toContain("web •");
  expect(text).toMatch(/tools\s+-\s+-/);
});

test("renderDoctor says all clean when there is nothing to fix", () => {
  expect(renderDoctor(doctorReport(STATE, SCOPES))).toContain("all clean");
});

test("renderDoctor names panes that belong to different directory groups", () => {
  const state: TmuxState = {
    sessions: [{ id: "$0", name: "web", windows: 1, attached: true }],
    windows: [{ id: "@0", index: 1, session: "web", path: "/w/webapp" }],
    panes: [
      { id: "%0", index: 0, windowId: "@0", session: "web", path: "/w/webapp", active: true },
      { id: "%1", index: 1, windowId: "@0", session: "web", path: "/w/toolkit", active: false },
    ],
  };
  const text = renderDoctor(doctorReport(state, SCOPES));
  expect(text).toContain("mixed window @0 contains panes from multiple directories");
  expect(text).toContain("pane %1  /w/toolkit");
});

test("renderAction names a pane move destination", () => {
  expect(renderAction({ kind: "move-pane", paneId: "%1", session: "api" })).toBe("move-pane %1 to api");
});
