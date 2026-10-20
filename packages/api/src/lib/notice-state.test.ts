import { describe, expect, it } from "bun:test";

import { isNoticeExpanded, parseExpandedNotices, withNoticeExpanded } from "./notice-state";

describe("notice state", () => {
  it("starts collapsed", () => {
    expect(parseExpandedNotices(null)).toEqual([]);
    expect(isNoticeExpanded([], "energy")).toBe(false);
  });

  it("opens and closes one notice, remembered per id", () => {
    const open = withNoticeExpanded([], "energy", true);
    expect(isNoticeExpanded(open, "energy")).toBe(true);
    expect(isNoticeExpanded(open, "calibration")).toBe(false);
    expect(withNoticeExpanded(open, "energy", false)).toEqual([]);
  });

  it("returns the same array when nothing changes", () => {
    const open = withNoticeExpanded([], "energy", true);
    expect(withNoticeExpanded(open, "energy", true)).toBe(open);
    const none: readonly string[] = [];
    expect(withNoticeExpanded(none, "energy", false)).toBe(none);
  });

  it("round-trips through JSON and survives damaged text", () => {
    const stored = JSON.stringify(withNoticeExpanded(withNoticeExpanded([], "a", true), "b", true));
    expect(parseExpandedNotices(stored)).toEqual(["a", "b"]);
    expect(parseExpandedNotices("nope")).toEqual([]);
    expect(parseExpandedNotices('{"a":1}')).toEqual([]);
    expect(parseExpandedNotices('["a",3,"","a"]')).toEqual(["a"]);
  });
});
