import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZSH_HOOK, TMUX_HOOK, TMUX_ADOPT_COMMAND } from "../src/hooks.ts";

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
  expect(TMUX_HOOK.trim()).toBe(`set-hook -g session-created "run-shell \\"tmuxscope adopt '#{session_id}'\\""`);
});

test("the tmux hook quotes the session id so a shell does not read it as a positional parameter", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmuxscope-hook-"));
  const stub = join(dir, "tmuxscope");
  writeFileSync(stub, "#!/bin/sh\necho \"ARGS:$@\"\n");
  chmodSync(stub, 0o755);
  const command = TMUX_ADOPT_COMMAND.replace("#{session_id}", "$5");
  const result = Bun.spawnSync(["sh", "-c", command], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  expect(result.stdout.toString().trim()).toBe("ARGS:adopt $5");
});

test("hook zsh prints the snippet", () => {
  const result = Bun.spawnSync(["bun", CLI, "hook", "zsh"]);
  expect(result.stdout.toString()).toContain("_tmuxscope_chpwd");
  expect(result.exitCode).toBe(0);
});

test("hook with a missing argument exits 2", () => {
  const result = Bun.spawnSync(["bun", CLI, "hook"]);
  expect(result.exitCode).toBe(2);
});

test("hook with an unknown argument exits 2", () => {
  const result = Bun.spawnSync(["bun", CLI, "hook", "bogus"]);
  expect(result.exitCode).toBe(2);
});

function classifyPreexec(command: string): string {
  const script = `
${ZSH_HOOK}
tmux() {
  if [[ "$3" == "@tmuxscope_work" ]]; then
    print -r -- WORK
  fi
}
_tmuxscope_preexec "$1"
`;
  const result = Bun.spawnSync(["zsh", "-c", script, "--", command]);
  let verdict = "free";
  if (result.stdout.toString().includes("WORK")) {
    verdict = "work";
  }
  return verdict;
}

test("preexec marks work by shell metacharacters, not by the leading word", () => {
  expect(classifyPreexec("cd /tmp")).toBe("free");
  expect(classifyPreexec("z myproject")).toBe("free");
  expect(classifyPreexec("cd /tmp && rm -rf important")).toBe("work");
  expect(classifyPreexec("cd /tmp; npm test")).toBe("work");
  expect(classifyPreexec("npm test")).toBe("work");
  expect(classifyPreexec("cd /tmp & rm -rf important")).toBe("work");
  expect(classifyPreexec("cd /tmp && npm test")).toBe("work");
  expect(classifyPreexec("cd /tmp")).toBe("free");
});
