import { describe, expect, test } from "bun:test";

import { type AskDeps, type AskPermission, type AskTrigger, runPushAsk, triggerForCall } from "./push-ask";

function fake(permission: AskPermission, granted = true) {
  const asked = new Set<AskTrigger>();
  const calls = { prompt: 0, granted: 0 };
  const deps: AskDeps = {
    permission: async () => permission,
    wasAsked: async (t) => asked.has(t),
    markAsked: async (t) => {
      asked.add(t);
    },
    prompt: async () => {
      calls.prompt++;
      return granted;
    },
    onGranted: async () => {
      calls.granted++;
    },
  };
  return { deps, calls, asked };
}

describe("triggerForCall", () => {
  test("every meal-log path is a meal trigger", () => {
    for (const p of [["food", "add"], ["food", "addScan"], ["savedFood", "relog"], ["place", "relog"], ["mealPlan", "eat"]]) {
      expect(triggerForCall(p, {}, {})).toBe("meal");
    }
  });

  test("social actions; kudos and follow only on the 'on' side", () => {
    expect(triggerForCall(["social", "createPost"], {}, {})).toBe("social");
    expect(triggerForCall(["social", "addComment"], {}, {})).toBe("social");
    expect(triggerForCall(["group", "join"], {}, {})).toBe("social");
    expect(triggerForCall(["group", "nudge"], {}, {})).toBe("social");
    expect(triggerForCall(["social", "kudos"], {}, { kudos: true })).toBe("social");
    expect(triggerForCall(["social", "kudos"], {}, { kudos: false })).toBeNull();
    expect(triggerForCall(["social", "setFollow"], { follow: true }, {})).toBe("social");
    expect(triggerForCall(["social", "setFollow"], { follow: false }, {})).toBeNull();
  });

  test("reads and removals do nothing", () => {
    expect(triggerForCall(["food", "remove"], {}, {})).toBeNull();
    expect(triggerForCall(["social", "feed"], {}, {})).toBeNull();
  });
});

describe("runPushAsk", () => {
  test("already granted: never prompts and never burns the flag", async () => {
    const { deps, calls, asked } = fake("granted");
    expect(await runPushAsk("meal", deps)).toBe(false);
    expect(calls.prompt).toBe(0);
    expect(asked.size).toBe(0);
  });

  test("once per trigger, independent between triggers", async () => {
    const { deps, calls } = fake("undetermined", false);
    expect(await runPushAsk("meal", deps)).toBe(true);
    expect(await runPushAsk("meal", deps)).toBe(false);
    expect(await runPushAsk("social", deps)).toBe(true);
    expect(await runPushAsk("social", deps)).toBe(false);
    expect(calls.prompt).toBe(2);
    expect(calls.granted).toBe(0);
  });

  test("a grant registers; blocked still shows its sheet once", async () => {
    const a = fake("undetermined", true);
    await runPushAsk("social", a.deps);
    expect(a.calls.granted).toBe(1);
    const b = fake("blocked", false);
    expect(await runPushAsk("meal", b.deps)).toBe(true);
    expect(await runPushAsk("meal", b.deps)).toBe(false);
  });
});
