import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { canonical, normalizePattern, resolveScope } from "./match.ts";
import type { Action, SessionInfo, TmuxState } from "./tmux.ts";

export type RouteInput = {
  target: string;
  originPath: string;
  paneWork: number;
  panesInSession: number;
  scopes: Scope[];
  state: TmuxState;
};

export type RoutePlan = {
  actions: Action[];
  origin: "restore" | "close" | "none";
  cdPath: string;
  message: string;
};

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
    const holders = state.sessions.filter((session) => majorityForSession(state, scopes, session.name).scope === scope);
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

export type AdoptWindow = { id: string; path: string };

export type AdoptInput = {
  sessionId: string;
  sessionName: string;
  windows: AdoptWindow[];
  scopes: Scope[];
  state: TmuxState;
  attached: boolean;
};

export type AdoptPlan = { actions: Action[]; message: string };

export function adoptPlan(input: AdoptInput): AdoptPlan {
  const plan: AdoptPlan = { actions: [], message: "" };
  const paths = input.windows.map((window) => window.path);
  const scope = majorityScope(paths, input.scopes, input.sessionName).scope;
  if (input.sessionName !== scope) {
    const sessions = input.state.sessions.filter((session) => session.id !== input.sessionId);
    const windows = input.state.windows.filter((window) => window.session !== input.sessionName);
    const owner = sessionForScope({ sessions, windows }, input.scopes, scope);
    if (owner && input.attached) {
      plan.message = `${owner} already owns ${scope}, leaving ${input.sessionName} attached`;
    } else if (owner) {
      for (const window of input.windows) {
        plan.actions.push({ kind: "move-window", windowId: window.id, session: owner });
      }
      plan.message = `merged into ${owner}`;
    } else {
      plan.actions.push({ kind: "rename-session", id: input.sessionId, name: scope });
      plan.message = `renamed ${input.sessionName} to ${scope}`;
    }
  }
  return plan;
}

function idleWindow(state: TmuxState, session: string, target: string): string | null {
  let found: string | null = null;
  const wanted = canonical(target);
  const match = state.windows.find((window) => window.session === session && canonical(window.path) === wanted);
  if (match) {
    found = match.id;
  }
  return found;
}

export function routePlan(input: RouteInput): RoutePlan {
  const plan: RoutePlan = { actions: [], origin: "none", cdPath: "", message: "" };
  const target = resolveScope(input.target, input.scopes).scope;
  const current = resolveScope(input.originPath, input.scopes).scope;
  if (target !== current) {
    const existing = sessionForScope(input.state, input.scopes, target);
    let session = target;
    let reused = false;
    if (existing) {
      session = existing;
      const idle = idleWindow(input.state, session, input.target);
      if (idle) {
        reused = true;
        plan.actions.push({ kind: "select-window", windowId: idle });
      } else {
        plan.actions.push({ kind: "new-window", session, cwd: input.target });
      }
    } else {
      plan.actions.push({ kind: "new-session", name: session, cwd: input.target });
    }
    plan.actions.push({ kind: "switch", target: session });
    const disposable = input.paneWork === 0 && input.panesInSession > 1;
    if (disposable) {
      plan.origin = "close";
      plan.message = `→ ${session}  new window, empty origin pane closed`;
    } else {
      plan.origin = "restore";
      plan.cdPath = input.originPath;
      plan.message = `→ ${session}  new window, origin pane restored`;
    }
    if (!existing) {
      plan.message = plan.message.replace("new window", "session created");
    }
    if (reused) {
      plan.message = plan.message.replace("new window", "window reused");
    }
  }
  return plan;
}

export type Mixed = { session: string; windows: { index: number; path: string; scope: string }[] };
export type Split = { scope: string; sessions: string[] };
export type Ambiguous = { session: string; candidates: string[]; count: number; rule: string };
export type Report = { mixed: Mixed[]; split: Split[]; ambiguous: Ambiguous[]; problems: number };

