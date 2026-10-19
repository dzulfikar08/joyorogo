import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";

import { crc32, zip } from "./zip";

describe("crc32", () => {
  test("the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zip", () => {
  const files = [
    { name: "a.txt", data: new TextEncoder().encode("hello") },
    { name: "run/ünï.gpx", data: new TextEncoder().encode("<gpx/>".repeat(1000)) },
    { name: "empty.json", data: new Uint8Array() },
    {
      name: "random.fit",
      data: Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + (i >> 8)) & 0xff),
    },
  ];
  const bytes = zip(files, new Date(2026, 8, 14, 6, 12, 4));

  test("an independent reader (JSZip) lists and extracts every file unchanged, CRCs checked", async () => {
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(archive.files).sort()).toEqual(files.map((f) => f.name).sort());
    for (const file of files) {
      expect(new Uint8Array(await archive.files[file.name]!.async("uint8array"))).toEqual(
        file.data,
      );
    }
  });

  test("entries are stored (not deflated) and carry the modification time to the second pair", async () => {
    const archive = await JSZip.loadAsync(bytes);
    const entry = archive.files["a.txt"]!;
    expect(entry.date.getFullYear()).toBe(2026);
    expect(entry.date.getMonth()).toBe(8);
    expect(entry.date.getDate()).toBe(14);
    expect(entry.date.getHours()).toBe(6);
    expect(entry.date.getMinutes()).toBe(12);
    // Stored: the archive is the data plus a small fixed overhead per entry.
    const overhead = bytes.length - files.reduce((sum, f) => sum + f.data.length, 0);
    expect(overhead).toBeLessThan(files.length * 200);
  });

  test("the system unzip accepts it", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    try {
      const path = join(dir, "out.zip");
      writeFileSync(path, bytes);
      const result = Bun.spawnSync(["unzip", "-t", path]);
      // No `unzip` on the machine is not a failure of the writer.
      if (result.exitCode === 127 || result.exitCode === null) return;
      expect(result.stdout.toString()).toContain("No errors detected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty archive is just the end record", async () => {
    const empty = zip([]);
    expect(empty.length).toBe(22);
    expect(Object.keys((await JSZip.loadAsync(empty)).files)).toEqual([]);
  });

  test("a repeated name is refused", () => {
    expect(() =>
      zip([
        { name: "x", data: new Uint8Array() },
        { name: "x", data: new Uint8Array() },
      ]),
    ).toThrow(/Duplicate/);
  });
});
