import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTarget, scopeDirectory } from "../src/cli.ts";
import { MISC } from "../src/config.ts";
import type { Scope } from "../src/config.ts";

test("scopeDirectory falls back to the parent directory when the star pattern matches no literal directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const pattern = join(parent, "proj-*");
  expect(scopeDirectory(pattern)).toBe(parent);
});

test("scopeDirectory keeps the literal directory when it exists on disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  expect(scopeDirectory(directory)).toBe(directory);
});

test("go with a scope whose star pattern has no matching directory falls back to the parent", () => {
  const parent = mkdtempSync(join(tmpdir(), "tmuxscope-"));
  const scopes: Scope[] = [{ name: "proj", patterns: [join(parent, "proj-*")] }];
  expect(goTarget("proj", scopes)).toEqual({ scope: "proj", cwd: parent });
});

test("go misc resolves to the current working directory", () => {
  expect(goTarget(MISC, [])).toEqual({ scope: MISC, cwd: process.cwd() });
});
