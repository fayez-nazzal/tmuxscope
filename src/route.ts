import type { Scope } from "./scopes.ts";
import { directoryGroup } from "./directory-groups.ts";
import type { DirectoryGroup } from "./directory-groups.ts";
import { sessionForScope } from "./ownership.ts";
import type { Action, TmuxState } from "./tmux.ts";

export type RouteInput = {
  target: string;
  originPath: string;
  targetGroup: DirectoryGroup;
  originGroup: DirectoryGroup;
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

function idleWindow(state: TmuxState, session: string, targetGroup: DirectoryGroup, scopes: Scope[]): string | null {
  let found: string | null = null;
  const match = state.windows.find((window) => {
    let paths = state.panes.filter((pane) => pane.windowId === window.id).map((pane) => pane.path);
    if (paths.length === 0) {
      paths = [window.path];
    }
    return window.session === session && paths.every((path) => directoryGroup(path, scopes).key === targetGroup.key);
  });
  if (match) {
    found = match.id;
  }
  return found;
}

export function routePlan(input: RouteInput): RoutePlan {
  const plan: RoutePlan = { actions: [], origin: "none", cdPath: "", message: "" };
  if (input.targetGroup.key !== input.originGroup.key) {
    const existing = sessionForScope(input.state, input.scopes, input.targetGroup.scope);
    let session = input.targetGroup.scope;
    let reused = false;
    if (existing) {
      session = existing;
      const idle = idleWindow(input.state, session, input.targetGroup, input.scopes);
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
