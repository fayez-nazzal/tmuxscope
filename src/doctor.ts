import type { Scope } from "./scopes.ts";
import { normalizePattern, resolveScope } from "./resolve.ts";
import { ascendingName, majorityForSession } from "./ownership.ts";
import { directoryGroup } from "./directory-groups.ts";
import { paneRecords } from "./tmux.ts";
import type { TmuxState } from "./tmux.ts";

export type Mixed = { session: string; windows: { index: number; path: string; scope: string }[] };
export type Split = { scope: string; sessions: string[] };
export type Ambiguous = { session: string; candidates: string[]; count: number; rule: string };
export type MixedPane = { id: string; group: string };
export type MixedPanes = { windowId: string; panes: MixedPane[] };
export type Report = { mixed: Mixed[]; split: Split[]; ambiguous: Ambiguous[]; mixedPanes: MixedPanes[]; problems: number };

function ascendingWindow(left: { index: number; id: string }, right: { index: number; id: string }): number {
  let order = left.index - right.index;
  if (order === 0) {
    order = ascendingName(left.id, right.id);
  }
  return order;
}

export function doctorReport(state: TmuxState, scopes: Scope[]): Report {
  const report: Report = { mixed: [], split: [], ambiguous: [], mixedPanes: [], problems: 0 };
  const orderedSessions = state.sessions.slice().sort((left, right) => ascendingName(left.name, right.name));
  for (const session of orderedSessions) {
    const windows = state.windows.filter((window) => window.session === session.name).sort(ascendingWindow);
    const detailed = windows.map((window) => ({ index: window.index, path: window.path, scope: resolveScope(window.path, scopes).scope }));
    const distinct = new Set(detailed.map((window) => window.scope));
    if (distinct.size > 1) {
      report.mixed.push({ session: session.name, windows: detailed });
    }
  }
  const holders = new Map<string, string[]>();
  for (const session of orderedSessions) {
    const majority = majorityForSession(state, scopes, session.name);
    if (majority.tiedWith.length > 0) {
      report.ambiguous.push({ session: session.name, candidates: majority.tiedWith, count: majority.count, rule: majority.rule });
    }
    const scope = majority.scope;
    const names = holders.get(scope);
    let group: string[] = [];
    if (names) {
      group = names;
    }
    group.push(session.name);
    holders.set(scope, group);
  }
  const scopeNames = [...holders.keys()].sort(ascendingName);
  for (const scope of scopeNames) {
    const sessions = holders.get(scope)!.slice().sort(ascendingName);
    if (sessions.length > 1) {
      report.split.push({ scope, sessions });
    }
  }
  const windows = state.windows.slice().sort(ascendingWindow);
  const panes = paneRecords(state);
  for (const window of windows) {
    const records = panes.filter((pane) => pane.windowId === window.id).sort((left, right) => left.index - right.index || ascendingName(left.id, right.id));
    const groups = records.map((pane) => ({ id: pane.id, group: directoryGroup(pane.path, scopes).key }));
    const distinct = new Set(groups.map((pane) => pane.group));
    if (distinct.size > 1) {
      report.mixedPanes.push({ windowId: window.id, panes: groups });
    }
  }
  report.problems = report.mixed.length + report.split.length + report.ambiguous.length + report.mixedPanes.length;
  return report;
}

export type ConfigFinding =
  | { kind: "ambiguousLength"; scopes: string[]; length: number }
  | { kind: "missingDirectory"; scope: string; pattern: string }
  | { kind: "duplicateDirectory"; scopes: string[]; directory: string }
  | { kind: "questionMark"; scope: string; pattern: string };

export type ConfigProbe = { exists: (path: string) => boolean };

function groupsWithMoreThanOneScope<Key>(entries: { scope: string; key: Key }[]): Map<Key, string[]> {
  const grouped = new Map<Key, string[]>();
  for (const entry of entries) {
    const names = grouped.get(entry.key);
    let group: string[] = [];
    if (names) {
      group = names;
    }
    if (!group.includes(entry.scope)) {
      group.push(entry.scope);
    }
    grouped.set(entry.key, group);
  }
  for (const [key, names] of grouped) {
    if (names.length < 2) {
      grouped.delete(key);
    }
  }
  return grouped;
}

function ambiguousLengthFindings(scopes: Scope[]): ConfigFinding[] {
  const entries = scopes.flatMap((scope) => scope.patterns.map((pattern) => ({ scope: scope.name, key: normalizePattern(pattern).length })));
  const grouped = groupsWithMoreThanOneScope(entries);
  const lengths = [...grouped.keys()].sort((left, right) => left - right);
  return lengths.map((length) => ({ kind: "ambiguousLength" as const, scopes: grouped.get(length)!.slice().sort(ascendingName), length }));
}

function duplicateDirectoryFindings(scopes: Scope[]): ConfigFinding[] {
  const entries = scopes.flatMap((scope) => scope.patterns.map((pattern) => ({ scope: scope.name, key: normalizePattern(pattern) })));
  const grouped = groupsWithMoreThanOneScope(entries);
  const directories = [...grouped.keys()].sort(ascendingName);
  return directories.map((directory) => ({ kind: "duplicateDirectory" as const, scopes: grouped.get(directory)!.slice().sort(ascendingName), directory }));
}

function missingDirectoryFindings(scopes: Scope[], probe: ConfigProbe): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      if (!pattern.includes("*") && !probe.exists(normalizePattern(pattern))) {
        findings.push({ kind: "missingDirectory", scope: scope.name, pattern });
      }
    }
  }
  return findings;
}

function questionMarkFindings(scopes: Scope[]): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      if (pattern.includes("?")) {
        findings.push({ kind: "questionMark", scope: scope.name, pattern });
      }
    }
  }
  return findings;
}

export function configReport(scopes: Scope[], probe: ConfigProbe): ConfigFinding[] {
  return [
    ...ambiguousLengthFindings(scopes),
    ...missingDirectoryFindings(scopes, probe),
    ...duplicateDirectoryFindings(scopes),
    ...questionMarkFindings(scopes),
  ];
}
