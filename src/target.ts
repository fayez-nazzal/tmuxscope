import { dirname, join } from "node:path";
import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";
import { expandTilde, matchScore, normalizePattern, resolveScope } from "./match.ts";

export type PathProbe = { exists: (path: string) => boolean; list: (path: string) => string[]; cwd: string; home: string };
export type GoTarget = { scope: string; cwd: string; unknown: boolean; missing: boolean };

export function scopeDirectories(pattern: string, probe: PathProbe): string[] {
  const expanded = normalizePattern(pattern);
  const directories: string[] = [];
  if (expanded.includes("*")) {
    const parent = dirname(expanded);
    for (const entry of probe.list(parent)) {
      const candidate = join(parent, entry);
      if (matchScore(pattern, candidate) >= 0) {
        directories.push(candidate);
      }
    }
    directories.sort();
  } else {
    directories.push(expanded);
  }
  return directories;
}

function scopeCwd(scope: Scope, scopes: Scope[], probe: PathProbe): string {
  let cwd = "";
  for (const pattern of scope.patterns) {
    for (const directory of scopeDirectories(pattern, probe)) {
      const owned = resolveScope(directory, scopes).scope === scope.name;
      if (cwd === "" && owned && probe.exists(directory)) {
        cwd = directory;
      }
    }
  }
  return cwd;
}

function miscCwd(scopes: Scope[], probe: PathProbe): string {
  let cwd = "";
  if (resolveScope(probe.cwd, scopes).scope === MISC) {
    cwd = probe.cwd;
  }
  if (cwd === "" && resolveScope(probe.home, scopes).scope === MISC) {
    cwd = probe.home;
  }
  return cwd;
}

export function goTarget(nameOrPath: string, scopes: Scope[], probe: PathProbe): GoTarget {
  const target: GoTarget = { scope: nameOrPath, cwd: expandTilde(nameOrPath), unknown: false, missing: false };
  const known = scopes.find((entry) => entry.name === nameOrPath);
  if (!known && nameOrPath !== MISC) {
    const resolution = resolveScope(expandTilde(nameOrPath), scopes);
    if (resolution.matched === null && !nameOrPath.includes("/")) {
      target.unknown = true;
    }
    target.scope = resolution.scope;
  }
  if (known) {
    target.cwd = scopeCwd(known, scopes, probe);
    target.missing = target.cwd === "";
  }
  if (nameOrPath === MISC) {
    target.cwd = miscCwd(scopes, probe);
    target.missing = target.cwd === "";
  }
  return target;
}
