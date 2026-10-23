import { createORPCClient, ORPCError } from "@orpc/client";
import type { RouterClient } from "@orpc/server";
import { RPCLink } from "@orpc/client/fetch";
import { call } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import type { ScanStreamEvent } from "../lib/scan-live";
import { aiRouter } from "./ai";
import type { AnalyzeFoodResult } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id'), ('u2', 'u2', 'u2@test.id'), ('u3', 'u3', 'u3@test.id');
`);

const ANSWER = JSON.stringify({
  items: [
    { name: "nasi goreng", kind: "makanan", kcal: 350, grams: 200, box: [100, 100, 600, 600] },
    { name: "bakso", kcal: 380, grams: 350 },
    { name: "kuah kaldu", kcal: 50, grams: 150 },
  ],
});

/** Workers AI fake: a plain chat completion, or a chat stream when asked to stream. */
function fakeAi(text: string) {
  return {
    run: (_model: string, body: unknown) => {
      const wantsStream = (body as { stream?: boolean }).stream === true;
      if (!wantsStream) {
        return Promise.resolve({
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 300, completion_tokens: 9 },
        });
      }
      const encoder = new TextEncoder();
      const frames: string[] = [];
      for (let i = 0; i < text.length; i += 8) {
        const delta = { content: text.slice(i, i + 8) };
        frames.push(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
      }
      frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      frames.push(
        `data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 300, completion_tokens: 9 } })}\n\n`,
        "data: [DONE]\n\n",
      );
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
          },
        }),
      );
    },
  };
}

const background: Promise<unknown>[] = [];
const ctx = (userId: string, text = ANSWER) =>
  ({
    db,
    env: { AI: fakeAi(text) },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;

const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of source) out.push(event);
  return out;
}

describe("ai.analyzeFoodStream", () => {
  test("streams names then items, and done equals what analyzeFood returns", async () => {
    const streamed = await collect(
      await call(aiRouter.analyzeFoodStream, INPUT, { context: ctx("u1") }),
    );
    const plain = await call(aiRouter.analyzeFood, INPUT, { context: ctx("u2") });

    expect(streamed.map((event) => event.type)).toEqual([
      "name",
      "item",
      "name",
      "item",
      "name",
      "item",
      "done",
    ]);
    const done = streamed.at(-1);
    expect(done).toMatchObject({ type: "done" });
    expect(done?.type === "done" ? done.result : null).toEqual(plain);
    // the broth rule only exists in the final answer
    expect(plain.items.map((item) => item.name)).toEqual(["nasi goreng", "bakso"]);
    expect(streamed.filter((event) => event.type === "item")).toHaveLength(3);
  });

  test("the ledger row of a streamed scan carries the stage timings", async () => {
    await collect(await call(aiRouter.analyzeFoodStream, INPUT, { context: ctx("u3") }));
    await Promise.all(background);
    const rows = await client.execute(
      `select usage_json from ai_usage where user_id = 'u3' and scan_type = 'user'`,
    );
    const usage = JSON.parse(String(rows.rows[0]?.usage_json)) as {
      completion_tokens: number;
      serverTiming: Record<string, unknown>;
    };
    expect(usage.completion_tokens).toBe(9);
    expect(usage.serverTiming).toMatchObject({ streamed: true, attempts: 1 });
    for (const key of ["receiveMs", "quotaMs", "aiMs", "ttftMs", "firstNameMs", "firstItemMs", "totalMs"]) {
      expect(usage.serverTiming[key]).toBeNumber();
    }
  });

  test("a verdict from the model ends the stream with the same error analyzeFood throws", async () => {
    const notFood = JSON.stringify({ items: [], problem: "bukan_makanan" });
    const stream = await call(aiRouter.analyzeFoodStream, INPUT, { context: ctx("u1", notFood) });
    const error = await collect(stream).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ data: { reason: "not_food" } });
  });

  test("events and errors survive the real RPC transport", async () => {
    const handler = new RPCHandler({ ai: aiRouter });
    const link = (context: Context) =>
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request) => {
          const result = await handler.handle(request, { prefix: "/rpc", context });
          if (!result.matched) throw new Error("no route");
          return result.response;
        },
      });
    const rpc = (context: Context) =>
      createORPCClient<RouterClient<{ ai: typeof aiRouter }>>(link(context));

    const events: ScanStreamEvent<AnalyzeFoodResult>[] = await collect(
      await rpc(ctx("u1")).ai.analyzeFoodStream(INPUT),
    );
    expect(events.map((event) => event.type)).toEqual([
      "name",
      "item",
      "name",
      "item",
      "name",
      "item",
      "done",
    ]);
    expect(events[1]).toMatchObject({ type: "item", index: 0, item: { name: "nasi goreng" } });

    const notFood = JSON.stringify({ items: [], problem: "bukan_makanan" });
    const failure = await rpc(ctx("u1", notFood))
      .ai.analyzeFoodStream(INPUT)
      .then(collect)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(failure).toBeInstanceOf(ORPCError);
    expect(failure).toMatchObject({ code: "UNPROCESSABLE_CONTENT", data: { reason: "not_food" } });
  });
});
