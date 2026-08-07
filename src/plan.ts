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

export type AdoptInput = {
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowPath: string;
  scopes: Scope[];
  state: TmuxState;
  attached: boolean;
};

export type AdoptPlan = { actions: Action[]; message: string };

export function adoptPlan(input: AdoptInput): AdoptPlan {
  const plan: AdoptPlan = { actions: [], message: "" };
  const scope = resolveScope(input.windowPath, input.scopes).scope;
  const others = { sessions: input.state.sessions.filter((session) => session.id !== input.sessionId), windows: input.state.windows.filter((window) => window.session !== input.sessionName) };
  const owner = sessionForScope(others, input.scopes, scope);
  if (owner) {
    plan.actions.push({ kind: "move-window", windowId: input.windowId, session: owner });
    if (input.attached) {
      plan.actions.push({ kind: "switch", target: owner });
    }
    plan.message = `merged into ${owner}`;
  } else if (input.sessionName !== scope) {
    plan.actions.push({ kind: "rename-session", id: input.sessionId, name: scope });
    plan.message = `renamed ${input.sessionName} to ${scope}`;
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
  const counts = new Map<string, number>();
  for (const window of windows) {
    const scope = resolveScope(window.path, scopes).scope;
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

export function repairPlan(report: Report, state: TmuxState, scopes: Scope[]): Action[] {
  const actions: Action[] = [];
  const created = new Set<string>();
  for (const mixed of report.mixed) {
    const home = scopeOfSession(state, scopes, mixed.session);
    const otherSessions = state.sessions.filter((session) => session.name !== mixed.session);
    const otherWindows = state.windows.filter((window) => window.session !== mixed.session);
    const others: TmuxState = { sessions: otherSessions, windows: otherWindows };
    for (const window of mixed.windows) {
      if (window.scope !== home) {
        const owner = sessionForScope(others, scopes, window.scope);
        let target = window.scope;
        if (owner) {
          target = owner;
        }
        if (!owner && !created.has(target)) {
          created.add(target);
          actions.push({ kind: "new-session", name: target, cwd: window.path });
        }
        const found = state.windows.find((entry) => entry.session === mixed.session && entry.index === window.index);
        if (found) {
          actions.push({ kind: "move-window", windowId: found.id, session: target });
        }
      }
    }
  }
  for (const split of report.split) {
    const sessions: TmuxState["sessions"] = [];
    for (const name of split.sessions) {
      const found = state.sessions.find((session) => session.name === name);
      if (found) {
        sessions.push(found);
      }
    }
    const attached = sessions.find((session) => session.attached);
    let primary = sessions[0];
    if (attached) {
      primary = attached;
    }
    if (primary) {
      const primaryName = primary.name;
      for (const session of sessions) {
        if (session.name !== primaryName) {
          const windows = state.windows.filter((entry) => entry.session === session.name);
          for (const window of windows) {
            actions.push({ kind: "move-window", windowId: window.id, session: primaryName });
          }
        }
      }
    }
  }
  return actions;
}
