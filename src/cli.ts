#!/usr/bin/env bun

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { DEFAULT_CONFIG_PATH, loadConfig, ConfigError, MISC } from "./scopes.ts";
import type { Scope } from "./scopes.ts";
import { resolveScope } from "./resolve.ts";
import { zshRules } from "./rules.ts";
import { adoptPlan } from "./adopt.ts";
import type { AdoptWindow } from "./adopt.ts";
import { configReport, doctorReport } from "./doctor.ts";
import { listRows, sessionForScope } from "./ownership.ts";
import { repairPlan } from "./repair.ts";
import type { RepairResult } from "./repair.ts";
import { routePlan } from "./route.ts";
import type { RouteInput } from "./route.ts";
import { organizePlan } from "./organize.ts";
import { directoryGroup } from "./directory-groups.ts";
import { renderAction, renderConfigReport, renderDoctor, renderList } from "./render.ts";
import { goTarget } from "./go.ts";
import type { GoTarget, PathProbe } from "./go.ts";
import { applyAll, paneRecords, tmux } from "./tmux.ts";
import type { Action, Tmux, TmuxState } from "./tmux.ts";
import { TMUX_HOOK, ZSH_HOOK } from "./hooks.ts";
import packageJson from "../package.json";

export const VERSION = packageJson.version;

const HELP = `tmuxscope ${VERSION} — one tmux session per project scope

USAGE
  tmuxscope resolve <path> [--json]   print the scope owning a path
  tmuxscope rules <path>              print the zsh fast path rules of that scope
  tmuxscope route <path>              hook entry point for a cd that left the scope
  tmuxscope adopt <session-id>        hook entry point for a new session
  tmuxscope go <scope or path>        attach the scope session, creating it if needed
  tmuxscope list [--json]             every scope, its session and its patterns
  tmuxscope doctor [--json]           report sessions that break the rules
  tmuxscope repair [--dry-run] [--json]  move stray windows and merge duplicates
  tmuxscope organize [--hook] [window-id] [--json]  group panes by directory
  tmuxscope hook zsh | tmux          print the glue to install
  tmuxscope -h | --help
  tmuxscope -v | --version

CONFIG
  ${DEFAULT_CONFIG_PATH}, one "name = paths" line per scope.
  Override with TMUXSCOPE_CONFIG.

EXIT CODES
  0  clean
  1  the invariant is still broken (doctor found something, repair could not fix everything)
  2  bad input (unknown command, broken config, unknown scope)
  3  wrong environment (route run outside tmux or outside a pane)
  4  a tmux call failed
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

export function cmdResolve(path: string, scopes: Scope[], json: boolean) {
  const resolution = resolveScope(path, scopes);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...resolution, path }, null, 2)}\n`);
  } else {
    process.stdout.write(`${resolution.scope}\n`);
  }
}

