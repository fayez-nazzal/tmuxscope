import { spawnSync } from "node:child_process";

let tmuxSpawn = spawnSync;

export const FIELD = "\u001f";

export type SessionInfo = { id: string; name: string; windows: number; attached: boolean };
export type WindowInfo = { id: string; index: number; session: string; path: string };
export type PaneInfo = { id: string; index: number; windowId: string; session: string; path: string; active: boolean };
export type TmuxState = { sessions: SessionInfo[]; windows: WindowInfo[]; panes: PaneInfo[] };
export type PaneContext = { session: string; windowId: string };

export type Action =
  | { kind: "new-session"; name: string; cwd: string }
  | { kind: "new-window"; session: string; cwd: string }
  | { kind: "switch"; target: string }
  | { kind: "move-window"; windowId: string; session: string }
  | { kind: "move-pane"; paneId: string; session: string }
  | { kind: "rename-session"; id: string; name: string }
  | { kind: "select-window"; windowId: string };

export interface Tmux {
  state(): TmuxState;
  paneWork(paneId: string): number;
  panesInSession(session: string): number;
  paneContext(paneId: string): PaneContext;
  apply(action: Action): void;
  message(text: string): void;
}

export function parsePaneContext(text: string): PaneContext {
  const parts = text.trim().split(FIELD);
  const session = parts[0] || "";
  const windowId = parts[1] || "";
  return { session, windowId };
}

export function parseSessions(text: string): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const parts = line.split(FIELD);
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
      const parts = line.split(FIELD);
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

export function parsePanes(text: string): PaneInfo[] {
  const panes: PaneInfo[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) {
      const parts = line.split(FIELD);
      if (parts.length >= 6) {
        const id = parts[0];
        const index = Number(parts[1]);
        const windowId = parts[2];
        const session = parts[3];
        const path = parts[4];
        const active = parts[5] === "1";
        panes.push({ id, index, windowId, session, path, active });
      }
    }
  }
  return panes;
}

export function legacyPanes(state: Pick<TmuxState, "windows">): PaneInfo[] {
  return state.windows.map((window) => ({
    id: `${window.id}:0`,
    index: 0,
    windowId: window.id,
    session: window.session,
    path: window.path,
    active: true,
  }));
}

export function paneRecords(state: TmuxState): PaneInfo[];
export function paneRecords(state: Pick<TmuxState, "windows"> & { panes?: PaneInfo[] }): PaneInfo[];
export function paneRecords(state: Pick<TmuxState, "windows"> & { panes?: PaneInfo[] }): PaneInfo[] {
  let panes: PaneInfo[];
  if ("panes" in state) {
    panes = state.panes || [];
  } else {
    panes = legacyPanes(state);
  }
  return panes;
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
  if (action.kind === "move-pane") {
    command = ["break-pane", "-d", "-s", action.paneId, "-P", "-F", "#{window_id}"];
  }
  if (action.kind === "rename-session") {
    command = ["rename-session", "-t", action.id, action.name];
  }
  if (action.kind === "select-window") {
    command = ["select-window", "-t", action.windowId];
  }
  if (command.length === 0) {
    throw new Error(`Unhandled action kind`);
  }
  return command;
}

export function run(args: string[]): string {
  const result = tmuxSpawn("tmux", args, { encoding: "utf8" });
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

export function setTmuxSpawn(spawn: typeof spawnSync): void {
  tmuxSpawn = spawn;
}

export const tmux: Tmux = {
  state(): TmuxState {
    const sessions = parseSessions(run(["list-sessions", "-F", `#{session_id}${FIELD}#{session_name}${FIELD}#{session_windows}${FIELD}#{session_attached}`]));
    const windows = parseWindows(run(["list-windows", "-a", "-F", `#{window_id}${FIELD}#{window_index}${FIELD}#{session_name}${FIELD}#{pane_current_path}`]));
    const panes = parsePanes(run(["list-panes", "-a", "-F", `#{pane_id}${FIELD}#{pane_index}${FIELD}#{window_id}${FIELD}#{session_name}${FIELD}#{pane_current_path}${FIELD}#{pane_active}`]));
    return { sessions, windows, panes };
  },
  paneWork(paneId: string): number {
    return Number(run(["show-options", "-pqv", "-t", paneId, "@tmuxscope_work"]).trim() || "0");
  },
  panesInSession(session: string): number {
    return run(["list-panes", "-s", "-t", session, "-F", "#{pane_id}"]).split("\n").filter((line) => line.length > 0).length;
  },
  paneContext(paneId: string): PaneContext {
    return parsePaneContext(run(["display-message", "-p", "-t", paneId, `#{session_name}${FIELD}#{window_id}`]));
  },
  apply(action: Action) {
    if (action.kind === "move-pane") {
      const windowId = run(commandFor(action)).trim();
      run(["move-window", "-s", windowId, "-t", `${action.session}:`]);
    } else {
      run(commandFor(action));
    }
  },
  message(text: string) {
    run(["display-message", text]);
  },
};

function isCosmetic(action: Action): boolean {
  return action.kind === "switch" || action.kind === "select-window";
}

export function applyAll(client: Tmux, actions: Action[]): string {
  let failure = "";
  for (const action of actions) {
    if (failure === "") {
      try {
        client.apply(action);
      } catch (error) {
        let detail = String(error);
        if (error instanceof Error) {
          detail = error.message;
        }
        if (!isCosmetic(action)) {
          failure = detail;
        }
      }
    }
  }
  return failure;
}
