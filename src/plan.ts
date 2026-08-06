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
};

export type AdoptPlan = { actions: Action[]; message: string };

export function adoptPlan(input: AdoptInput): AdoptPlan {
  const plan: AdoptPlan = { actions: [], message: "" };
  const scope = resolveScope(input.windowPath, input.scopes).scope;
  const others = { sessions: input.state.sessions.filter((session) => session.id !== input.sessionId), windows: input.state.windows.filter((window) => window.session !== input.sessionName) };
  const owner = sessionForScope(others, input.scopes, scope);
  if (owner) {
    plan.actions.push({ kind: "move-window", windowId: input.windowId, session: owner });
    plan.actions.push({ kind: "switch", target: owner });
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
