import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * There is no React renderer in this test setup, so the "Dashboard renders loading, then loaded" path
 * (hook count must not change between the two) is guarded statically: oxlint's rules-of-hooks reports any
 * hook called after an early return or inside a condition. This caught the Beranda crash where the share
 * sheet hooks sat below the loading/anon/pending returns.
 */
const root = join(import.meta.dir, "../../../..");
const oxlint = join(root, "node_modules/.bin/oxlint");
const run = existsSync(oxlint) ? describe : describe.skip;

run("rules of hooks", () => {
  test("screens and components call hooks unconditionally", () => {
    const result = Bun.spawnSync(
      [oxlint, "--react-plugin", "-D", "react/rules-of-hooks", "--format", "unix", "apps/native/app", "apps/native/components", "apps/native/src"],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const output = result.stdout.toString() + result.stderr.toString();
    const violations = output.split("\n").filter((line) => line.includes("rules-of-hooks"));
    expect(violations).toEqual([]);
  });
});
