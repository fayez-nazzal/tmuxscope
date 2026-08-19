import { join, relative } from "node:path";
import type { Scope } from "./scopes.ts";
import { canonical, normalizePattern, resolveScope } from "./resolve.ts";

export type DirectoryGroup = { scope: string; root: string; key: string };

function wildcardRoot(path: string, pattern: string): string {
  const normalized = normalizePattern(pattern);
  const parentEnd = normalized.lastIndexOf("/");
  const parentPattern = parentEnd === -1 ? "." : normalized.slice(0, parentEnd);
  const parent = canonical(parentPattern);
  const child = relative(parent, canonical(path)).split("/")[0];
  return canonical(join(parent, child));
}

export function directoryGroup(path: string, scopes: Scope[]): DirectoryGroup {
  const current = canonical(path);
  const resolution = resolveScope(path, scopes);
  let root = current;
  if (resolution.matched) {
    if (resolution.matched.includes("*")) {
      root = wildcardRoot(path, resolution.matched);
    } else {
      root = canonical(normalizePattern(resolution.matched));
    }
  }
  return { scope: resolution.scope, root, key: root };
}
