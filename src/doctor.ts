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

type PatternEntry = { scope: string; pattern: string; length: number };

function globPatternsOverlap(left: string, right: string): boolean {
  const states: [number, number][] = [[0, 0]];
  const seen = new Set<string>();
  let overlaps = false;
  for (let index = 0; index < states.length; index++) {
    const state = states[index]!;
    const leftIndex = state[0];
    const rightIndex = state[1];
    const key = `${leftIndex}:${rightIndex}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (leftIndex === left.length && rightIndex === right.length) {
        overlaps = true;
      }
      if (leftIndex < left.length && left[leftIndex] === "*") {
        states.push([leftIndex + 1, rightIndex]);
      }
      if (rightIndex < right.length && right[rightIndex] === "*") {
        states.push([leftIndex, rightIndex + 1]);
      }
      if (leftIndex < left.length && rightIndex < right.length) {
        const leftCharacter = left[leftIndex]!;
        const rightCharacter = right[rightIndex]!;
        if (leftCharacter === "*" && rightCharacter !== "*") {
          states.push([leftIndex, rightIndex + 1]);
        }
        if (leftCharacter !== "*" && rightCharacter === "*") {
          states.push([leftIndex + 1, rightIndex]);
        }
        if (leftCharacter !== "*" && rightCharacter !== "*" && leftCharacter === rightCharacter) {
          states.push([leftIndex + 1, rightIndex + 1]);
        }
      }
    }
  }
  return overlaps;
}

function patternsOverlap(left: string, right: string): boolean {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const segmentCount = Math.min(leftSegments.length, rightSegments.length);
  let overlaps = true;
  for (let index = 0; index < segmentCount; index++) {
    const leftSegment = leftSegments[index]!;
    const rightSegment = rightSegments[index]!;
    if (!globPatternsOverlap(leftSegment, rightSegment)) {
      overlaps = false;
    }
  }
  return overlaps;
}

function ambiguousLengthFindings(scopes: Scope[]): ConfigFinding[] {
  const entries: PatternEntry[] = [];
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      const normalized = normalizePattern(pattern);
      entries.push({ scope: scope.name, pattern: normalized, length: normalized.length });
    }
  }
  const grouped = new Map<number, PatternEntry[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.length);
    if (group) {
      group.push(entry);
    } else {
      grouped.set(entry.length, [entry]);
    }
  }
  const lengths = [...grouped.keys()].sort((left, right) => left - right);
  const findings: ConfigFinding[] = [];
  for (const length of lengths) {
    const entriesAtLength = grouped.get(length)!;
    const names = new Set<string>();
    for (let leftIndex = 0; leftIndex < entriesAtLength.length; leftIndex++) {
      const left = entriesAtLength[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < entriesAtLength.length; rightIndex++) {
        const right = entriesAtLength[rightIndex]!;
        if (left.scope !== right.scope && patternsOverlap(left.pattern, right.pattern)) {
          names.add(left.scope);
          names.add(right.scope);
        }
      }
    }
    if (names.size > 0) {
      findings.push({ kind: "ambiguousLength", scopes: [...names].sort(ascendingName), length });
    }
  }
  return findings;
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
