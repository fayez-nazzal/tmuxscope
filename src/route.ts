import type { Scope } from "./scopes.ts";
import { canonical, resolveScope } from "./resolve.ts";
import { sessionForScope } from "./ownership.ts";
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
