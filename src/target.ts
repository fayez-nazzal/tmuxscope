import { dirname } from "node:path";
import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { expandTilde, resolveScope } from "./match.ts";

export type PathProbe = { exists: (path: string) => boolean; cwd: string };
export type GoTarget = { scope: string; cwd: string; unknown: boolean };

export function scopeDirectory(pattern: string, probe: PathProbe): string {
  const stripped = expandTilde(pattern).replace("*", "");
  let directory = stripped;
  if (!probe.exists(stripped)) {
    directory = dirname(stripped);
  }
  return directory;
}

export function goTarget(nameOrPath: string, scopes: Scope[], probe: PathProbe): GoTarget {
  const target: GoTarget = { scope: nameOrPath, cwd: expandTilde(nameOrPath), unknown: false };
  const known = scopes.find((entry) => entry.name === nameOrPath);
  if (!known && nameOrPath !== MISC) {
    const resolution = resolveScope(expandTilde(nameOrPath), scopes);
    if (resolution.matched === null && !nameOrPath.includes("/")) {
      target.unknown = true;
    }
    target.scope = resolution.scope;
  }
  if (known) {
    const first = known.patterns[0];
    if (first) {
      target.cwd = scopeDirectory(first, probe);
    }
  }
  if (nameOrPath === MISC) {
    target.cwd = probe.cwd;
  }
  return target;
}