function majorityForSession(state: TmuxState, scopes: Scope[], session: string): MajorityResult {
  const windows = state.windows.filter((window) => window.session === session);
  return majorityScope(windows.map((window) => window.path), scopes, session);
}

function ascendingName(left: string, right: string): number {
  let order = 0;
  if (left < right) {
    order = -1;
  } else if (left > right) {
    order = 1;
  }
  return order;
}

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

type Destination = { id: string; name: string };
type Move = { windowId: string; from: string; destination: Destination };
type Ordering = { actions: Action[]; stuck: boolean; unresolved: string[] };

function reportedNames(report: Report): Set<string> {
  const names = new Set<string>();
  for (const mixed of report.mixed) {
    names.add(mixed.session);
  }
  for (const split of report.split) {
    for (const name of split.sessions) {
      names.add(name);
    }
  }
  return names;
}

function ownerRank(session: SessionInfo, scope: string): number {
  let rank = 0;
  if (session.name === scope) {
    rank = rank + 1;
  }
  if (session.attached) {
    rank = rank + 2;
  }
  return rank;
}

function majorityOwner(scope: string, state: TmuxState, scopes: Scope[], claimed: Set<string>): SessionInfo | null {
  let owner: SessionInfo | null = null;
  let best = -1;
  for (const session of state.sessions) {
    const free = !claimed.has(session.id);
    const majority = majorityForSession(state, scopes, session.name);
    const holds = majority.scope === scope && majority.tiedWith.length === 0;
    const rank = ownerRank(session, scope);
    if (free && holds && rank > best) {
      best = rank;
      owner = session;
    }
  }
  return owner;
}

function namedOwner(scope: string, state: TmuxState, reported: Set<string>, claimed: Set<string>): SessionInfo | null {
  let owner: SessionInfo | null = null;
  const named = state.sessions.find((session) => session.name === scope);
  if (named && reported.has(named.name) && !claimed.has(named.id)) {
    owner = named;
  }
  return owner;
}

function finalName(name: string, renames: Map<string, string>): string {
  let result = name;
  const renamed = renames.get(name);
  if (renamed) {
    result = renamed;
  }
  return result;
}

