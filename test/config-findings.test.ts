import { expect, test } from "bun:test";
import { configReport } from "../src/doctor.ts";
import { normalizePattern } from "../src/resolve.ts";
import type { Scope } from "../src/scopes.ts";

function alwaysExists(): boolean {
  return true;
}

test("configReport does not flag equal-length disjoint wildcard patterns", () => {
  const scopes: Scope[] = [
    { name: "feos", patterns: ["~/rayyan/rayyan-feos*"] },
    { name: "ruby", patterns: ["~/rayyan/rayyan-ruby*"] },
  ];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([]);
});

test("configReport flags equal-length overlapping wildcard patterns", () => {
  const scopes: Scope[] = [
    { name: "zeta", patterns: ["~/rayyan/rayyan-fe*os*"] },
    { name: "alpha", patterns: ["~/rayyan/rayyan-f*eos*"] },
  ];
  expect(configReport(scopes, { exists: alwaysExists })).toEqual([
    { kind: "ambiguousLength", scopes: ["alpha", "zeta"], length: normalizePattern("~/rayyan/rayyan-fe*os*").length },
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
