import { expect, test } from "bun:test";
import { commandFor, parseSessions, parseWindows } from "../src/tmux.ts";

test("parseSessions reads id, name, window count and attached flag", () => {
  const text = "$0\tapi\t3\t1\n$1\tmain\t1\t0\n";
  expect(parseSessions(text)).toEqual([
    { id: "$0", name: "api", windows: 3, attached: true },
    { id: "$1", name: "main", windows: 1, attached: false },
  ]);
});

test("parseWindows reads id, index, session and path", () => {
  const text = "@4\t2\tapi\t/Users/x/code/api-service\n";
  expect(parseWindows(text)).toEqual([
    { id: "@4", index: 2, session: "api", path: "/Users/x/code/api-service" },
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
