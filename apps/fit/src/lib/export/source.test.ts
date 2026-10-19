import { describe, expect, test } from "bun:test";

import { gunzipLimited } from "@joyorogo/api/lib/watch-workout";

import { runDoc } from "./fixtures";
import { SourceError, fetchWorkoutDoc } from "./source";

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const respond = (build: () => Response | Promise<Response>) =>
  (async (_url: string | URL | Request, _init?: RequestInit) => build()) as unknown as typeof fetch;

const kind = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof SourceError ? error.kind : `other:${String(error)}`;
  }
  return "no error";
};

describe("fetchWorkoutDoc", () => {
  test("gets the blob with the session cookie and returns the validated document", async () => {
    const doc = runDoc();
    const body = await gzip(JSON.stringify(doc));
    const seen: { url?: string; credentials?: RequestCredentials } = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.url = String(url);
      seen.credentials = init?.credentials;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchWorkoutDoc(1_789_341_123, { baseUrl: "https://api.example", fetchImpl });
    expect(seen).toEqual({
      url: "https://api.example/api/watch-workouts/1789341123/blob",
      credentials: "include",
    });
    expect(out.workout).toEqual(doc.workout);
    expect(out.points?.n).toBe(600);
  });

  test("the answers of the API become typed errors", async () => {
    const options = (status: number) => ({
      baseUrl: "https://api.example",
      fetchImpl: respond(() => new Response("{}", { status })),
    });
    expect(await kind(fetchWorkoutDoc(1, options(401)))).toBe("unauthorized");
    expect(await kind(fetchWorkoutDoc(1, options(404)))).toBe("not_found");
    expect(await kind(fetchWorkoutDoc(1, options(503)))).toBe("unavailable");
  });

  test("a failed request is a network error, a cancel stays a cancel", async () => {
    const down = respond(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await kind(fetchWorkoutDoc(1, { baseUrl: "https://api.example", fetchImpl: down })),
    ).toBe("network");
    const aborted = respond(() => {
      throw new DOMException("aborted", "AbortError");
    });
    expect(
      await kind(fetchWorkoutDoc(1, { baseUrl: "https://api.example", fetchImpl: aborted })),
    ).toContain("AbortError");
  });

  test("a body that is not a valid document is bad_document", async () => {
    const notGzip = respond(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    expect(
      await kind(fetchWorkoutDoc(1, { baseUrl: "https://api.example", fetchImpl: notGzip })),
    ).toBe("bad_document");
    const notDoc = await gzip(JSON.stringify({ v: 1 }));
    const wrong = respond(() => new Response(notDoc, { status: 200 }));
    expect(
      await kind(fetchWorkoutDoc(1, { baseUrl: "https://api.example", fetchImpl: wrong })),
    ).toBe("bad_document");
    // The gunzip ceiling is the server's: this only checks the helper is the one in use.
    expect((await gunzipLimited(await gzip("ok"), 10)).length).toBe(2);
  });
});
