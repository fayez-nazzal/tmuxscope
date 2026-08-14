import { MISC } from "./scopes.ts";
import type { Scope } from "./scopes.ts";
import { normalizePattern } from "./resolve.ts";

const ZSH_LITERAL = /[^A-Za-z0-9_./-]/g;

function zshGlob(pattern: string): string {
  const segments = normalizePattern(pattern).split("*");
  const escaped = segments.map((segment) => segment.replace(ZSH_LITERAL, "\\$&"));
  return `${escaped.join("[^/]#")}(|/*)`;
}

export function zshGlobs(scopeName: string, scopes: Scope[]): string[] {
  const globs: string[] = [];
  for (const scope of scopes) {
    if (scope.name === scopeName) {
      for (const pattern of scope.patterns) {
        const expanded = normalizePattern(pattern);
        globs.push(expanded);
        globs.push(`${expanded}/*`);
      }
    }
  }
  return globs;
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
