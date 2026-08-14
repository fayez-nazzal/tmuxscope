import { MISC } from "./scopes.ts";
import type { Scope } from "./scopes.ts";
import { normalizePattern, resolveScope } from "./resolve.ts";
import type { SessionInfo, TmuxState } from "./tmux.ts";

export function ascendingName(left: string, right: string): number {
  let order = 0;
  if (left < right) {
    order = -1;
  } else if (left > right) {
    order = 1;
  }
  return order;
}

function windowsOfScope(state: TmuxState, scopes: Scope[], scope: string, session: string): number {
  return state.windows.filter((window) => window.session === session && resolveScope(window.path, scopes).scope === scope).length;
}

function sessionOwnerOrder(state: TmuxState, scopes: Scope[], scope: string, left: SessionInfo, right: SessionInfo): number {
  let order = windowsOfScope(state, scopes, scope, right.name) - windowsOfScope(state, scopes, scope, left.name);
  if (order === 0) {
    const leftAttached = left.attached ? 1 : 0;
    const rightAttached = right.attached ? 1 : 0;
    order = rightAttached - leftAttached;
  }
  if (order === 0) {
    order = ascendingName(left.name, right.name);
  }
  return order;
}

export function sessionForScope(state: TmuxState, scopes: Scope[], scope: string): string | null {
  let found: string | null = null;
  const named = state.sessions.find((session) => session.name === scope);
  if (named) {
    found = named.name;
  } else {
    const holders = state.sessions.filter((session) => {
      const hasWindows = state.windows.some((window) => window.session === session.name);
      return hasWindows && majorityForSession(state, scopes, session.name).scope === scope;
    });
    if (holders.length > 0) {
      const ranked = holders.slice().sort((left, right) => sessionOwnerOrder(state, scopes, scope, left, right));
      found = ranked[0]!.name;
    }
  }
  return found;
}

export type MajorityResult = { scope: string; tiedWith: string[]; rule: string; count: number };

function longestPatternWinner(candidates: string[], maxLength: Map<string, number>): { scope: string; rule: string } {
  const sorted = candidates.slice().sort(ascendingName);
  let winner = sorted[0]!;
  let best = maxLength.get(winner) || 0;
  for (const scope of sorted) {
    const length = maxLength.get(scope) || 0;
    if (length > best) {
      best = length;
      winner = scope;
    }
  }
  const distinctLengths = new Set(sorted.map((scope) => maxLength.get(scope) || 0));
  let rule = "longest matched pattern";
  if (distinctLengths.size <= 1) {
    rule = "lowest scope name";
  }
  return { scope: winner, rule };
}

export function majorityScope(paths: string[], scopes: Scope[], sessionName: string): MajorityResult {
  const counts = new Map<string, number>();
  const maxLength = new Map<string, number>();
  for (const path of paths) {
    const resolution = resolveScope(path, scopes);
    const scope = resolution.scope;
    const current = counts.get(scope);
    let count = 1;
    if (current) {
      count = current + 1;
    }
    counts.set(scope, count);
    let length = 0;
    if (resolution.matched) {
      length = normalizePattern(resolution.matched).length;
    }
    const previousLength = maxLength.get(scope);
    if (previousLength === undefined || length > previousLength) {
      maxLength.set(scope, length);
    }
  }
  let result: MajorityResult = { scope: MISC, tiedWith: [], rule: "", count: 0 };
  if (counts.size > 0) {
    let best = 0;
    for (const count of counts.values()) {
      if (count > best) {
        best = count;
      }
    }
    const candidates = [...counts.keys()].filter((scope) => counts.get(scope) === best);
    let winner = candidates[0]!;
    let tiedWith: string[] = [];
    let rule = "";
    if (candidates.length > 1) {
      tiedWith = candidates.slice().sort(ascendingName);
      const named = candidates.find((scope) => scope === sessionName);
      if (named) {
        winner = named;
        rule = "session name matches scope name";
      } else {
        const resolved = longestPatternWinner(candidates, maxLength);
        winner = resolved.scope;
        rule = resolved.rule;
      }
    }
    result = { scope: winner, tiedWith, rule, count: best };
  }
  return result;
}

export function majorityForSession(state: TmuxState, scopes: Scope[], session: string): MajorityResult {
  const windows = state.windows.filter((window) => window.session === session);
  return majorityScope(windows.map((window) => window.path), scopes, session);
}

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
