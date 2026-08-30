import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const HOME = homedir();

function configFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const path = join(dir, "scopes.conf");
  writeFileSync(path, text);
  return path;
}

function run(args: string[], config: string) {
  const result = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, TMUXSCOPE_CONFIG: config } });
  return { out: result.stdout.toString().trim(), err: result.stderr.toString().trim(), code: result.exitCode };
}

test("resolve prints the owning scope", () => {
  const config = configFile("api = ~/code/api-service*\n");
  expect(run(["resolve", `${HOME}/code/api-service.tasks-1/src`], config)).toMatchObject({ out: "api", code: 0 });
});

test("resolve prints misc for an unmatched path", () => {
  const config = configFile("api = ~/code/api-service*\n");
  expect(run(["resolve", `${HOME}/Downloads`], config)).toMatchObject({ out: "misc", code: 0 });
});

test("resolve --json reports the matched pattern", () => {
  const config = configFile("api = ~/code/api-service*\n");
  const result = run(["resolve", `${HOME}/code/api-service`, "--json"], config);
  expect(JSON.parse(result.out)).toMatchObject({ scope: "api", matched: "~/code/api-service*" });
});

test("resolve --json no longer carries a session key", () => {
  const config = configFile("api = ~/code/api-service*\n");
  const result = run(["resolve", `${HOME}/code/api-service`, "--json"], config);
  expect(Object.keys(JSON.parse(result.out)).sort()).toEqual(["matched", "path", "scope"]);
});

test("resolve --json succeeds with tmux removed from PATH, the one pure question in the tool", () => {
  const config = configFile("api = ~/code/api-service*\n");
  const which = Bun.spawnSync(["which", "tmux"]);
  const tmuxPath = which.stdout.toString().trim();
  let strippedPath = process.env.PATH!;
  if (tmuxPath) {
    const { dirname } = require("node:path") as typeof import("node:path");
    strippedPath = process.env
      .PATH!.split(":")
      .filter((entry) => entry !== dirname(tmuxPath))
      .join(":");
  }
  const result = Bun.spawnSync([process.execPath, CLI, "resolve", `${HOME}/code/api-service`, "--json"], {
    env: { ...process.env, TMUXSCOPE_CONFIG: config, PATH: strippedPath },
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim())).toMatchObject({ scope: "api" });
});

test("resolve --json with no path argument defaults to the current working directory", () => {
  const config = configFile("api = ~/code/api-service*\n");
  const result = run(["resolve", "--json"], config);
  expect(JSON.parse(result.out)).toMatchObject({ path: process.cwd() });
});

test("rules prints one zsh fast path rule per line for the scope owning a path", () => {
  const config = configFile("web = ~/webapp\n");
  expect(run(["rules", `${HOME}/webapp`], config).out).toBe(`+${HOME}/webapp(|/*)`);
});

test("rules for an unscoped path leave routing enabled", () => {
  const config = configFile("web = ~/webapp\n");
  const lines = run(["rules", `${HOME}/Downloads`], config).out.split("\n");
  expect(lines).toEqual([`-${HOME}/webapp(|/*)`]);
  expect(lines.filter((line) => line.startsWith("+"))).toEqual([]);
});

test("a broken config exits 2 and names the line", () => {
  const config = configFile("api ~/code\n");
  const result = run(["resolve", HOME], config);
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/line 1/);
});

test("route outside tmux exits 3", () => {
  const config = configFile("web = ~/webapp\n");
  const result = Bun.spawnSync(["bun", CLI, "route", `${HOME}/webapp`], {
    env: { ...process.env, TMUXSCOPE_CONFIG: config, TMUX: "" },
  });
  expect(result.exitCode).toBe(3);
});

test("route without a pane of its own exits 3 instead of guessing misc", () => {
  const config = configFile("web = ~/webapp\n");
  const result = Bun.spawnSync(["bun", CLI, "route", `${HOME}/webapp`], {
    env: { ...process.env, TMUXSCOPE_CONFIG: config, TMUX: "/tmp/fake,1,0", TMUX_PANE: "" },
  });
  expect(result.exitCode).toBe(3);
  expect(result.stderr.toString()).toContain("TMUX_PANE");
});

test("globs is gone, the older name of rules no longer answers", () => {
  const config = configFile("web = ~/webapp\n");
  const result = Bun.spawnSync(["bun", CLI, "globs", `${HOME}`], { env: { ...process.env, TMUXSCOPE_CONFIG: config } });
  expect(result.exitCode).toBe(2);
});

function stubbedTmux(): string {
  const dir = mkdtempSync(join(tmpdir(), "tmuxscope-go-"));
  const stub = join(dir, "tmux");
  writeFileSync(stub, "#!/bin/sh\nexit 0\n");
  chmodSync(stub, 0o755);
  return dir;
}

test("go refuses a scope with no directory on disk instead of creating a session adopt will dismantle", () => {
  const config = configFile("code = /nowhere/code\napi = /nowhere/code/api-service*\n");
  const stub = stubbedTmux();
  const env = { ...process.env, TMUXSCOPE_CONFIG: config, PATH: `${stub}:${process.env.PATH}` };
  const result = Bun.spawnSync(["bun", CLI, "go", "api"], { env });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("has no directory to start in");
});

test("doctor also reads the config, not only the sessions", () => {
  const config = configFile("quest = /nowhere/weird?dir\n");
  const stub = stubbedTmux();
  const env = { ...process.env, TMUXSCOPE_CONFIG: config, PATH: `${stub}:${process.env.PATH}` };
  const result = Bun.spawnSync(["bun", CLI, "doctor"], { env });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toContain("? in a pattern");
  expect(result.stdout.toString()).toContain("missing directory");
});

test("--help documents every exit code the tool promises", () => {
  const result = Bun.spawnSync(["bun", CLI, "--help"]);
  const out = result.stdout.toString();
  expect(out).toContain("EXIT CODES");
  expect(out).toContain("0  clean");
  expect(out).toContain("1  the invariant is still broken");
  expect(out).toContain("2  bad input");
  expect(out).toContain("3  wrong environment");
  expect(out).toContain("4  a tmux call failed");
});

test("doctor --json keeps exit code 1 and carries the config findings", () => {
  const config = configFile("quest = /nowhere/weird?dir\n");
  const stub = stubbedTmux();
  const env = { ...process.env, TMUXSCOPE_CONFIG: config, PATH: `${stub}:${process.env.PATH}` };
  const result = Bun.spawnSync(["bun", CLI, "doctor", "--json"], { env });
  expect(result.exitCode).toBe(1);
  const report = JSON.parse(result.stdout.toString());
  expect(report).toMatchObject({ mixed: [], split: [], ambiguous: [], problems: 0 });
  expect(report.config.length).toBe(2);
});

test("--version reports the version in package.json", () => {
  const packageJson = require("../package.json") as { version: string };
  const result = Bun.spawnSync(["bun", CLI, "--version"]);
  expect(result.stdout.toString().trim()).toBe(packageJson.version);
});