function cmdRules(path: string, scopes: Scope[]) {
  const resolution = resolveScope(path, scopes);
  process.stdout.write(`${zshRules(resolution.scope, scopes).join("\n")}\n`);
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
  const targetGroup = directoryGroup(path, scopes);
  const originGroup = directoryGroup(env.originPath, scopes);
  const retainOrigin = targetGroup.scope === originGroup.scope;
  const routeWindows = state.windows.filter((window) => retainOrigin || window.id !== context.windowId);
  const routePanes = paneRecords(state).filter((pane) => retainOrigin || pane.windowId !== context.windowId);
  const routeState: TmuxState = { sessions: state.sessions, windows: routeWindows, panes: routePanes };
  const paneWork = client.paneWork(env.paneId);
  const panesInSession = client.panesInSession(context.session);
  const routeInput: RouteInput = { target: path, originPath: env.originPath, targetGroup, originGroup, paneWork, panesInSession, scopes, state: routeState };
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

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function cmdList(client: Tmux, scopes: Scope[], json: boolean) {
  const rows = listRows(client.state(), scopes);
  if (json) {
    writeJson({ rows });
  } else {
    process.stdout.write(renderList(rows));
  }
}

export function cmdDoctor(client: Tmux, scopes: Scope[], json: boolean) {
  const report = doctorReport(client.state(), scopes);
  const findings = configReport(scopes, { exists: existsSync });
  if (json) {
    writeJson({ ...report, config: findings });
  } else {
    process.stdout.write(renderDoctor(report));
    process.stdout.write(renderConfigReport(findings));
  }
  if (report.problems > 0 || findings.length > 0) {
    process.exit(1);
  }
}

function loggingClient(client: Tmux): Tmux {
  return {
    ...client,
    apply(action: Action) {
      client.apply(action);
      process.stdout.write(`${renderAction(action)}\n`);
    },
  };
}

function cmdRepairJson(client: Tmux, scopes: Scope[], plan: RepairResult, dryRun: boolean) {
  if (dryRun) {
    writeJson({ actions: plan.actions, unsatisfiable: [], applied: false });
  } else {
    const failure = applyAll(client, plan.actions);
    if (failure !== "") {
      writeJson({ actions: plan.actions, unsatisfiable: [], applied: false, error: failure });
      process.exit(4);
    }
    const after = doctorReport(client.state(), scopes);
    writeJson({ actions: plan.actions, unsatisfiable: [], applied: true, after });
    if (after.problems > 0) {
      process.exit(1);
    }
  }
}

function cmdRepairText(client: Tmux, scopes: Scope[], plan: RepairResult, dryRun: boolean) {
  if (plan.actions.length === 0) {
    process.stdout.write("all clean\n");
  }
  if (dryRun) {
    for (const action of plan.actions) {
      process.stdout.write(`would ${renderAction(action)}\n`);
    }
  } else {
    const failure = applyAll(loggingClient(client), plan.actions);
    if (failure !== "") {
      process.stderr.write(`tmuxscope repair: ${failure}\n`);
      process.exit(4);
    }
    const after = doctorReport(client.state(), scopes);
    if (after.problems > 0) {
      process.stdout.write(renderDoctor(after));
      process.exit(1);
    }
  }
}

export function cmdRepair(client: Tmux, scopes: Scope[], dryRun: boolean, json: boolean) {
  const state = client.state();
  const plan = repairPlan(doctorReport(state, scopes), state, scopes);
  if (plan.unsatisfiable.length > 0) {
    if (json) {
      writeJson({ actions: [], unsatisfiable: plan.unsatisfiable, applied: false });
    } else {
      process.stderr.write("repair cannot order these moves without a spare session:\n");
      for (const description of plan.unsatisfiable) {
        process.stderr.write(`  ${description}\n`);
      }
    }
    process.exit(1);
  }
  if (json) {
    cmdRepairJson(client, scopes, plan, dryRun);
  } else {
    cmdRepairText(client, scopes, plan, dryRun);
  }
}

function organizeEnabled(client: Tmux): boolean {
  const value = client.option ? client.option("@tmuxscope-organize-panes") : "";
  return value !== "0" && value.toLowerCase() !== "off";
}

export function cmdOrganize(client: Tmux, scopes: Scope[], hook: boolean, windowId: string, json: boolean) {
  if (!organizeEnabled(client)) {
    if (json) {
      writeJson({ actions: [], applied: false, disabled: true });
    }
  } else {
    const actions = organizePlan(client.state(), scopes, windowId || undefined);
    if (json) {
      const failure = applyAll(client, actions);
      if (failure !== "") {
        writeJson({ actions, applied: false, error: failure });
        process.exit(4);
      }
      writeJson({ actions, applied: true });
    } else if (!hook) {
      const failure = applyAll(client, actions);
      if (failure !== "") {
        throw new Error(failure);
      }
    } else {
      applyAll(client, actions);
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
    cmdResolve(path, scopes, flags.includes("--json"));
  } else if (command === "rules") {
    cmdRules(path, scopes);
  } else if (command === "route") {
    cmdRoute(client, path, scopes, routeEnvironment());
  } else if (command === "adopt") {
    cmdAdopt(client, positionals[1] || "", scopes);
  } else if (command === "list") {
    cmdList(client, scopes, flags.includes("--json"));
  } else if (command === "doctor") {
    cmdDoctor(client, scopes, flags.includes("--json"));
  } else if (command === "repair") {
    cmdRepair(client, scopes, flags.includes("--dry-run"), flags.includes("--json"));
  } else if (command === "organize") {
    cmdOrganize(client, scopes, flags.includes("--hook"), positionals[1] || "", flags.includes("--json"));
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
