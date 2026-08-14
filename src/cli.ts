#!/usr/bin/env bun

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { DEFAULT_CONFIG_PATH, loadConfig, ConfigError, MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { resolveScope, zshGlobs, zshRules } from "./match.ts";
import { adoptPlan, doctorReport, repairPlan, routePlan, sessionForScope } from "./plan.ts";
import type { AdoptWindow, RouteInput } from "./plan.ts";
import { listRows, renderAction, renderDoctor, renderList } from "./render.ts";
import { goTarget } from "./target.ts";
import type { GoTarget, PathProbe } from "./target.ts";
import { applyAll, tmux } from "./tmux.ts";
import type { Action, Tmux, TmuxState } from "./tmux.ts";
import { TMUX_HOOK, ZSH_HOOK } from "./hooks.ts";

export const VERSION = "0.1.0";

const HELP = `tmuxscope ${VERSION} — one tmux session per project scope

USAGE
  tmuxscope resolve <path> [--json]   print the scope owning a path
  tmuxscope rules <path>              print the zsh fast path rules of that scope
  tmuxscope globs <path>              the rules in the older format, for shells opened before the rename
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

export type RouteEnvironment = {
  insideTmux: boolean;
  paneId: string;
  originPath: string;
  cdFile: string;
  execFile: string;
  write: (path: string, data: string) => void;
};

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

export function cmdResolve(client: Tmux, path: string, scopes: Scope[], json: boolean) {
  const resolution = resolveScope(path, scopes);
  if (json) {
    const session = sessionForScope(client.state(), scopes, resolution.scope);
    process.stdout.write(`${JSON.stringify({ ...resolution, path, session }, null, 2)}\n`);
  } else {
    process.stdout.write(`${resolution.scope}\n`);
  }
}

function cmdRules(path: string, scopes: Scope[]) {
  const resolution = resolveScope(path, scopes);
  process.stdout.write(`${zshRules(resolution.scope, scopes).join("\n")}\n`);
}

function cmdGlobs(path: string, scopes: Scope[]) {
  const resolution = resolveScope(path, scopes);
  process.stdout.write(`${zshGlobs(resolution.scope, scopes).join(" ")}\n`);
}

export function cmdRoute(client: Tmux, path: string, scopes: Scope[], env: RouteEnvironment) {
  if (!env.insideTmux) {
    fail("route only runs inside tmux", 3);
  }
  if (!env.paneId) {
    fail("route needs TMUX_PANE, run it from a tmux pane", 3);
  }
  const state = client.state();
  const context = client.paneContext(env.paneId);
  const routeWindows = state.windows.filter((window) => window.id !== context.windowId);
  const routeState: TmuxState = { sessions: state.sessions, windows: routeWindows };
  const paneWork = client.paneWork(env.paneId);
  const panesInSession = client.panesInSession(context.session);
  const routeInput: RouteInput = { target: path, originPath: env.originPath, paneWork, panesInSession, scopes, state: routeState };
  const plan = routePlan(routeInput);
  if (plan.origin === "restore" && env.cdFile) {
    env.write(env.cdFile, plan.cdPath);
  }
  const failure = applyAll(client, plan.actions);
  if (failure !== "") {
    throw new Error(failure);
  }
  if (plan.origin === "close" && env.execFile) {
    env.write(env.execFile, `tmux kill-pane -t '${env.paneId}'\n`);
  }
  if (plan.message) {
    process.stdout.write(`${plan.message}\n`);
  }
}

export function cmdAdopt(client: Tmux, sessionId: string, scopes: Scope[]) {
  const state = client.state();
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (session) {
    const owned = state.windows.filter((entry) => entry.session === session.name);
    const windows: AdoptWindow[] = owned.map((entry) => ({ id: entry.id, path: entry.path }));
    if (windows.length > 0) {
      const plan = adoptPlan({ sessionId, sessionName: session.name, windows, scopes, state, attached: session.attached });
      const failure = applyAll(client, plan.actions);
      if (failure !== "") {
        throw new Error(failure);
      }
      if (plan.message) {
        client.message(plan.message);
      }
    }
  }
}

function cmdList(client: Tmux, scopes: Scope[]) {
  process.stdout.write(renderList(listRows(client.state(), scopes)));
}

function cmdDoctor(client: Tmux, scopes: Scope[]) {
  const report = doctorReport(client.state(), scopes);
  process.stdout.write(renderDoctor(report));
  if (report.problems > 0) {
    process.exit(1);
  }
}

function cmdRepair(client: Tmux, scopes: Scope[], dryRun: boolean) {
  const state = client.state();
  const actions = repairPlan(doctorReport(state, scopes), state, scopes);
  if (actions.length === 0) {
    process.stdout.write("all clean\n");
  }
  for (const action of actions) {
    if (dryRun) {
      process.stdout.write(`would ${renderAction(action)}\n`);
    } else {
      client.apply(action);
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

function listDirectory(path: string): string[] {
  let entries: string[] = [];
  if (existsSync(path)) {
    entries = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
  return entries;
}

function missingDirectory(target: GoTarget, scopes: Scope[], probe: PathProbe): string {
  const scope = scopes.find((entry) => entry.name === target.scope);
  let tried = `${probe.cwd} and ${probe.home}`;
  if (scope) {
    tried = scope.patterns.join(" ");
  }
  return `scope ${target.scope} has no directory to start in, tried ${tried}`;
}

function cmdGo(client: Tmux, nameOrPath: string, scopes: Scope[]) {
  const probe: PathProbe = { exists: existsSync, list: listDirectory, cwd: process.cwd(), home: homedir() };
  const target = goTarget(nameOrPath, scopes, probe);
  if (target.unknown) {
    const knownNames = [...scopes.map((entry) => entry.name), MISC];
    fail(`no scope named ${nameOrPath}\nknown scopes: ${knownNames.join(" ")}`, 2);
  }
  const state = client.state();
  const owner = sessionForScope(state, scopes, target.scope);
  if (owner) {
    applyAll(client, [{ kind: "switch", target: owner }]);
    process.stdout.write(`switched to ${owner}\n`);
  } else if (target.missing) {
    fail(missingDirectory(target, scopes, probe), 2);
  } else {
    const actions: Action[] = [{ kind: "new-session", name: target.scope, cwd: target.cwd }, { kind: "switch", target: target.scope }];
    const failure = applyAll(client, actions);
    if (failure !== "") {
      throw new Error(failure);
    }
    process.stdout.write(`created ${target.scope} at ${target.cwd}\n`);
  }
}

function routeEnvironment(): RouteEnvironment {
  return {
    insideTmux: Boolean(process.env.TMUX),
    paneId: process.env.TMUX_PANE || "",
    originPath: process.env.TMUXSCOPE_ORIGIN || process.cwd(),
    cdFile: process.env.TMUXSCOPE_CD_FILE || "",
    execFile: process.env.TMUXSCOPE_EXEC_FILE || "",
    write: writeFileSync,
  };
}

function dispatch(client: Tmux, command: string, positionals: string[], flags: string[], scopes: Scope[]) {
  const path = positionals[1] || process.cwd();
  if (command === "resolve") {
    cmdResolve(client, path, scopes, flags.includes("--json"));
  } else if (command === "rules") {
    cmdRules(path, scopes);
  } else if (command === "globs") {
    cmdGlobs(path, scopes);
  } else if (command === "route") {
    cmdRoute(client, path, scopes, routeEnvironment());
  } else if (command === "adopt") {
    cmdAdopt(client, positionals[1] || "", scopes);
  } else if (command === "list") {
    cmdList(client, scopes);
  } else if (command === "doctor") {
    cmdDoctor(client, scopes);
  } else if (command === "repair") {
    cmdRepair(client, scopes, flags.includes("--dry-run"));
  } else if (command === "go") {
    cmdGo(client, positionals[1] || "", scopes);
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
    dispatch(tmux, command, positionals, flags, scopes);
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
