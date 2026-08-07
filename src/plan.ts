import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { resolveScope } from "./match.ts";
import type { Action, TmuxState } from "./tmux.ts";

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
    const holder = state.windows.find((window) => resolveScope(window.path, scopes).scope === scope);
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
    if (owner) {
      for (const window of input.windows) {
        plan.actions.push({ kind: "move-window", windowId: window.id, session: owner });
      }
      if (input.attached) {
        plan.actions.push({ kind: "switch", target: owner });
      }
      plan.message = `merged into ${owner}`;
    } else {
      plan.actions.push({ kind: "rename-session", id: input.sessionId, name: scope });
      plan.message = `renamed ${input.sessionName} to ${scope}`;
    }
  }
  return plan;
}

export function routePlan(input: RouteInput): RoutePlan {
  const plan: RoutePlan = { actions: [], origin: "none", cdPath: "", message: "" };
  const target = resolveScope(input.target, input.scopes).scope;
  const current = resolveScope(input.originPath, input.scopes).scope;
  if (target !== current) {
    const existing = sessionForScope(input.state, input.scopes, target);
    let session = target;
    if (existing) {
      session = existing;
      plan.actions.push({ kind: "new-window", session, cwd: input.target });
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

function homeOwners(state: TmuxState, scopes: Scope[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const session of state.sessions) {
    const home = scopeOfSession(state, scopes, session.name);
    const current = owners.get(home);
    let winner = session.name;
    if (current) {
      winner = current;
      const holder = state.sessions.find((entry) => entry.name === current);
      if (holder && !holder.attached && session.attached) {
        winner = session.name;
      }
    }
    owners.set(home, winner);
  }
  return owners;
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

export function repairPlan(report: Report, state: TmuxState, scopes: Scope[]): Action[] {
  const actions: Action[] = [];
  if (report.problems > 0) {
    const owners = homeOwners(state, scopes);
    const claimed = new Set<string>(owners.values());
    const creations = new Map<string, string>();
    for (const window of state.windows) {
      const scope = resolveScope(window.path, scopes).scope;
      const owned = owners.has(scope) || creations.has(scope);
      if (!owned) {
        const free = state.sessions.find((session) => session.name === scope && !claimed.has(session.name));
        if (free) {
          owners.set(scope, free.name);
          claimed.add(free.name);
        } else {
          creations.set(scope, window.path);
        }
      }
    }
    const renames = new Map<string, string>();
    for (const [scope, name] of owners) {
      const holder = state.sessions.find((session) => session.name === name);
      const twin = state.sessions.some((session) => session.name === scope);
      if (holder && name !== scope && !twin) {
        renames.set(name, scope);
        actions.push({ kind: "rename-session", id: holder.id, name: scope });
      }
    }
    const taken = new Set<string>(state.sessions.map((session) => finalName(session.name, renames)));
    const destinations = new Map<string, string>();
    for (const [scope, name] of owners) {
      destinations.set(scope, finalName(name, renames));
    }
    for (const [scope, cwd] of creations) {
      const name = freeName(scope, taken);
      taken.add(name);
      destinations.set(scope, name);
      actions.push({ kind: "new-session", name, cwd });
    }
    for (const window of state.windows) {
      const scope = resolveScope(window.path, scopes).scope;
      const destination = destinations.get(scope);
      const holder = finalName(window.session, renames);
      if (destination && destination !== holder) {
        actions.push({ kind: "move-window", windowId: window.id, session: destination });
      }
    }
  }
  return actions;
}
