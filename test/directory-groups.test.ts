import { expect, test } from "bun:test";
import { directoryGroup } from "../src/directory-groups.ts";
import type { Scope } from "../src/scopes.ts";

const SCOPES: Scope[] = [
  { name: "code", patterns: ["/work/code"] },
  { name: "feos", patterns: ["/work/feos*"] },
  { name: "specific", patterns: ["/work/feos.fix"] },
];

const WILDCARD_SCOPES = SCOPES.slice(0, 2);

test("an exact configured path owns its descendants", () => {
  expect(directoryGroup("/work/code/src", SCOPES)).toEqual({
    scope: "code",
    root: "/work/code",
    key: "/work/code",
  });
});

test("a final wildcard gives each concrete child directory its own group", () => {
  expect(directoryGroup("/work/feos.fix/src", WILDCARD_SCOPES)).toEqual({
    scope: "feos",
    root: "/work/feos.fix",
    key: "/work/feos.fix",
  });
  expect(directoryGroup("/work/feos.other/src", WILDCARD_SCOPES)).toEqual({
    scope: "feos",
    root: "/work/feos.other",
    key: "/work/feos.other",
  });
});

test("the longest matching configured pattern wins", () => {
  expect(directoryGroup("/work/feos.fix/src", SCOPES).scope).toBe("specific");
});

test("an unmatched path uses its canonical current directory", () => {
  expect(directoryGroup("/work/unclaimed/src", SCOPES)).toEqual({
    scope: "misc",
    root: "/work/unclaimed/src",
    key: "/work/unclaimed/src",
  });
});
