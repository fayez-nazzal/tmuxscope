import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { sessionForScope } from "./plan.ts";
import type { Report } from "./plan.ts";
import type { Action, TmuxState } from "./tmux.ts";

export type Row = { scope: string; session: string; windows: number; attached: boolean; patterns: string[] };

export function listRows(state: TmuxState, scopes: Scope[]): Row[] {
  const rows: Row[] = [];
  const names = [...scopes.map((scope) => scope.name), MISC];
  for (const name of names) {
    const owner = sessionForScope(state, scopes, name);
    const scope = scopes.find((entry) => entry.name === name);
    let patterns: string[] = [];
    if (scope) {
      patterns = scope.patterns;
    }
    let session = "";
    let windows = 0;
    let attached = false;
    if (owner) {
      const info = state.sessions.find((entry) => entry.name === owner);
      session = owner;
      if (info) {
        windows = info.windows;
        attached = info.attached;
      }
    }
    rows.push({ scope: name, session, windows, attached, patterns });
  }
  return rows;
}

function pad(text: string, width: number): string {
  return text.padEnd(width, " ");
}

export function renderList(rows: Row[]): string {
  const lines: string[] = [];
  const cells = rows.map((row) => {
    let session = "-";
    let windows = "-";
    if (row.session) {
      session = row.session;
      windows = String(row.windows);
    }
    if (row.attached) {
      session = `${session} •`;
    }
    let patterns = row.patterns.join(" ");
    if (patterns.length === 0) {
      patterns = "everything else";
    }
    return { scope: row.scope, session, windows, patterns };
  });
  const scopeLengths = cells.map((cell) => cell.scope.length);
  const sessionLengths = cells.map((cell) => cell.session.length);
  const scopeWidth = Math.max(5, ...scopeLengths) + 2;
  const sessionWidth = Math.max(7, ...sessionLengths) + 2;
  const windowWidth = 9;
  lines.push(`${pad("SCOPE", scopeWidth)}${pad("SESSION", sessionWidth)}${pad("WINDOWS", windowWidth)}PATTERNS`);
  for (const cell of cells) {
    lines.push(`${pad(cell.scope, scopeWidth)}${pad(cell.session, sessionWidth)}${pad(cell.windows, windowWidth)}${cell.patterns}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderDoctor(report: Report): string {
  const lines: string[] = [];
  if (report.problems === 0) {
    lines.push("all clean");
  } else {
    lines.push(`${report.problems} problems`);
    for (const mixed of report.mixed) {
      const scopeNames = mixed.windows.map((window) => window.scope);
      const distinct = new Set(scopeNames);
      lines.push("");
      lines.push(`mixed session ${mixed.session} holds ${distinct.size} scopes`);
      for (const window of mixed.windows) {
        lines.push(`  window ${window.index}  ${pad(window.path, 32)}${window.scope}`);
      }
    }
    for (const split of report.split) {
      lines.push("");
      lines.push(`split scope ${split.scope} has ${split.sessions.length} sessions`);
      for (const session of split.sessions) {
        lines.push(`  ${session}`);
      }
    }
    lines.push("");
    lines.push("run tmuxscope repair to fix");
  }
  return `${lines.join("\n")}\n`;
}

export function renderAction(action: Action): string {
  let text = "";
  if (action.kind === "new-session") {
    text = `new-session ${action.name} at ${action.cwd}`;
  }
  if (action.kind === "new-window") {
    text = `new-window in ${action.session} at ${action.cwd}`;
  }
  if (action.kind === "switch") {
    text = `switch to ${action.target}`;
  }
  if (action.kind === "move-window") {
    text = `move-window ${action.windowId} to ${action.session}`;
  }
  if (action.kind === "rename-session") {
    text = `rename-session ${action.id} to ${action.name}`;
  }
  if (action.kind === "select-window") {
    text = `select-window ${action.windowId}`;
  }
  return text;
}
