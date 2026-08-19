import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { expandTilde, matchScore, normalizePattern, resolveScope } from "../src/resolve.ts";
import { zshRules } from "../src/rules.ts";
import type { Scope } from "../src/scopes.ts";

const HOME = homedir();

const SCOPES: Scope[] = [
  { name: "code", patterns: ["~/code"] },
  { name: "api", patterns: ["~/code/api-service*"] },
  { name: "web", patterns: ["~/webapp", "~/repos/webapp"] },
];

const PATHS = [
  `${HOME}/code`,
  `${HOME}/code/parser`,
  `${HOME}/code/api-service`,
  `${HOME}/code/api-service.tasks-11090/src`,
  `${HOME}/webapp`,
  `${HOME}/webapp/app/src`,
  `${HOME}/repos/webapp`,
  `${HOME}/Downloads`,
  `${HOME}`,
];

function fastPath(scopeName: string, paths: string[], scopes: Scope[]): string[] {
  const script = `
setopt extended_glob
for target in "$@"; do
  verdict=leave
  for rule in \${(f)TMUXSCOPE_RULES}; do
    if [[ "$target" == \${~rule[2,-1]} ]]; then
      [[ "\${rule[1]}" == "+" ]] && verdict=stay
      break
    fi
  done
  print -r -- "$verdict"
done
`;
  const env = { ...process.env, TMUXSCOPE_RULES: zshRules(scopeName, scopes).join("\n") };
  const result = Bun.spawnSync(["zsh", "-c", script, "--", ...paths], { env });
  return result.stdout.toString().trim().split("\n");
}

test("expandTilde turns a leading tilde into the home directory", () => {
  expect(expandTilde("~/code")).toBe(`${HOME}/code`);
  expect(expandTilde("/tmp/x")).toBe("/tmp/x");
});

test("normalizePattern expands the tilde and drops trailing slashes", () => {
  expect(normalizePattern("~/webapp/")).toBe(`${HOME}/webapp`);
  expect(normalizePattern("/w/webapp///")).toBe("/w/webapp");
});

test("a trailing slash does not change how a pattern scores", () => {
  expect(matchScore("~/webapp/", `${HOME}/webapp`)).toBe(matchScore("~/webapp", `${HOME}/webapp`));
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

test("zshRules puts the longest pattern first and marks the owning scope with a plus", () => {
  const rules = zshRules("code", SCOPES);
  expect(rules[0]).toBe(`-${HOME}/code/api-service[^/]#(|/*)`);
  expect(rules).toContain(`+${HOME}/code(|/*)`);
});

test("zshRules routes unmatched directories so each directory can be its own group", () => {
  const rules = zshRules("misc", SCOPES);
  expect(rules.filter((rule) => rule.startsWith("+"))).toEqual([]);
  expect(fastPath("misc", ["/tmp/unmatched-one", "/tmp/unmatched-two"], SCOPES)).toEqual(["leave", "leave"]);
});

test("wildcard scope rules route between worktrees", () => {
  const scopes: Scope[] = [{ name: "work", patterns: ["/tmp/work*"] }];
  const rules = zshRules("work", scopes);
  expect(rules).toEqual(["-/tmp/work[^/]#(|/*)"]);
  expect(fastPath("work", ["/tmp/work.fix", "/tmp/work.other"], scopes)).toEqual(["leave", "leave"]);
});

test("the zsh fast path routes a parent scope for a nested worktree", () => {
  const nested = `${HOME}/code/api-service.tasks-11090/src`;
  expect(resolveScope(nested, SCOPES).scope).toBe("api");
  expect(fastPath("code", [nested], SCOPES)).toEqual(["leave"]);
  expect(fastPath("api", [nested], SCOPES)).toEqual(["leave"]);
});

test("the zsh fast path agrees with resolveScope for every scope and path", () => {
  const scopeNames = [...SCOPES.map((scope) => scope.name), "misc"];
  for (const scopeName of scopeNames) {
    const verdicts = fastPath(scopeName, PATHS, SCOPES);
    const expected = PATHS.map((path) => {
      let verdict = "leave";
      const resolution = resolveScope(path, SCOPES);
      if (resolution.scope === scopeName && resolution.matched && !resolution.matched.includes("*")) {
        verdict = "stay";
      }
      return verdict;
    });
    expect(verdicts).toEqual(expected);
  }
});

test("a ? in a pattern matches itself literally, never as a single-character wildcard", () => {
  expect(matchScore("~/a?b", `${HOME}/axb`)).toBe(-1);
  expect(matchScore("~/a?b", `${HOME}/a?b`)).toBeGreaterThan(0);
});
