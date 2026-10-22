import { describe, expect, test } from "bun:test";

import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  test("calls made while one runs share it, the first call's arguments win", async () => {
    let runs = 0;
    const gate = Promise.withResolvers<void>();
    const fetchOnce = singleFlight(async (label: string) => {
      runs++;
      await gate.promise;
      return `${label}#${runs}`;
    });
    const first = fetchOnce("a");
    const second = fetchOnce("b");
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual(["a#1", "a#1"]);
    expect(runs).toBe(1);
  });

  test("the next call after it settled runs again", async () => {
    let runs = 0;
    const fetchOnce = singleFlight(async () => ++runs);
    expect(await fetchOnce()).toBe(1);
    expect(await fetchOnce()).toBe(2);
  });

  test("a failure reaches every waiter and does not stick", async () => {
    let runs = 0;
    const gate = Promise.withResolvers<void>();
    const fetchOnce = singleFlight(async () => {
      runs++;
      await gate.promise;
      if (runs === 1) throw new Error("offline");
      return "ok";
    });
    const first = fetchOnce();
    const second = fetchOnce();
    gate.resolve();
    expect((await first.catch((e: Error) => e.message)) as string).toBe("offline");
    expect((await second.catch((e: Error) => e.message)) as string).toBe("offline");
    expect(await fetchOnce()).toBe("ok");
    expect(runs).toBe(2);
  });
});
