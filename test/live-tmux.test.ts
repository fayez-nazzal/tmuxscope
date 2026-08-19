import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TMUX_ADOPT_COMMAND } from "../src/hooks.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

// ONE live tmux round trip, isolated on a private socket ("-f /dev/null -S")
// that never touches the owner's real server or ~/.tmux.conf, and a fake HOME
// so nothing here can reach ~/.zshrc either. No stub anywhere: this drives a
// real interactive zsh sourcing the real ZSH_HOOK, against the real binary,
// through a real tmux server we own end to end.
function run(socket: string, args: string[]): string {
  const result = Bun.spawnSync(["tmux", "-S", socket, ...args]);
  return result.stdout.toString().trim();
}

test("a real cd through the real hook and binary lands the pane right and leaves doctor clean", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tmuxscope-live-")));
  const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "tmuxscope-live-home-")));
  const work = join(root, "work");
  const worktree = join(root, "work.fix");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(work);
  mkdirSync(worktree);
  mkdirSync(elsewhere);
  const config = join(root, "scopes.conf");
  writeFileSync(config, `work = ${join(root, "work*")}\n`);
  const socket = join(root, "tmux.sock");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "tmuxscope"), `#!/bin/sh\nexec bun "${CLI}" "$@"\n`);
  chmodSync(join(bin, "tmuxscope"), 0o755);

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMUXSCOPE_CONFIG: config, HOME: fakeHome };
  const hookFile = join(root, "hook.zsh");
  writeFileSync(hookFile, Bun.spawnSync(["bun", CLI, "hook", "zsh"], { env }).stdout.toString());

  let serverStarted = false;
  try {
    Bun.spawnSync(["tmux", "-f", "/dev/null", "-S", socket, "start-server"], { env });
    serverStarted = true;
    Bun.spawnSync(["tmux", "-S", socket, "set-hook", "-g", "session-created", `run-shell "${TMUX_ADOPT_COMMAND}"`], { env });
    Bun.spawnSync(["tmux", "-S", socket, "new-session", "-d", "-s", "seed", "-c", work, "--", "zsh", "-f"], { env });

    const pane = run(socket, ["list-panes", "-t", "seed", "-F", "#{pane_id}"]);
    Bun.spawnSync(["tmux", "-S", socket, "send-keys", "-t", pane, `source ${hookFile}`, "Enter"], { env });
    Bun.spawnSync(["tmux", "-S", socket, "send-keys", "-t", pane, `cd ${worktree}`, "Enter"], { env });

    const deadline = Date.now() + 15000;
    let windows: string[] = [];
    let worktreeLanded = false;
    while (Date.now() < deadline && !worktreeLanded) {
      windows = run(socket, ["list-windows", "-a", "-F", "#{session_name} #{pane_current_path}"]).split("\n");
      worktreeLanded = windows.includes(`seed ${work}`) && windows.includes(`seed ${worktree}`);
      if (!worktreeLanded) {
        Bun.sleepSync(50);
      }
    }
    expect(windows).toContain(`seed ${work}`);
    expect(windows).toContain(`seed ${worktree}`);

    Bun.spawnSync(["tmux", "-S", socket, "send-keys", "-t", pane, `cd ${elsewhere}`, "Enter"], { env });
    let elsewhereLanded = false;
    while (Date.now() < deadline && !elsewhereLanded) {
      windows = run(socket, ["list-windows", "-a", "-F", "#{session_name} #{pane_current_path}"]).split("\n");
      elsewhereLanded = windows.includes(`misc ${elsewhere}`);
      if (!elsewhereLanded) {
        Bun.sleepSync(50);
      }
    }
    expect(windows).toContain(`misc ${elsewhere}`);
    expect(windows).toContain(`seed ${work}`);
    expect(windows).toContain(`seed ${worktree}`);

    const pid = run(socket, ["display-message", "-p", "#{pid}"]);
    const doctor = Bun.spawnSync(["bun", CLI, "doctor"], { env: { ...env, TMUX: `${socket},${pid},0` } });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout.toString()).toContain("all clean");
  } finally {
    if (serverStarted) {
      Bun.spawnSync(["tmux", "-S", socket, "kill-server"]);
    }
  }
});
