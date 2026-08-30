import type { Scope } from "./scopes.ts";
import { normalizePattern } from "./resolve.ts";

const ZSH_METACHARACTER = /[*?[\]()|^~#<>\\]/g;

function zshGlob(pattern: string): string {
  const segments = normalizePattern(pattern).split("*");
  const escaped = segments.map((segment) => segment.replace(ZSH_METACHARACTER, "\\$&"));
  return `${escaped.join("[^/]#")}(|/*)`;
}

export function zshRules(scopeName: string, scopes: Scope[]): string[] {
  const ranked: { length: number; rule: string }[] = [];
  for (const scope of scopes) {
    for (const pattern of scope.patterns) {
      let sign = "-";
      if (scope.name === scopeName && !pattern.includes("*")) {
        sign = "+";
      }
      ranked.push({ length: normalizePattern(pattern).length, rule: `${sign}${zshGlob(pattern)}` });
    }
  }
  ranked.sort((left, right) => right.length - left.length);
  const rules = ranked.map((entry) => entry.rule);
  return rules;
}
