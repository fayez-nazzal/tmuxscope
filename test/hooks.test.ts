import { expect, test } from "bun:test";
import { join } from "node:path";
import { ZSH_HOOK, TMUX_HOOK } from "../src/hooks.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

test("the zsh hook registers chpwd and preexec", () => {
  expect(ZSH_HOOK).toContain("add-zsh-hook chpwd _tmuxscope_chpwd");
  expect(ZSH_HOOK).toContain("add-zsh-hook preexec _tmuxscope_preexec");
});

test("the zsh hook checks the cheap glob before spawning the cli", () => {
  const globLine = ZSH_HOOK.indexOf("TMUXSCOPE_GLOBS");
  const routeLine = ZSH_HOOK.indexOf("tmuxscope route");
  expect(globLine).toBeGreaterThan(-1);
  expect(globLine).toBeLessThan(routeLine);
});

test("the zsh hook is valid zsh", () => {
  const result = Bun.spawnSync(["zsh", "-n", "-c", ZSH_HOOK]);
  expect(result.exitCode).toBe(0);
});

test("the tmux hook wires session-created to adopt", () => {
  expect(TMUX_HOOK.trim()).toBe(`set-hook -g session-created 'run-shell "tmuxscope adopt #{session_id}"'`);
});

test("hook zsh prints the snippet", () => {
  const result = Bun.spawnSync(["bun", CLI, "hook", "zsh"]);
  expect(result.stdout.toString()).toContain("_tmuxscope_chpwd");
  expect(result.exitCode).toBe(0);
});
