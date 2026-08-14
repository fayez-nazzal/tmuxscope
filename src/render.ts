import type { Row } from "./ownership.ts";
import type { ConfigFinding, Report } from "./doctor.ts";
import type { Action } from "./tmux.ts";

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
    for (const ambiguous of report.ambiguous) {
      lines.push("");
      lines.push(`ambiguous session ${ambiguous.session} splits evenly, ${ambiguous.count} windows each, between ${ambiguous.candidates.join(" and ")}`);
      lines.push(`  tie broken by ${ambiguous.rule}`);
    }
    lines.push("");
    lines.push("run tmuxscope repair to fix");
  }
  return `${lines.join("\n")}\n`;
}

function renderFinding(finding: ConfigFinding): string {
  let text = "";
  if (finding.kind === "ambiguousLength") {
    text = `ambiguous length ${finding.length}: ${finding.scopes.join(", ")} have equal-length patterns, config order breaks the tie`;
  }
  if (finding.kind === "missingDirectory") {
    text = `missing directory: scope ${finding.scope} pattern ${finding.pattern} does not exist`;
  }
  if (finding.kind === "duplicateDirectory") {
    text = `duplicate directory ${finding.directory}: claimed by ${finding.scopes.join(", ")}`;
  }
  if (finding.kind === "questionMark") {
    text = `? in a pattern: scope ${finding.scope} pattern ${finding.pattern}, ? matches itself literally, not any character`;
  }
  return text;
}

export function renderConfigReport(findings: ConfigFinding[]): string {
  let text = "";
  if (findings.length > 0) {
    const lines = findings.map((finding) => renderFinding(finding));
    text = `${lines.join("\n")}\n`;
  }
  return text;
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
