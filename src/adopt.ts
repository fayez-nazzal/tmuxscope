import type { Scope } from "./scopes.ts";
import { majorityScope, sessionForScope } from "./ownership.ts";
import type { Action, TmuxState } from "./tmux.ts";

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
