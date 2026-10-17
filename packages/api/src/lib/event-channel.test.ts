import { describe, expect, test } from "bun:test";

import { EventChannel } from "./event-channel";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of source) out.push(event);
  return out;
}

describe("EventChannel", () => {
  test("events pushed before iteration are queued, close ends the stream", async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.push(2);
    channel.close();
    expect(await collect(channel)).toEqual([1, 2]);
  });

  test("a waiting consumer wakes on push and on close", async () => {
    const channel = new EventChannel<string>();
    const seen = collect(channel);
    await Promise.resolve();
    channel.push("a");
    await Promise.resolve();
    channel.push("b");
    channel.close();
    expect(await seen).toEqual(["a", "b"]);
  });

  test("fail delivers the queued events first, then throws", async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.fail(new Error("boom"));
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const event of channel) seen.push(event);
      })(),
    ).rejects.toThrow("boom");
    expect(seen).toEqual([1]);
  });

  test("pushes after close are dropped", async () => {
    const channel = new EventChannel<number>();
    channel.close();
    channel.push(1);
    expect(await collect(channel)).toEqual([]);
  });
});
