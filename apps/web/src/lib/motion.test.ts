import { describe, expect, test } from "bun:test";

import { diffIds } from "./motion";

describe("diffIds", () => {
  test("reports ids that appeared and disappeared", () => {
    expect(diffIds(["a", "b", "c"], ["a", "c", "d"])).toEqual({ added: ["d"], removed: ["b"] });
  });

  test("ignores reordering", () => {
    expect(diffIds(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });

  test("a full swap reports everything on both sides", () => {
    expect(diffIds(["a", "b"], ["c", "d"])).toEqual({ added: ["c", "d"], removed: ["a", "b"] });
  });

  test("empty to filled is all additions", () => {
    expect(diffIds([], ["a"])).toEqual({ added: ["a"], removed: [] });
  });
});
