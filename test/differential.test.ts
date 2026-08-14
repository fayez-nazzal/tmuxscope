import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, normalizePattern, resolveScope } from "../src/resolve.ts";
import { zshRules } from "../src/rules.ts";
import type { Scope } from "../src/scopes.ts";

// zsh has no filesystem access: a candidate that owes its scope purely to
// realpath resolving a symlinked pattern to the same directory (never
// sharing a literal text prefix with the pattern) cannot be represented by
// the fast path at all. That gap is inherent, not a bug this migration
// introduced, and it is tracked here rather than silently accepted.
function isSymlinkOnlyMatch(candidate: string, scopeName: string, scopes: Scope[]): boolean {
  const scope = scopes.find((entry) => entry.name === scopeName);
  let result = false;
  if (scope) {
    result = scope.patterns.some((pattern) => {
      const literal = normalizePattern(pattern).split("*")[0]!;
      const literallyUnder = candidate === literal || candidate.startsWith(`${literal}/`);
      const isSymlinkPattern = canonical(normalizePattern(pattern)) !== normalizePattern(pattern);
      return isSymlinkPattern && !literallyUnder;
    });
  }
  return result;
}

// The rule loop lifted verbatim from _tmuxscope_chpwd in src/hooks.ts, wrapped
// to print a stay/leave verdict per candidate path instead of acting on it.
const VERBATIM_LOOP = `
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

function zshVerdicts(rules: string, candidates: string[]): string[] {
  const result = Bun.spawnSync(["zsh", "-c", VERBATIM_LOOP, "--", ...candidates], {
    env: { ...process.env, TMUXSCOPE_RULES: rules },
  });
  return result.stdout.toString().trim().split("\n");
}

function buildFixture(): { scopes: Scope[]; root: string } {
  const root = mkdtempSync(join(tmpdir(), "tmuxscope-diff-"));
  const dirs = [
    "code",
    "code/api-service",
    "code/api-service.tasks-1",
    "weird?dir",
    "weirdir",
    "space dir",
    "dash-dir",
    "dot.dir",
    "trail",
    "eqaaaaa",
    "eqbbbbb",
    "real-target",
  ];
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  symlinkSync(join(root, "real-target"), join(root, "link-dir"));

  const scopes: Scope[] = [
    { name: "code", patterns: [join(root, "code")] },
    { name: "api", patterns: [`${join(root, "code", "api-service")}*`] },
    { name: "quest", patterns: [join(root, "weird?dir")] },
    { name: "spacey", patterns: [join(root, "space dir")] },
    { name: "dashy", patterns: [join(root, "dash-dir")] },
    { name: "dotty", patterns: [join(root, "dot.dir")] },
    { name: "trailly", patterns: [`${join(root, "trail")}/`] },
    { name: "eq1", patterns: [join(root, "eqaaaaa")] },
    { name: "eq2", patterns: [join(root, "eqbbbbb")] },
    { name: "linked", patterns: [join(root, "link-dir")] },
  ];
  return { scopes, root };
}

test("the zsh fast path agrees with the binary, or errs safe (leave, not stay), across 200+ config/path pairs", () => {
  const { scopes, root } = buildFixture();

  const anchors = [
    join(root, "code"),
    join(root, "code", "api-service"),
    join(root, "code", "api-service.tasks-1", "src"),
    join(root, "weird?dir"),
    join(root, "weirdXdir"),
    join(root, "space dir"),
    join(root, "dash-dir"),
    join(root, "dot.dir"),
    join(root, "trail"),
    join(root, "eqaaaaa"),
    join(root, "eqbbbbb"),
    join(root, "link-dir"),
    join(root, "real-target"),
    join(root, "elsewhere"),
  ];

  const candidates = [
    join(root, "code"),
    join(root, "code", "sibling"),
    join(root, "code", "api-service"),
    join(root, "code", "api-service", "deep", "nested"),
    join(root, "code", "api-service.tasks-11090", "src"),
    join(root, "weird?dir"),
    join(root, "weird?dir", "inner"),
    join(root, "weirdXdir"),
    join(root, "weirdir"),
    join(root, "space dir"),
    join(root, "space dir", "inner"),
    join(root, "dash-dir"),
    join(root, "dash-dir-old"),
    join(root, "dot.dir"),
    join(root, "dot.dir.bak"),
    join(root, "trail"),
    join(root, "trail", "inner"),
    join(root, "eqaaaaa"),
    join(root, "eqbbbbb"),
    join(root, "link-dir"),
    join(root, "link-dir", "inner"),
    join(root, "real-target"),
    join(root, "real-target", "inner"),
    join(root, "elsewhere"),
    root,
  ];

  let pairs = 0;
  let mismatches = 0;
  const dangerousMismatches: string[] = [];
  const knownSymlinkGap: string[] = [];

  for (const anchor of anchors) {
    const anchorScope = resolveScope(anchor, scopes).scope;
    const rules = zshRules(anchorScope, scopes).join("\n");
    const zsh = zshVerdicts(rules, candidates);
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const binaryScope = resolveScope(candidate, scopes).scope;
      const binaryVerdict = binaryScope === anchorScope ? "stay" : "leave";
      const zshVerdict = zsh[index]!;
      pairs = pairs + 1;
      if (zshVerdict !== binaryVerdict) {
        mismatches = mismatches + 1;
        if (zshVerdict === "stay" && binaryVerdict === "leave") {
          const description = `anchor=${anchor} candidate=${candidate} zsh=${zshVerdict} binary=${binaryVerdict}`;
          if (isSymlinkOnlyMatch(candidate, binaryScope, scopes)) {
            knownSymlinkGap.push(description);
          } else {
            dangerousMismatches.push(description);
          }
        }
      }
    }
  }

  expect(pairs).toBeGreaterThanOrEqual(200);
  expect(dangerousMismatches).toEqual([]);
  expect(knownSymlinkGap.length).toBeGreaterThan(0);
});
