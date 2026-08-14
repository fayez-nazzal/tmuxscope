import { expect, test } from "bun:test";
import { parseConfig, ConfigError } from "../src/config.ts";

test("parseConfig reads each scope name and its patterns", () => {
  const text = "api = ~/code/api-service*\nweb = ~/webapp ~/repos/webapp\n";
  expect(parseConfig(text)).toEqual([
    { name: "api", patterns: ["~/code/api-service*"] },
    { name: "web", patterns: ["~/webapp", "~/repos/webapp"] },
  ]);
});

test("parseConfig ignores blank lines and comments", () => {
  const text = "# scopes\n\ndb = ~/code/api-db*\n";
  expect(parseConfig(text)).toEqual([{ name: "db", patterns: ["~/code/api-db*"] }]);
});

test("parseConfig reports the line number of a line without an equals sign", () => {
  expect(() => parseConfig("api = ~/a\ndb ~/b\n")).toThrow(/line 2/);
});

test("parseConfig rejects a scope with no patterns", () => {
  expect(() => parseConfig("api =\n")).toThrow(/no paths/);
});

test("parseConfig rejects a duplicate scope name", () => {
  expect(() => parseConfig("api = ~/a\napi = ~/b\n")).toThrow(/already defined/);
});

test("parseConfig rejects the reserved name misc", () => {
  expect(() => parseConfig("misc = ~/a\n")).toThrow(/reserved/);
});

test("parseConfig rejects a star outside the last path segment", () => {
  expect(() => parseConfig("bad = ~/code*/src\n")).toThrow(/last part of the path/);
});

test("parseConfig errors carry the line number", () => {
  let caught: unknown = null;
  try {
    parseConfig("api = ~/a\nmisc = ~/b\n");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  expect((caught as ConfigError).line).toBe(2);
});
