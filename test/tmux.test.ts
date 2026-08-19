import { expect, test } from "bun:test";
import { spawnSync as realSpawnSync } from "node:child_process";
import { commandFor, FIELD, legacyPanes, parsePaneContext, parsePanes, parseSessions, parseWindows, setTmuxSpawn, tmux } from "../src/tmux.ts";
import type { TmuxState } from "../src/tmux.ts";

test("parseSessions reads id, name, window count and attached flag", () => {
  const text = `$0${FIELD}api${FIELD}3${FIELD}1\n$1${FIELD}main${FIELD}1${FIELD}0\n`;
  expect(parseSessions(text)).toEqual([
    { id: "$0", name: "api", windows: 3, attached: true },
    { id: "$1", name: "main", windows: 1, attached: false },
  ]);
});

test("parseWindows reads id, index, session and path", () => {
  const text = `@4${FIELD}2${FIELD}api${FIELD}/Users/x/code/api-service\n`;
  expect(parseWindows(text)).toEqual([
    { id: "@4", index: 2, session: "api", path: "/Users/x/code/api-service" },
  ]);
});

test("parsePanes reads pane identity, window, session, path and active state", () => {
  const text = `%1${FIELD}0${FIELD}@4${FIELD}api${FIELD}/Users/x/code/api-service${FIELD}1\n`;
  expect(parsePanes(text)).toEqual([
    { id: "%1", index: 0, windowId: "@4", session: "api", path: "/Users/x/code/api-service", active: true },
  ]);
});

test("legacyPanes synthesizes one active pane for each window fixture", () => {
  const state: TmuxState = {
    sessions: [],
    windows: [{ id: "@4", index: 2, session: "api", path: "/Users/x/code/api-service" }],
    panes: [],
  };
  expect(legacyPanes(state)).toEqual([
    { id: "@4:0", index: 0, windowId: "@4", session: "api", path: "/Users/x/code/api-service", active: true },
  ]);
});

test("commandFor builds a new session command", () => {
  expect(commandFor({ kind: "new-session", name: "web", cwd: "/Users/x/webapp" })).toEqual([
    "new-session", "-d", "-s", "web", "-c", "/Users/x/webapp",
  ]);
});

test("commandFor builds a new window command", () => {
  expect(commandFor({ kind: "new-window", session: "web", cwd: "/Users/x/webapp/app" })).toEqual([
    "new-window", "-t", "web:", "-c", "/Users/x/webapp/app",
  ]);
});

test("commandFor builds a switch, a move and a rename", () => {
  expect(commandFor({ kind: "switch", target: "web" })).toEqual(["switch-client", "-t", "web"]);
  expect(commandFor({ kind: "move-window", windowId: "@4", session: "web" })).toEqual(["move-window", "-s", "@4", "-t", "web:"]);
  expect(commandFor({ kind: "rename-session", id: "$2", name: "tools" })).toEqual(["rename-session", "-t", "$2", "tools"]);
});

test("commandFor joins a pane to an existing destination window", () => {
  expect(commandFor({ kind: "move-pane", paneId: "%4", session: "web", windowId: "@8" })).toEqual([
    "join-pane", "-d", "-s", "%4", "-t", "@8",
  ]);
});

test("commandFor breaks a pane into a detached window and prints its id", () => {
  expect(commandFor({ kind: "move-pane", paneId: "%4", session: "web" })).toEqual([
    "break-pane", "-d", "-s", "%4", "-P", "-F", "#{window_id}",
  ]);
});

test("tmux apply moves a broken pane window into the destination session", () => {
  const calls: string[][] = [];
  setTmuxSpawn(((file, args) => {
    calls.push([file, ...args]);
    return { status: 0, stdout: args[0] === "break-pane" ? "@new\n" : "", stderr: "" } as any;
  }) as typeof realSpawnSync);
  try {
    tmux.apply({ kind: "move-pane", paneId: "%4", session: "web" });
  } finally {
    setTmuxSpawn(realSpawnSync);
  }
  expect(calls).toEqual([
    ["tmux", "break-pane", "-d", "-s", "%4", "-P", "-F", "#{window_id}"],
    ["tmux", "move-window", "-s", "@new", "-t", "web:"],
  ]);
});

test("tmux apply joins a pane to an existing destination window", () => {
  const calls: string[][] = [];
  setTmuxSpawn(((file, args) => {
    calls.push([file, ...args]);
    return { status: 0, stdout: "", stderr: "" } as any;
  }) as typeof realSpawnSync);
  try {
    tmux.apply({ kind: "move-pane", paneId: "%4", session: "web", windowId: "@8" });
  } finally {
    setTmuxSpawn(realSpawnSync);
  }
  expect(calls).toEqual([["tmux", "join-pane", "-d", "-s", "%4", "-t", "@8"]]);
});

test("parseSessions skips incomplete lines", () => {
  const text = `$0${FIELD}api${FIELD}3${FIELD}1\n$1${FIELD}main\n`;
  expect(parseSessions(text)).toEqual([
    { id: "$0", name: "api", windows: 3, attached: true },
  ]);
});

test("parseWindows skips incomplete lines", () => {
  const text = `@4${FIELD}2${FIELD}api${FIELD}/path\n@5${FIELD}3\n`;
  expect(parseWindows(text)).toEqual([
    { id: "@4", index: 2, session: "api", path: "/path" },
  ]);
});

test("commandFor throws on unknown action kind", () => {
  const action: any = { kind: "unknown" };
  expect(() => commandFor(action)).toThrow();
});

test("parsePaneContext reads the session and window of a pane", () => {
  expect(parsePaneContext(`api${FIELD}@4\n`)).toEqual({ session: "api", windowId: "@4" });
});

test("parsePaneContext defaults to empty strings on a blank result", () => {
  expect(parsePaneContext("")).toEqual({ session: "", windowId: "" });
});

test("a tab inside a path no longer truncates it", () => {
  const text = `@4${FIELD}2${FIELD}api${FIELD}/w/odd\tname/src\n`;
  expect(parseWindows(text)).toEqual([
    { id: "@4", index: 2, session: "api", path: "/w/odd\tname/src" },
  ]);
});
