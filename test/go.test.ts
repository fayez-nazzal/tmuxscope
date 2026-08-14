import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { goTarget, scopeDirectories } from "../src/go.ts";
import { resolveScope } from "../src/resolve.ts";
import { MISC } from "../src/scopes.ts";
import type { Scope } from "../src/scopes.ts";
import type { PathProbe } from "../src/go.ts";

function listDirectory(path: string): string[] {
  let entries: string[] = [];
  if (existsSync(path)) {
    entries = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
  return entries;
}

function probeAt(cwd: string): PathProbe {
  return { exists: existsSync, list: listDirectory, cwd, home: homedir() };
}

const PROBE = probeAt(process.cwd());

test("scopeDirectories lists every existing directory a star pattern matches", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  mkdirSync(join(parent, "proj-one"));
  mkdirSync(join(parent, "proj-two"));
  mkdirSync(join(parent, "other"));
  expect(scopeDirectories(join(parent, "proj-*"), PROBE)).toEqual([join(parent, "proj-one"), join(parent, "proj-two")]);
});

test("scopeDirectories keeps a literal pattern as it is", () => {
  const directory = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  expect(scopeDirectories(directory, PROBE)).toEqual([directory]);
});

test("go with a star pattern lands in a real directory of that scope, never in the parent a wider scope owns", () => {
  const root = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const code = join(root, "code");
  const worktree = join(code, "api-service.tasks-1");
  mkdirSync(code);
  mkdirSync(worktree);
  const scopes: Scope[] = [
    { name: "code", patterns: [code] },
    { name: "api", patterns: [join(code, "api-service*")] },
  ];
  const target = goTarget("api", scopes, PROBE);
  expect(target).toEqual({ scope: "api", cwd: worktree, unknown: false, missing: false });
  expect(resolveScope(target.cwd, scopes).scope).toBe("api");
});

test("go refuses a scope whose star pattern matches no directory on disk", () => {
  const root = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const code = join(root, "code");
  mkdirSync(code);
  const scopes: Scope[] = [
    { name: "code", patterns: [code] },
    { name: "api", patterns: [join(code, "api-service*")] },
  ];
  expect(goTarget("api", scopes, PROBE)).toEqual({ scope: "api", cwd: "", unknown: false, missing: true });
});

test("go refuses a scope whose literal directory does not exist", () => {
  const scopes: Scope[] = [{ name: "web", patterns: ["/nowhere/webapp"] }];
  expect(goTarget("web", scopes, PROBE).missing).toBe(true);
});

test("go misc resolves to the current working directory when nothing owns it", () => {
  const scopes: Scope[] = [{ name: "web", patterns: ["/nowhere/webapp"] }];
  expect(goTarget(MISC, scopes, PROBE)).toEqual({ scope: MISC, cwd: process.cwd(), unknown: false, missing: false });
});

test("go misc leaves a scoped working directory instead of starting misc inside a scope", () => {
  const scoped = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const scopes: Scope[] = [{ name: "web", patterns: [scoped] }];
  expect(goTarget(MISC, scopes, probeAt(scoped))).toEqual({ scope: MISC, cwd: homedir(), unknown: false, missing: false });
});

test("go reports an unknown name instead of exiting from inside a pure function", () => {
  expect(goTarget("nope", [{ name: "web", patterns: ["/w/webapp"] }], PROBE).unknown).toBe(true);
});
