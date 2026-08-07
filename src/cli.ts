#!/usr/bin/env bun

import { existsSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG_PATH, loadConfig, ConfigError, MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { resolveScope, zshRules } from "./match.ts";
import { adoptPlan, doctorReport, repairPlan, routePlan, sessionForScope } from "./plan.ts";
import type { AdoptWindow, RouteInput } from "./plan.ts";
import { listRows, renderAction, renderDoctor, renderList } from "./render.ts";
import { goTarget } from "./target.ts";
import type { PathProbe } from "./target.ts";
import { tmux } from "./tmux.ts";
import type { TmuxState } from "./tmux.ts";
import { TMUX_HOOK, ZSH_HOOK } from "./hooks.ts";

export const VERSION = "0.1.0";

const HELP = `tmuxscope ${VERSION} — one tmux session per project scope

USAGE
  tmuxscope resolve <path> [--json]   print the scope owning a path
  tmuxscope rules <path>              print the zsh fast path rules of that scope
  tmuxscope route <path>              hook entry point for a cd that left the scope
  tmuxscope adopt <session-id>        hook entry point for a new session
  tmuxscope go <scope or path>        attach the scope session, creating it if needed
  tmuxscope list                      every scope, its session and its patterns
  tmuxscope doctor                    report sessions that break the rules
  tmuxscope repair [--dry-run]        move stray windows and merge duplicates
  tmuxscope hook zsh | tmux          print the glue to install
  tmuxscope -h | --help
  tmuxscope -v | --version

CONFIG
  ${DEFAULT_CONFIG_PATH}, one "name = paths" line per scope.
  Override with TMUXSCOPE_CONFIG.
`;

function configPath(): string {
  let path = DEFAULT_CONFIG_PATH;
  const override = process.env.TMUXSCOPE_CONFIG;
  if (override) {
    path = override;
  }
  return path;
}

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function cmdResolve(path: string, scopes: Scope[], json: boolean) {
  const resolution = resolveScope(path, scopes);
  if (json) {
    const session = sessionForScope(tmux.state(), scopes, resolution.scope);
    process.stdout.write(`${JSON.stringify({ ...resolution, path, session }, null, 2)}\n`);
  } else {
    process.stdout.write(`${resolution.scope}\n`);
  }
}

function cmdRules(path: string, scopes: Scope[]) {
  const resolution = resolveScope(path, scopes);
  process.stdout.write(`${zshRules(resolution.scope, scopes).join("\n")}\n`);
}

function cmdRoute(path: string, scopes: Scope[]) {
  if (!process.env.TMUX) {
    fail("route only runs inside tmux", 3);
  }
  const paneId = process.env.TMUX_PANE;
  if (!paneId) {
    fail("route needs TMUX_PANE, run it from a tmux pane", 3);
  }
  const state = tmux.state();
  const originPath = process.env.TMUXSCOPE_ORIGIN || process.cwd();
  const context = tmux.paneContext(paneId);
  const routeWindows = state.windows.filter((window) => window.id !== context.windowId);
  const routeState: TmuxState = { sessions: state.sessions, windows: routeWindows };
  const paneWork = tmux.paneWork(paneId);
  const panesInSession = tmux.panesInSession(context.session);
  const routeInput: RouteInput = { target: path, originPath, paneWork, panesInSession, scopes, state: routeState };
  const plan = routePlan(routeInput);
  for (const action of plan.actions) {
    tmux.apply(action);
  }
  if (plan.origin === "restore" && process.env.TMUXSCOPE_CD_FILE) {
    writeFileSync(process.env.TMUXSCOPE_CD_FILE, plan.cdPath);
  }
  if (plan.origin === "close" && process.env.TMUXSCOPE_EXEC_FILE) {
    writeFileSync(process.env.TMUXSCOPE_EXEC_FILE, `tmux kill-pane -t '${paneId}'\n`);
  }
  if (plan.message) {
    process.stdout.write(`${plan.message}\n`);
  }
}

function cmdAdopt(sessionId: string, scopes: Scope[]) {
  const state = tmux.state();
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (session) {
    const owned = state.windows.filter((entry) => entry.session === session.name);
    const windows: AdoptWindow[] = owned.map((entry) => ({ id: entry.id, path: entry.path }));
    if (windows.length > 0) {
      const plan = adoptPlan({ sessionId, sessionName: session.name, windows, scopes, state, attached: session.attached });
      for (const action of plan.actions) {
        tmux.apply(action);
      }
      if (plan.message) {
        tmux.message(plan.message);
      }
    }
  }
}

function cmdList(scopes: Scope[]) {
  process.stdout.write(renderList(listRows(tmux.state(), scopes)));
}

function cmdDoctor(scopes: Scope[]) {
  const report = doctorReport(tmux.state(), scopes);
  process.stdout.write(renderDoctor(report));
  if (report.problems > 0) {
    process.exit(1);
  }
}

function cmdRepair(scopes: Scope[], dryRun: boolean) {
  const state = tmux.state();
  const actions = repairPlan(doctorReport(state, scopes), state, scopes);
  if (actions.length === 0) {
    process.stdout.write("all clean\n");
  }
  for (const action of actions) {
    if (dryRun) {
      process.stdout.write(`would ${renderAction(action)}\n`);
    } else {
      tmux.apply(action);
      process.stdout.write(`${renderAction(action)}\n`);
    }
  }
}

function cmdHook(kind: string) {
  if (kind === "zsh") {
    process.stdout.write(ZSH_HOOK);
  } else if (kind === "tmux") {
    process.stdout.write(TMUX_HOOK);
  } else {
    fail("hook takes zsh or tmux", 2);
  }
}

function cmdGo(nameOrPath: string, scopes: Scope[]) {
  const probe: PathProbe = { exists: existsSync, cwd: process.cwd() };
  const target = goTarget(nameOrPath, scopes, probe);
  if (target.unknown) {
    const knownNames = [...scopes.map((entry) => entry.name), MISC];
    fail(`no scope named ${nameOrPath}\nknown scopes: ${knownNames.join(" ")}`, 2);
  }
  const state = tmux.state();
  const owner = sessionForScope(state, scopes, target.scope);
  if (owner) {
    tmux.apply({ kind: "switch", target: owner });
    process.stdout.write(`switched to ${owner}\n`);
  } else {
    tmux.apply({ kind: "new-session", name: target.scope, cwd: target.cwd });
    tmux.apply({ kind: "switch", target: target.scope });
    process.stdout.write(`created ${target.scope} at ${target.cwd}\n`);
  }
}

function dispatch(command: string, positionals: string[], flags: string[], scopes: Scope[]) {
  const path = positionals[1] || process.cwd();
  if (command === "resolve") {
    cmdResolve(path, scopes, flags.includes("--json"));
  } else if (command === "rules") {
    cmdRules(path, scopes);
  } else if (command === "route") {
    cmdRoute(path, scopes);
  } else if (command === "adopt") {
    cmdAdopt(positionals[1] || "", scopes);
  } else if (command === "list") {
    cmdList(scopes);
  } else if (command === "doctor") {
    cmdDoctor(scopes);
  } else if (command === "repair") {
    cmdRepair(scopes, flags.includes("--dry-run"));
  } else if (command === "go") {
    cmdGo(positionals[1] || "", scopes);
  } else {
    fail(`unknown command ${command}, try --help`, 2);
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  const flags = rawArgs.filter((arg) => arg.startsWith("-"));
  const positionals = rawArgs.filter((arg) => !arg.startsWith("-"));
  const command = positionals[0] || "";
  const wantsVersion = flags.includes("-v") || flags.includes("--version");
  const wantsHelp = flags.includes("-h") || flags.includes("--help");
  if (wantsVersion) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  if (command === "" || wantsHelp) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (command === "hook") {
    cmdHook(positionals[1] || "");
    process.exit(0);
  }
  const scopesPath = configPath();
  let scopes: Scope[] = [];
  try {
    scopes = loadConfig(scopesPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      fail(`${scopesPath} ${error.message}`, 2);
    }
    throw error;
  }
  try {
    dispatch(command, positionals, flags, scopes);
  } catch (error) {
    let detail = String(error);
    if (error instanceof Error) {
      detail = error.message;
    }
    fail(`tmuxscope ${command}: ${detail}`, 4);
  }
}

if (import.meta.main) {
  main();
}
