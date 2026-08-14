import type { Scope } from "./scopes.ts";
import { resolveScope } from "./resolve.ts";
import { ascendingName, majorityForSession } from "./ownership.ts";
import type { TmuxState } from "./tmux.ts";

export type Mixed = { session: string; windows: { index: number; path: string; scope: string }[] };
export type Split = { scope: string; sessions: string[] };
export type Ambiguous = { session: string; candidates: string[]; count: number; rule: string };
export type Report = { mixed: Mixed[]; split: Split[]; ambiguous: Ambiguous[]; problems: number };

function ascendingWindow(left: { index: number; id: string }, right: { index: number; id: string }): number {
  let order = left.index - right.index;
  if (order === 0) {
    order = ascendingName(left.id, right.id);
  }
  return order;
}

export function doctorReport(state: TmuxState, scopes: Scope[]): Report {
  const report: Report = { mixed: [], split: [], ambiguous: [], problems: 0 };
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
  report.problems = report.mixed.length + report.split.length + report.ambiguous.length;
  return report;
}
