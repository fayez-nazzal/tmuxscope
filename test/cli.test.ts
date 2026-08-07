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

test("resolve --json with no path argument defaults to the current working directory", () => {
  const config = configFile("api = ~/code/api-service*\n");
  const result = run(["resolve", "--json"], config);
  expect(JSON.parse(result.out)).toMatchObject({ path: process.cwd() });
});

test("rules prints one zsh fast path rule per line for the scope owning a path", () => {
  const config = configFile("web = ~/webapp\n");
  expect(run(["rules", `${HOME}/webapp`], config).out).toBe(`+${HOME}/webapp(|/*)`);
});

test("rules for an unscoped path ends with a catch all so misc stays cheap", () => {
  const config = configFile("web = ~/webapp\n");
  const lines = run(["rules", `${HOME}/Downloads`], config).out.split("\n");
  expect(lines).toEqual([`-${HOME}/webapp(|/*)`, "+*"]);
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
