import { describe, expect, test } from "bun:test";

import { createFileKeyValue, fileNameOf, type FileIo } from "./file-kv";

function memoryIo(delayMs = 0): FileIo & { files: Map<string, string>; calls: string[] } {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const wait = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  return {
    files,
    calls,
    async read(name) {
      await wait();
      return files.get(name) ?? null;
    },
    async write(name, text) {
      await wait();
      calls.push(`write ${name}`);
      files.set(name, text);
    },
    async remove(name) {
      await wait();
      calls.push(`remove ${name}`);
      files.delete(name);
    },
    async clear() {
      await wait();
      calls.push("clear");
      files.clear();
    },
  };
}

describe("file key-value store", () => {
  test("file names are safe for any key and never collide", () => {
    expect(fileNameOf("joyo.ai.chat.c1")).toBe("joyo%2Eai%2Echat%2Ec1.json");
    expect(fileNameOf("a/b")).not.toBe(fileNameOf("a_b"));
    expect(fileNameOf("../x")).not.toContain("/");
  });

  test("a write is readable at once and lands in the file", async () => {
    const io = memoryIo(5);
    const kv = createFileKeyValue(io);
    const done = kv.set("k", "v1");
    expect(await kv.get("k")).toBe("v1");
    await done;
    expect(io.files.get(fileNameOf("k"))).toBe("v1");
  });

  test("reads from disk once, then from the cache", async () => {
    const io = memoryIo();
    io.files.set(fileNameOf("k"), "stored");
    const kv = createFileKeyValue(io);
    expect(await kv.get("k")).toBe("stored");
    io.files.set(fileNameOf("k"), "changed behind its back");
    expect(await kv.get("k")).toBe("stored");
    expect(await kv.get("missing")).toBeNull();
  });

  test("set then remove in a row ends with nothing on disk", async () => {
    const io = memoryIo(5);
    const kv = createFileKeyValue(io);
    void kv.set("k", "v");
    await kv.remove("k");
    expect(io.files.size).toBe(0);
    expect(io.calls).toEqual([`write ${fileNameOf("k")}`, `remove ${fileNameOf("k")}`]);
    expect(await kv.get("k")).toBeNull();
  });

  test("clear drops the cache and every file", async () => {
    const io = memoryIo();
    const kv = createFileKeyValue(io);
    await kv.set("a", "1");
    await kv.set("b", "2");
    await kv.clear();
    expect(io.files.size).toBe(0);
    expect(await kv.get("a")).toBeNull();
  });

  test("a failing write rejects for the caller but later writes still run", async () => {
    const io = memoryIo();
    let fail = true;
    const write = io.write.bind(io);
    io.write = async (name, text) => {
      if (fail) throw new Error("disk full");
      await write(name, text);
    };
    const kv = createFileKeyValue(io);
    await expect(kv.set("a", "1")).rejects.toThrow("disk full");
    fail = false;
    await kv.set("b", "2");
    expect(io.files.get(fileNameOf("b"))).toBe("2");
  });
});
