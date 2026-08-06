#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG_PATH, loadConfig, ConfigError, MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { resolveScope, zshGlobs } from "./match.ts";
import { routePlan, sessionForScope } from "./plan.ts";
import type { RouteInput } from "./plan.ts";
import { tmux } from "./tmux.ts";

export const VERSION = "0.1.0";

const HELP = `tmuxscope ${VERSION} — one tmux session per project scope

USAGE
  tmuxscope resolve <path> [--json]   print the scope owning a path
  tmuxscope globs <path>              print the zsh patterns of that scope
  tmuxscope route <path>              hook entry point for a cd that left the scope
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

function cmdGlobs(path: string, scopes: Scope[]) {
  const resolution = resolveScope(path, scopes);
  process.stdout.write(`${zshGlobs(resolution.scope, scopes).join(" ")}\n`);
}

function cmdRoute(path: string, scopes: Scope[]) {
  if (!process.env.TMUX) {
    fail("route only runs inside tmux", 3);
  }
  const state = tmux.state();
  const paneId = process.env.TMUX_PANE || "";
  const originPath = process.env.TMUXSCOPE_ORIGIN || process.cwd();
  const currentWindow = state.windows.find((window) => window.path === originPath);
  let currentSession = MISC;
  if (currentWindow) {
    currentSession = currentWindow.session;
  }
  const paneWork = tmux.paneWork(paneId);
  const panesInSession = tmux.panesInSession(currentSession);
  const routeInput: RouteInput = { target: path, originPath, paneWork, panesInSession, scopes, state };
  const plan = routePlan(routeInput);
  for (const action of plan.actions) {
    tmux.apply(action);
  }
  if (plan.origin === "restore" && process.env.TMUXSCOPE_CD_FILE) {
    writeFileSync(process.env.TMUXSCOPE_CD_FILE, plan.cdPath);
  }
  if (plan.origin === "close" && process.env.TMUXSCOPE_EXEC_FILE) {
    writeFileSync(process.env.TMUXSCOPE_EXEC_FILE, `tmux kill-pane -t ${paneId}\n`);
  }
  if (plan.message) {
    process.stdout.write(`${plan.message}\n`);
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  const flags = rawArgs.filter((arg) => arg.startsWith("-"));
  const positionals = rawArgs.filter((arg) => !arg.startsWith("-"));
  const command = positionals[0] || "";
  const json = flags.includes("--json");
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
  const path = positionals[1] || process.cwd();
  if (command === "resolve") {
    cmdResolve(path, scopes, json);
  } else if (command === "globs") {
    cmdGlobs(path, scopes);
  } else if (command === "route") {
    cmdRoute(path, scopes);
  } else {
    fail(`unknown command ${command}, try --help`, 2);
  }
}

main();
