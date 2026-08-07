import { homedir } from "node:os";
import { MISC } from "./config.ts";
import type { Scope } from "./config.ts";

export type Resolution = { scope: string; matched: string | null };

const ZSH_LITERAL = /[^A-Za-z0-9_./-]/g;

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

export function normalizePattern(pattern: string): string {
  return expandTilde(pattern).replace(/\/+$/, "");
}

function patternRegExp(pattern: string): RegExp {
  const escaped = normalizePattern(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped.replace(/\*/g, "[^/]*");
  return new RegExp(`^${globbed}(/.*)?$`);
}

export function matchScore(pattern: string, path: string): number {
  let score = -1;
  if (patternRegExp(pattern).test(path)) {
    score = normalizePattern(pattern).length;
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

function zshGlob(pattern: string): string {
  const segments = normalizePattern(pattern).split("*");
  const escaped = segments.map((segment) => segment.replace(ZSH_LITERAL, "\\$&"));
  return `${escaped.join("[^/]#")}(|/*)`;
}

export function zshRules(scopeName: string, scopes: Scope[]): string[] {
  const ranked: { length: number; rule: string }[] = [];
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      let sign = "-";
      if (scope.name === scopeName) {
        sign = "+";
      }
      ranked.push({ length: normalizePattern(pattern).length, rule: `${sign}${zshGlob(pattern)}` });
    }
  }
  ranked.sort((left, right) => right.length - left.length);
  const rules = ranked.map((entry) => entry.rule);
  if (scopeName === MISC) {
    rules.push("+*");
  }
  return rules;
}
