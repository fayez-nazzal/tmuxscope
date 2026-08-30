import { directoryGroup } from "./directory-groups.ts";
import { paneRecords } from "./tmux.ts";
import type { Action, TmuxState } from "./tmux.ts";
import type { Scope } from "./scopes.ts";

function windowGroup(windowId: string, state: TmuxState, scopes: Scope[]): string {
  const window = state.windows.find((entry) => entry.id === windowId);
  let group = "";
  if (window) {
    group = directoryGroup(window.path, scopes).key;
  }
  return group;
}

function targetWindow(windowId: string, group: string, state: TmuxState, scopes: Scope[]): string | undefined {
  let target: string | undefined;
  const panes = paneRecords(state);
  for (const window of state.windows) {
    const records = panes.filter((pane) => pane.windowId === window.id);
    const matches = records.length > 0 && records.every((pane) => directoryGroup(pane.path, scopes).key === group);
    if (target === undefined && window.id !== windowId && matches) {
      target = window.id;
    }
  }
  return target;
}

export function organizePlan(state: TmuxState, scopes: Scope[], selectedWindowId?: string): Action[] {
  const actions: Action[] = [];
  const panes = paneRecords(state);
  const windows = state.windows.filter((window) => !selectedWindowId || window.id === selectedWindowId);
  for (const window of windows) {
    const group = windowGroup(window.id, state, scopes);
    const records = panes.filter((pane) => pane.windowId === window.id);
    for (const pane of records) {
      const paneGroup = directoryGroup(pane.path, scopes);
      if (paneGroup.key !== group) {
        const destination = targetWindow(window.id, paneGroup.key, state, scopes);
        actions.push({ kind: "move-pane", paneId: pane.id, session: paneGroup.scope, ...(destination ? { windowId: destination } : {}) });
      }
    }
  }
  return actions;
}
