import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTarget, scopeDirectory } from "../src/target.ts";
import { MISC } from "../src/config.ts";
import type { Scope } from "../src/config.ts";
import type { PathProbe } from "../src/target.ts";

const PROBE: PathProbe = { exists: existsSync, cwd: process.cwd() };

test("scopeDirectory falls back to the parent directory when the star pattern matches no literal directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const pattern = join(parent, "proj-*");
  expect(scopeDirectory(pattern, PROBE)).toBe(parent);
});

test("scopeDirectory keeps the literal directory when it exists on disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  expect(scopeDirectory(directory, PROBE)).toBe(directory);
});

test("go with a scope whose star pattern has no matching directory falls back to the parent", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const scopes: Scope[] = [{ name: "proj", patterns: [join(parent, "proj-*")] }];
  expect(goTarget("proj", scopes, PROBE)).toEqual({ scope: "proj", cwd: parent, unknown: false });
});

test("go misc resolves to the current working directory", () => {
  expect(goTarget(MISC, [], PROBE)).toEqual({ scope: MISC, cwd: process.cwd(), unknown: false });
});

test("go reports an unknown name instead of exiting from inside a pure function", () => {
  expect(goTarget("nope", [{ name: "web", patterns: ["/w/webapp"] }], PROBE).unknown).toBe(true);
});
