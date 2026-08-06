import { homedir } from "node:os";
import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";

export type Resolution = { scope: string; matched: string | null };

export function expandTilde(path: string): string {
  let expanded = path;
  if (path === "~") {
    expanded = homedir();
  }
  if (path.startsWith("~/")) {
    expanded = `${homedir()}/${path.slice(2)}`;
  }
  return expanded;
}

function patternRegExp(pattern: string): RegExp {
  const expanded = expandTilde(pattern).replace(/\/+$/, "");
  const escaped = expanded.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped.replace(/\*/g, "[^/]*");
  return new RegExp(`^${globbed}(/.*)?$`);
}

export function matchScore(pattern: string, path: string): number {
  let score = -1;
  if (patternRegExp(pattern).test(path)) {
    score = expandTilde(pattern).length;
  }
  return score;
}

export function resolveScope(path: string, scopes: Scope[]): Resolution {
  const resolution: Resolution = { scope: MISC, matched: null };
  let best = -1;
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      const score = matchScore(pattern, path);
      if (score > best) {
        best = score;
        resolution.scope = scope.name;
        resolution.matched = pattern;
      }
    }
  }
  return resolution;
}

export function zshGlobs(scopeName: string, scopes: Scope[]): string[] {
  const globs: string[] = [];
  for (const scope of scopes) {
    if (scope.name === scopeName) {
      for (const pattern of scope.patterns) {
        const expanded = expandTilde(pattern).replace(/\/+$/, "");
        globs.push(expanded);
        globs.push(`${expanded}/*`);
      }
    }
  }
  return globs;
}
