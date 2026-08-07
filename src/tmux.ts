import { spawnSync } from "node:child_process";

export type SessionInfo = { id: string; name: string; windows: number; attached: boolean };
export type WindowInfo = { id: string; index: number; session: string; path: string };
export type TmuxState = { sessions: SessionInfo[]; windows: WindowInfo[] };
export type PaneContext = { session: string; windowId: string };

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
  paneContext(paneId: string): PaneContext;
  apply(action: Action): void;
  message(text: string): void;
}

export function parsePaneContext(text: string): PaneContext {
  const parts = text.trim().split("\t");
  const session = parts[0] || "";
  const windowId = parts[1] || "";
  return { session, windowId };
}

export function parseSessions(text: string): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const parts = line.split("\t");
      if (parts.length >= 4) {
        const id = parts[0];
        const name = parts[1];
        const windows = Number(parts[2]);
        const attached = parts[3] === "1";
        sessions.push({ id, name, windows, attached });
      }
    }
  }
  return sessions;
}

export function parseWindows(text: string): WindowInfo[] {
  const windows: WindowInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const parts = line.split("\t");
      if (parts.length >= 4) {
        const id = parts[0];
        const index = Number(parts[1]);
        const session = parts[2];
        const path = parts[3];
        windows.push({ id, index, session, path });
      }
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
  if (command.length === 0) {
    throw new Error(`Unhandled action kind`);
  }
  return command;
}

export function run(args: string[]): string {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  let output = "";
  if (result.status === 0 && typeof result.stdout === "string") {
    output = result.stdout;
  }
  if (result.status !== 0) {
    let stderr = "";
    if (typeof result.stderr === "string") {
      stderr = result.stderr;
    }
    if (stderr.includes("no server running")) {
      output = "";
    } else {
      throw new Error(`tmux ${args.join(" ")} failed: ${stderr}`);
    }
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
  paneContext(paneId: string): PaneContext {
    return parsePaneContext(run(["display-message", "-p", "-t", paneId, "#{session_name}\t#{window_id}"]));
  },
  apply(action: Action) {
    run(commandFor(action));
  },
  message(text: string) {
    run(["display-message", text]);
  },
};
