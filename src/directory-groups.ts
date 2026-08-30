import { join, relative, resolve as resolvePath } from "node:path";
import type { Scope } from "./scopes.ts";
import { canonical, normalizePattern, resolveScope } from "./resolve.ts";

export type DirectoryGroup = { scope: string; root: string; key: string };

function wildcardRoot(path: string, pattern: string): string {
  const normalized = normalizePattern(pattern);
  const parentEnd = normalized.lastIndexOf("/");
  const parentPattern = parentEnd === -1 ? "." : normalized.slice(0, parentEnd);
  const lexicalParent = resolvePath(parentPattern);
  const lexicalChild = relative(lexicalParent, resolvePath(path)).split("/")[0];
  let root = canonical(path);
  if (lexicalChild && lexicalChild !== ".." && !lexicalChild.startsWith("../")) {
    root = canonical(join(lexicalParent, lexicalChild));
  } else {
    const canonicalParent = canonical(parentPattern);
    const canonicalChild = relative(canonicalParent, canonical(path)).split("/")[0];
    if (canonicalChild && canonicalChild !== ".." && !canonicalChild.startsWith("../")) {
      root = canonical(join(canonicalParent, canonicalChild));
    }
  }
  return root;
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
