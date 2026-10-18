import { describe, expect, test } from "bun:test";

import { evalCondition, lookupPath, resolveExpr, resolveNum, type Env } from "./expr";
import type { Issue } from "./scene";

function env(data: Record<string, unknown>, locale: "id" | "en" = "id"): Env {
  const issues: Issue[] = [];
  return {
    locale,
    issues,
    get: (path) => lookupPath(data, path),
    t: (key, args) => `${key}:${JSON.stringify(args)}`,
  };
}

describe("string templates", () => {
  const e = env({ kcal: 1234.5, name: "  Nasi   goreng ", n: { a: [10, 20] }, empty: "", zero: 0 });

  test("interpolates paths and filters", () => {
    expect(resolveExpr("{kcal|int} kcal", e)).toBe("1.235 kcal");
    expect(resolveExpr("{kcal|num:1}", e)).toBe("1.234,5");
    expect(resolveExpr("{n.a.1|int}", e)).toBe("20");
    expect(resolveExpr("{zero|int}", e)).toBe("0");
    expect(resolveExpr("{name|upper}", e)).toBe("NASI GORENG");
    expect(resolveExpr("{name|first}", e)).toBe("Nasi");
  });

  test("english separators", () => {
    expect(resolveExpr("{kcal|int}", env({ kcal: 1234.5 }, "en"))).toBe("1,235");
  });

  test("any missing placeholder makes the whole expression missing", () => {
    expect(resolveExpr("{nope|int} kcal", e)).toBeUndefined();
    expect(resolveExpr("{empty}", e)).toBeUndefined();
    expect(resolveExpr("a {kcal|int} b {nope}", e)).toBeUndefined();
    expect(resolveExpr("{kcal|date:short}", e)).toBeUndefined();
  });

  test("optional and default placeholders", () => {
    expect(resolveExpr("a{nope?}b", e)).toBe("ab");
    expect(resolveExpr("{nope|default:0|int}", e)).toBe("0");
    expect(resolveExpr("{nope|default:-}", e)).toBe("-");
  });

  test("escaped braces and malformed braces stay literal", () => {
    expect(resolveExpr("{{x}} and {", e)).toBe("{x} and {");
    expect(resolveExpr("{1bad} {a b}", e)).toBe("{1bad} {a b}");
  });

  test("unknown filters are missing and reported", () => {
    const local = env({ a: 1 });
    expect(resolveExpr("{a|wat}", local)).toBeUndefined();
    expect(local.issues[0]?.code).toBe("unknown-filter");
  });

  test("user text is sanitized and long names do not break", () => {
    const out = resolveExpr("{n}", env({ n: "Mie \u{1F35C}\u{1F525} pedas" }));
    expect(out).toBe("Mie pedas");
  });

  test("numbers without a filter print sensibly", () => {
    expect(resolveExpr("{v}", env({ v: 12 }))).toBe("12");
    expect(resolveExpr("{v}", env({ v: 12.34 }))).toBe("12,3");
    expect(resolveExpr("{v}", env({ v: NaN }))).toBeUndefined();
  });

  test("objects and arrays are not printable", () => {
    expect(resolveExpr("{o}", env({ o: { a: 1 } }))).toBeUndefined();
  });
});

describe("i18n expressions", () => {
  test("args resolve first; count stays numeric", () => {
    const e = env({ days: 5, who: "Rani" });
    expect(resolveExpr({ t: "k.days", args: { count: "{days}", name: "{who}" } }, e)).toBe(
      'k.days:{"count":5,"name":"Rani"}',
    );
  });

  test("a missing arg makes it missing", () => {
    expect(resolveExpr({ t: "k", args: { x: "{nope}" } }, env({}))).toBeUndefined();
  });

  test("an untranslated key (translator echoes the key) is missing", () => {
    const e = { ...env({}), t: (key: string) => key };
    expect(resolveExpr({ t: "k.unknown" }, e)).toBeUndefined();
  });
});

describe("NumRef and conditions", () => {
  const e = env({ a: 50, b: 200, s: "12.5", z: 0 });

  test("ratios, clamps and arithmetic", () => {
    expect(resolveNum({ bind: "a", div: "b" }, e)).toBe(0.25);
    expect(resolveNum({ bind: "a", div: 25 }, e)).toBe(2);
    expect(resolveNum({ bind: "a", div: "b", mul: -1, add: 1 }, e)).toBe(0.75);
    expect(resolveNum({ bind: "b", clamp: [0, 100] }, e)).toBe(100);
    expect(resolveNum({ bind: "s" }, e)).toBe(12.5);
  });

  test("missing, non-numeric and division by zero are undefined", () => {
    expect(resolveNum({ bind: "nope" }, e)).toBeUndefined();
    expect(resolveNum({ bind: "a", div: "z" }, e)).toBeUndefined();
    expect(resolveNum({ bind: "a", div: 0 }, e)).toBeUndefined();
    expect(resolveNum(Infinity, e)).toBeUndefined();
    expect(resolveNum(7, e)).toBe(7);
  });

  test("conditions", () => {
    expect(evalCondition({ bind: "a", exists: true }, e)).toBe(true);
    expect(evalCondition({ bind: "nope", exists: false }, e)).toBe(true);
    expect(evalCondition({ bind: "a", gt: 10, lte: 50 }, e)).toBe(true);
    expect(evalCondition({ bind: "a", in: [1, 50] }, e)).toBe(true);
    expect(evalCondition({ all: [{ bind: "a", eq: 50 }, { not: { bind: "b", lt: 10 } }] }, e)).toBe(true);
    expect(evalCondition({ any: [{ bind: "a", eq: 1 }, { bind: "b", eq: 2 }] }, e)).toBe(false);
    expect(evalCondition({ bind: "nope", gt: 1 }, e)).toBe(false);
  });
});

describe("lookupPath", () => {
  test("never traverses the prototype", () => {
    expect(lookupPath({}, "constructor")).toBeUndefined();
    expect(lookupPath({ a: {} }, "a.__proto__")).toBeUndefined();
    expect(lookupPath({ a: [1, 2] }, "a.length")).toBeUndefined();
    expect(lookupPath({ a: [1, 2] }, "a.1")).toBe(2);
    expect(lookupPath(null, "a")).toBeUndefined();
  });
});

describe("time filter and date binding", () => {
  test("{x|time} formats ms timestamps per locale", () => {
    const ms = new Date(2026, 9, 18, 22, 30).getTime();
    expect(resolveExpr("{t|time}", env({ t: ms }))).toBe("22.30");
    expect(resolveExpr("{t|time}", env({ t: ms }, "en"))).toBe("10:30 PM");
    expect(resolveExpr("{t|time}", env({ t: "2026-10-18" }))).toBeUndefined();
  });
});
