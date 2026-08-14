import { expect, test } from "bun:test";
import { configReport } from "../src/doctor.ts";
import type { Scope } from "../src/scopes.ts";

function alwaysExists(): boolean {
  return true;
}

test("two scopes with equal-length patterns are flagged ambiguous", () => {
  const scopes: Scope[] = [
    { name: "eq1", patterns: ["/w/eqaaaaa"] },
    { name: "eq2", patterns: ["/w/eqbbbbb"] },
  ];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([
    { kind: "ambiguousLength", scopes: ["eq1", "eq2"], length: 10 },
  ]);
});

test("a pattern whose directory does not exist is flagged missing", () => {
  const scopes: Scope[] = [{ name: "web", patterns: ["/nowhere/webapp"] }];
  expect(configReport(scopes, { exists: () => false })).toEqual([
    { kind: "missingDirectory", scope: "web", pattern: "/nowhere/webapp" },
  ]);
});

test("a star pattern is never flagged missing, its directories are dynamic", () => {
  const scopes: Scope[] = [{ name: "api", patterns: ["/nowhere/api-service*"] }];
  expect(configReport(scopes, { exists: () => false })).toEqual([]);
});

test("two scopes claiming the same directory are flagged duplicate", () => {
  const scopes: Scope[] = [
    { name: "web", patterns: ["/w/webapp"] },
    { name: "site", patterns: ["/w/webapp"] },
  ];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([
    { kind: "ambiguousLength", scopes: ["site", "web"], length: 9 },
    { kind: "duplicateDirectory", scopes: ["site", "web"], directory: "/w/webapp" },
  ]);
});

test("a ? in a pattern is flagged, it matches itself literally not any character", () => {
  const scopes: Scope[] = [{ name: "quest", patterns: ["/w/weird?dir"] }];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([
    { kind: "questionMark", scope: "quest", pattern: "/w/weird?dir" },
  ]);
});

test("a clean config reports nothing", () => {
  const scopes: Scope[] = [
    { name: "web", patterns: ["/w/webapp"] },
    { name: "api", patterns: ["/w/api-service*"] },
  ];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([]);
});
