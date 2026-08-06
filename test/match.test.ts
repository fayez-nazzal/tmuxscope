import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { expandTilde, matchScore, resolveScope, zshGlobs } from "../src/match.ts";
import type { Scope } from "../src/config.ts";

const HOME = homedir();

const SCOPES: Scope[] = [
  { name: "code", patterns: ["~/code"] },
  { name: "api", patterns: ["~/code/api-service*"] },
  { name: "web", patterns: ["~/webapp", "~/repos/webapp"] },
];

test("expandTilde turns a leading tilde into the home directory", () => {
  expect(expandTilde("~/code")).toBe(`${HOME}/code`);
  expect(expandTilde("/tmp/x")).toBe("/tmp/x");
});

test("matchScore returns -1 when the path is outside the pattern", () => {
  expect(matchScore("~/webapp", `${HOME}/code`)).toBe(-1);
});

test("matchScore covers the directory itself and everything under it", () => {
  expect(matchScore("~/webapp", `${HOME}/webapp`)).toBeGreaterThan(0);
  expect(matchScore("~/webapp", `${HOME}/webapp/src/app`)).toBeGreaterThan(0);
});

test("matchScore does not match a sibling with the same prefix", () => {
  expect(matchScore("~/webapp", `${HOME}/webapp-old`)).toBe(-1);
});

test("resolveScope matches a worktree suffix through a star", () => {
  expect(resolveScope(`${HOME}/code/api-service.tasks-11090/src`, SCOPES)).toEqual({
    scope: "api",
    matched: "~/code/api-service*",
  });
});

test("resolveScope prefers the longer pattern when two match", () => {
  expect(resolveScope(`${HOME}/code/api-service`, SCOPES).scope).toBe("api");
  expect(resolveScope(`${HOME}/code/parser`, SCOPES).scope).toBe("code");
});

test("resolveScope falls back to misc with no matched pattern", () => {
  expect(resolveScope(`${HOME}/Downloads`, SCOPES)).toEqual({ scope: "misc", matched: null });
});

test("zshGlobs returns the expanded patterns of one scope", () => {
  expect(zshGlobs("web", SCOPES)).toEqual([`${HOME}/webapp`, `${HOME}/webapp/*`, `${HOME}/repos/webapp`, `${HOME}/repos/webapp/*`]);
});

test("zshGlobs returns nothing for misc", () => {
  expect(zshGlobs("misc", SCOPES)).toEqual([]);
});
