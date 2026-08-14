import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { canonical, resolveScope } from "./match.ts";
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

export function sessionForScope(state: TmuxState, scopes: Scope[], scope: string): string | null {
  let found: string | null = null;
  const named = state.sessions.find((session) => session.name === scope);
  if (named) {
    found = named.name;
  }
  if (!found) {
    const holder = state.windows.find((window) => {
      const owns = resolveScope(window.path, scopes).scope === scope;
      const settled = scopeOfSession(state, scopes, window.session) === scope;
      return owns && settled;
    });
    if (holder) {
      found = holder.session;
    }
  }
  return found;
}

export function majorityScope(paths: string[], scopes: Scope[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const scope = resolveScope(path, scopes).scope;
    const current = counts.get(scope);
    let count = 1;
    if (current) {
      count = current + 1;
    }
    counts.set(scope, count);
  }
  let winner = MISC;
  let best = 0;
  for (const [scope, count] of counts) {
    if (count > best) {
      best = count;
      winner = scope;
    }
  }
  return winner;
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
  const scope = majorityScope(paths, input.scopes);
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
export type Report = { mixed: Mixed[]; split: Split[]; problems: number };

function scopeOfSession(state: TmuxState, scopes: Scope[], session: string): string {
  const windows = state.windows.filter((window) => window.session === session);
  return majorityScope(windows.map((window) => window.path), scopes);
}

export function doctorReport(state: TmuxState, scopes: Scope[]): Report {
  const report: Report = { mixed: [], split: [], problems: 0 };
  for (const session of state.sessions) {
    const windows = state.windows.filter((window) => window.session === session.name);
    const detailed = windows.map((window) => ({ index: window.index, path: window.path, scope: resolveScope(window.path, scopes).scope }));
    const distinct = new Set(detailed.map((window) => window.scope));
    if (distinct.size > 1) {
      report.mixed.push({ session: session.name, windows: detailed });
    }
  }
  const holders = new Map<string, string[]>();
  for (const session of state.sessions) {
    const scope = scopeOfSession(state, scopes, session.name);
    const names = holders.get(scope);
    let group: string[] = [];
    if (names) {
      group = names;
    }
    group.push(session.name);
    holders.set(scope, group);
  }
  for (const [scope, sessions] of holders) {
    if (sessions.length > 1) {
      report.split.push({ scope, sessions });
    }
  }
  report.problems = report.mixed.length + report.split.length;
  return report;
}

type Destination = { id: string; name: string };
type Move = { windowId: string; from: string; destination: Destination };
type Ordering = { actions: Action[]; stuck: boolean };

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
    const holds = scopeOfSession(state, scopes, session.name) === scope;
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
  const ordering: Ordering = { actions: [], stuck: false };
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
      if (rank > bestRank) {
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
  for (const move of pending) {
    ordering.actions.push({ kind: "move-window", windowId: move.windowId, session: move.destination.name });
  }
  return ordering;
}

function buildRepair(report: Report, state: TmuxState, scopes: Scope[], reuseDrained: boolean): Ordering {
  const reported = reportedNames(report);
  const strays = state.windows.filter((window) => reported.has(window.session));
  const owners = new Map<string, SessionInfo>();
  const creations = new Map<string, string>();
  const claimed = new Set<string>();
  for (const window of strays) {
    const scope = resolveScope(window.path, scopes).scope;
    const decided = owners.has(scope) || creations.has(scope);
    if (!decided) {
      let owner = majorityOwner(scope, state, scopes, claimed);
      if (!owner && reuseDrained) {
        owner = namedOwner(scope, state, reported, claimed);
      }
      if (owner) {
        claimed.add(owner.id);
        owners.set(scope, owner);
      } else {
        creations.set(scope, window.path);
      }
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
  return { actions: [...actions, ...ordering.actions], stuck: ordering.stuck };
}

export function repairPlan(report: Report, state: TmuxState, scopes: Scope[]): Action[] {
  let actions: Action[] = [];
  if (report.problems > 0) {
    const preferred = buildRepair(report, state, scopes, true);
    actions = preferred.actions;
    if (preferred.stuck) {
      actions = buildRepair(report, state, scopes, false).actions;
    }
  }
  return actions;
}
