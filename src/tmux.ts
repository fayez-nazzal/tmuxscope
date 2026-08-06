import { spawnSync } from "node:child_process";

export type SessionInfo = { id: string; name: string; windows: number; attached: boolean };
export type WindowInfo = { id: string; index: number; session: string; path: string };
export type TmuxState = { sessions: SessionInfo[]; windows: WindowInfo[] };

export type Action =
  | { kind: "new-session"; name: string; cwd: string }
  | { kind: "new-window"; session: string; cwd: string }
  | { kind: "switch"; target: string }
  | { kind: "move-window"; windowId: string; session: string }
  | { kind: "rename-session"; id: string; name: string };

export interface Tmux {
  state(): TmuxState;
  paneWork(paneId: string): number;
  panesInSession(session: string): number;
  apply(action: Action): void;
  message(text: string): void;
}

export function parseSessions(text: string): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const [id, name, windows, attached] = line.split("\t");
      sessions.push({ id: id!, name: name!, windows: Number(windows), attached: attached === "1" });
    }
  }
  return sessions;
}

export function parseWindows(text: string): WindowInfo[] {
  const windows: WindowInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const [id, index, session, path] = line.split("\t");
      windows.push({ id: id!, index: Number(index), session: session!, path: path! });
    }
  }
  return windows;
}

export function commandFor(action: Action): string[] {
  let command: string[] = [];
  if (action.kind === "new-session") {
    command = ["new-session", "-d", "-s", action.name, "-c", action.cwd];
  }
  if (action.kind === "new-window") {
    command = ["new-window", "-t", `${action.session}:`, "-c", action.cwd];
  }
  if (action.kind === "switch") {
    command = ["switch-client", "-t", action.target];
  }
  if (action.kind === "move-window") {
    command = ["move-window", "-s", action.windowId, "-t", `${action.session}:`];
  }
  if (action.kind === "rename-session") {
    command = ["rename-session", "-t", action.id, action.name];
  }
  return command;
}

function run(args: string[]): string {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  let output = "";
  if (result.status === 0 && typeof result.stdout === "string") {
    output = result.stdout;
  }
  return output;
}

export const tmux: Tmux = {
  state(): TmuxState {
    const sessions = parseSessions(run(["list-sessions", "-F", "#{session_id}\t#{session_name}\t#{session_windows}\t#{session_attached}"]));
    const windows = parseWindows(run(["list-windows", "-a", "-F", "#{window_id}\t#{window_index}\t#{session_name}\t#{pane_current_path}"]));
    return { sessions, windows };
  },
  paneWork(paneId: string): number {
    return Number(run(["show-options", "-pqv", "-t", paneId, "@tmuxscope_work"]).trim() || "0");
  },
  panesInSession(session: string): number {
    return run(["list-panes", "-s", "-t", session, "-F", "#{pane_id}"]).split("\n").filter((line) => line.length > 0).length;
  },
  apply(action: Action) {
    run(commandFor(action));
  },
  message(text: string) {
    run(["display-message", text]);
  },
};
