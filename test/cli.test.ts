import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
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

test("globs prints the zsh patterns of the scope owning a path", () => {
  const config = configFile("web = ~/webapp\n");
  expect(run(["globs", `${HOME}/webapp`], config).out).toBe(`${HOME}/webapp ${HOME}/webapp/*`);
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
