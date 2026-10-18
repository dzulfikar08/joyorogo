import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";

import { APP_QUERY_DEFAULTS, bindAppStateFocus } from "./query-focus";
import type { AppStateSource } from "./query-focus";

// Real QueryClient and focusManager with a fake AppState: what a phone does when the person goes to JoyoFit (which
// pushes the day's workouts to the diary) and comes back to a JoyoRogo screen that was left open.

const listeners = new Set<(state: string) => void>();
const appState: AppStateSource = {
  addEventListener: (_type, listener) => {
    listeners.add(listener);
    return { remove: () => void listeners.delete(listener) };
  },
};
const emit = (state: string) => listeners.forEach((listener) => listener(state));

const START = Date.UTC(2026, 9, 18, 14, 21, 0);
const minutes = (n: number) => new Date(START + n * 60_000);

const KEY = ["exercise", "listByDate", "2026-10-18"];
let client: QueryClient;
let fetches = 0;
let unsubscribe: () => void;
let cacheHeard = Promise.withResolvers<void>();

/** The screen's query once its running fetch has settled. */
const fetched = () => client.getQueryCache().find({ queryKey: KEY })?.promise;

/** Back in the foreground; resolves once the query cache has been told, which is when stale queries start refetching. */
async function comeBack() {
  cacheHeard = Promise.withResolvers<void>();
  emit("active");
  await cacheHeard.promise;
}

beforeAll(async () => {
  setSystemTime(new Date(START));
  bindAppStateFocus(focusManager, appState);
  client = new QueryClient({ defaultOptions: { queries: APP_QUERY_DEFAULTS } });
  const cache = client.getQueryCache();
  const onFocus = cache.onFocus.bind(cache);
  cache.onFocus = () => {
    onFocus();
    cacheHeard.resolve();
  };
  client.mount();
  const observer = new QueryObserver(client, { queryKey: KEY, queryFn: async () => ++fetches });
  unsubscribe = observer.subscribe(() => {});
  await fetched();
});

afterAll(() => {
  unsubscribe();
  client.unmount();
  setSystemTime();
});

describe("returning to the app", () => {
  test("the mounted query was fetched once", () => {
    expect(fetches).toBe(1);
  });

  test("coming back within the stale time costs nothing", async () => {
    emit("background");
    setSystemTime(minutes(1));
    await comeBack();
    expect(fetches).toBe(1);
  });

  test("coming back after the stale time refetches the mounted query", async () => {
    emit("inactive");
    emit("background");
    setSystemTime(minutes(10));
    await comeBack();
    await fetched();
    expect(fetches).toBe(2);
    expect(client.getQueryData(KEY)).toBe(2);
  });
});

describe("the binding", () => {
  test("swapping the binding removes the previous app-state listener", () => {
    expect(listeners.size).toBe(1);
    let removed = 0;
    bindAppStateFocus(focusManager, { addEventListener: () => ({ remove: () => void removed++ }) });
    // the first binding's listener is gone, so a state change reaches nobody until the app binds again
    expect(listeners.size).toBe(0);
    bindAppStateFocus(focusManager, appState);
    expect(removed).toBe(1);
    expect(listeners.size).toBe(1);
  });

  test("the app refetches stale queries when it comes back", () => {
    expect(APP_QUERY_DEFAULTS.refetchOnWindowFocus).toBe(true);
    expect(APP_QUERY_DEFAULTS.staleTime).toBe(120_000);
  });
});
