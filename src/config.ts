import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export const MISC = "misc";
export const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "tmux-scopes.conf");

export type Scope = { name: string; patterns: string[] };

export class ConfigError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ConfigError";
    this.line = line;
  }
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function checkPattern(pattern: string, line: number) {
  const segments = pattern.split("/");
  const starOutsideLast = segments.slice(0, -1).some((segment) => segment.includes("*"));
  if (starOutsideLast) {
    throw new ConfigError(`a star is only allowed in the last part of the path, got ${pattern}`, line);
  }
}

export function parseConfig(text: string): Scope[] {
  const scopes: Scope[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    const number = index + 1;
    const skipped = line.length === 0 || line.startsWith("#");
    if (!skipped) {
      const equals = line.indexOf("=");
      if (equals === -1) {
        throw new ConfigError(`expected "name = paths", got ${line}`, number);
      }
      const name = line.slice(0, equals).trim();
      const patterns = line.slice(equals + 1).trim().split(/\s+/).filter((part) => part.length > 0);
      if (!NAME_PATTERN.test(name)) {
        throw new ConfigError(`scope name may only use letters, digits, dash and underscore, got ${name}`, number);
      }
      if (name === MISC) {
        throw new ConfigError(`${MISC} is reserved for paths that match nothing`, number);
      }
      if (patterns.length === 0) {
        throw new ConfigError(`scope ${name} has no paths`, number);
      }
      if (scopes.some((scope) => scope.name === name)) {
        throw new ConfigError(`scope ${name} is already defined`, number);
      }
      for (const pattern of patterns) {
        checkPattern(pattern, number);
      }
      scopes.push({ name, patterns });
    }
  }
  return scopes;
}

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): Scope[] {
  let scopes: Scope[] = [];
  if (existsSync(path)) {
    scopes = parseConfig(readFileSync(path, "utf8"));
  }
  return scopes;
}