function freeName(scope: string, taken: Set<string>): string {
  let name = scope;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${scope}-${suffix}`;
    suffix = suffix + 1;
  }
  return name;
}

function windowCounts(state: TmuxState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of state.sessions) {
    counts.set(session.id, state.windows.filter((window) => window.session === session.name).length);
  }
  return counts;
}

function countOf(counts: Map<string, number>, id: string): number {
  let count = 0;
  const held = counts.get(id);
  if (held) {
    count = held;
  }
  return count;
}

function needsFilling(counts: Map<string, number>, pending: Move[], id: string): boolean {
  const leaving = pending.filter((move) => move.from === id).length;
  return leaving > 0 && leaving >= countOf(counts, id);
}

function orderedMoves(moves: Move[], counts: Map<string, number>): Ordering {
  const ordering: Ordering = { actions: [], stuck: false, unresolved: [] };
  const pending = moves.slice();
  while (pending.length > 0 && !ordering.stuck) {
    let picked = -1;
    let bestRank = -1;
    for (let index = 0; index < pending.length; index++) {
      const move = pending[index]!;
      const alive = countOf(counts, move.destination.id) > 0;
      const awaited = pending.some((other) => other.destination.id === move.from);
      const survives = countOf(counts, move.from) > 1 || !awaited;
      let rank = -1;
      if (alive && survives) {
        rank = 0;
        if (needsFilling(counts, pending, move.destination.id)) {
          rank = 1;
        }
      }
      const better = rank > bestRank;
      const tiedByRank = rank === bestRank && picked !== -1 && ascendingName(move.windowId, pending[picked]!.windowId) < 0;
      if (better || tiedByRank) {
        bestRank = rank;
        picked = index;
      }
    }
    if (picked === -1) {
      ordering.stuck = true;
    } else {
      const move = pending.splice(picked, 1)[0]!;
      counts.set(move.from, countOf(counts, move.from) - 1);
      counts.set(move.destination.id, countOf(counts, move.destination.id) + 1);
      ordering.actions.push({ kind: "move-window", windowId: move.windowId, session: move.destination.name });
    }
  }
  if (ordering.stuck) {
    ordering.actions = [];
    ordering.unresolved = pending.map((move) => `${move.windowId} -> ${move.destination.name}`);
  }
  return ordering;
}

function buildRepair(report: Report, state: TmuxState, scopes: Scope[], reuseDrained: boolean): Ordering {
  const reported = reportedNames(report);
  const strays = state.windows.filter((window) => reported.has(window.session));
  const strayScopes = new Set<string>();
  for (const window of strays) {
    strayScopes.add(resolveScope(window.path, scopes).scope);
  }
  const orderedScopes = [...strayScopes].sort(ascendingName);
  const owners = new Map<string, SessionInfo>();
  const creations = new Map<string, string>();
  const claimed = new Set<string>();
  for (const scope of orderedScopes) {
    let owner = majorityOwner(scope, state, scopes, claimed);
    if (!owner && reuseDrained) {
      owner = namedOwner(scope, state, reported, claimed);
    }
    if (owner) {
      claimed.add(owner.id);
      owners.set(scope, owner);
    } else {
      const paths = strays.filter((window) => resolveScope(window.path, scopes).scope === scope).map((window) => window.path);
      const lowestPath = paths.slice().sort(ascendingName)[0]!;
      creations.set(scope, lowestPath);
    }
  }
  const actions: Action[] = [];
  const renames = new Map<string, string>();
  for (const [scope, owner] of owners) {
    const twin = state.sessions.some((session) => session.name === scope);
    const mine = reported.has(owner.name);
    if (mine && owner.name !== scope && !twin) {
      renames.set(owner.name, scope);
      actions.push({ kind: "rename-session", id: owner.id, name: scope });
    }
  }
  const taken = new Set<string>(state.sessions.map((session) => finalName(session.name, renames)));
  const destinations = new Map<string, Destination>();
  for (const [scope, owner] of owners) {
    destinations.set(scope, { id: owner.id, name: finalName(owner.name, renames) });
  }
  const counts = windowCounts(state);
  for (const [scope, cwd] of creations) {
    const name = freeName(scope, taken);
    const id = `new:${name}`;
    taken.add(name);
    destinations.set(scope, { id, name });
    counts.set(id, 1);
    actions.push({ kind: "new-session", name, cwd });
  }
  const moves: Move[] = [];
  for (const window of strays) {
    const scope = resolveScope(window.path, scopes).scope;
    const destination = destinations.get(scope);
    const holder = state.sessions.find((session) => session.name === window.session);
    if (destination && holder && destination.id !== holder.id) {
      moves.push({ windowId: window.id, from: holder.id, destination });
    }
  }
  const ordering = orderedMoves(moves, counts);
  let combinedActions: Action[] = [...actions, ...ordering.actions];
  if (ordering.stuck) {
    combinedActions = [];
  }
  return { actions: combinedActions, stuck: ordering.stuck, unresolved: ordering.unresolved };
}

export type RepairResult = { actions: Action[]; unsatisfiable: string[] };

export function repairPlan(report: Report, state: TmuxState, scopes: Scope[]): RepairResult {
  let result: RepairResult = { actions: [], unsatisfiable: [] };
  if (report.problems > 0) {
    const preferred = buildRepair(report, state, scopes, true);
    if (!preferred.stuck) {
      result = { actions: preferred.actions, unsatisfiable: [] };
    } else {
      const fallback = buildRepair(report, state, scopes, false);
      if (!fallback.stuck) {
        result = { actions: fallback.actions, unsatisfiable: [] };
      } else {
        result = { actions: [], unsatisfiable: fallback.unresolved };
      }
    }
  }
  return result;
}
