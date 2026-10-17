// Does a smaller upload change what the vision model answers? Resizes the
// bench photos to several long-edge sizes (JPEG q75, like native; WebP q82,
// like web), runs each through the REAL analyzeFoodPhoto (same prompt, same
// TKPI calibration) on Workers AI over REST, and compares item names, total
// kcal and prompt tokens per size against the 1024 px baseline. Repeats per
// cell separate the size effect from run-to-run noise.
//
// Usage: bun run scripts/bench-image-size.ts
//   CLOUDFLARE_API_TOKEN (or the wrangler OAuth login) + CLOUDFLARE_ACCOUNT_ID
//   SIZES=1024,768,640,512  REPS=3  FORMAT=jpeg|webp  OUT=/tmp/size-bench.json
// Needs `vips` for resizing.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeFoodPhoto, DEFAULT_VISION_MODEL } from "../packages/api/src/lib/vision";

const CASES = [
  ["nasi goreng", "3/3e/Nasi_goreng_indonesia.jpg"],
  ["sate ayam", "2/25/Sate_Ayam_Al-Huda_Jember.jpg"],
  ["bakso", "6/6e/Bakso_Indonesian_Meatball_Soup_from_Solo.jpg"],
  ["gado-gado", "3/30/Gado-gado_in_Jakarta.JPG"],
  ["rendang", "5/50/Beef_Rendang..JPG"],
  ["mie ayam", "8/82/Mi_ayam_jamur.JPG"],
  ["es teh", "f/f3/Glass_of_iced_tea_-_Evan_Swigart.jpg"],
  ["pisang goreng", "0/0f/Pisang_Goreng.jpg"],
] as const;

const SIZES = (process.env.SIZES ?? "1024,768,640,512").split(",").map(Number);
const REPS = Number(process.env.REPS ?? 3);
const FORMAT = process.env.FORMAT === "webp" ? "webp" : "jpeg";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "3268f27664d77716b648b00c8850469e";
const CONCURRENCY = 4;

function apiToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const toml = readFileSync(join(homedir(), ".config/.wrangler/config/default.toml"), "utf8");
  const found = /oauth_token = "([^"]+)"/.exec(toml);
  if (!found) throw new Error("no CLOUDFLARE_API_TOKEN and no wrangler login");
  return found[1]!;
}

const token = apiToken();
const dir = join(tmpdir(), "joyorogo-size-bench");
mkdirSync(dir, { recursive: true });

async function original(path: string): Promise<string> {
  const file = join(dir, path.replaceAll("/", "_"));
  if (existsSync(file)) return file;
  const url = `https://upload.wikimedia.org/wikipedia/commons/${path}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JoyorogoBench/1.0; +https://joyorogo.com)" },
    });
    if (res.ok) {
      await Bun.write(file, await res.arrayBuffer());
      return file;
    }
    await Bun.sleep(2000 * (attempt + 1));
  }
  throw new Error(`download failed: ${url}`);
}

async function resized(file: string, edge: number): Promise<{ b64: string; bytes: number; mime: string }> {
  const out = `${file}.${edge}.${FORMAT === "webp" ? "webp" : "jpg"}`;
  const q = FORMAT === "webp" ? 82 : 75;
  const proc = Bun.spawn(
    ["vips", "thumbnail", file, `${out}[Q=${q}]`, String(edge), "--size", "down", "--height", String(edge)],
    { stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
  const buf = new Uint8Array(await Bun.file(out).arrayBuffer());
  return {
    b64: Buffer.from(buf).toString("base64"),
    bytes: buf.length,
    mime: FORMAT === "webp" ? "image/webp" : "image/jpeg",
  };
}

const ai = {
  async run(model: string, input: unknown) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const json = (await res.json()) as { result?: unknown; success?: boolean };
    if (!res.ok || !json.result) throw new Error(`ai ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json.result;
  },
};

type Row = {
  dish: string;
  edge: number;
  rep: number;
  bytes: number;
  names: string[];
  kcal: number;
  promptTokens: number | null;
  completionTokens: number | null;
  ms: number;
  error?: string;
};

const jobs: Array<() => Promise<Row>> = [];
for (const [dish, path] of CASES) {
  const file = await original(path);
  for (const edge of SIZES) {
    const img = await resized(file, edge);
    for (let rep = 0; rep < REPS; rep++) {
      jobs.push(async () => {
        const startedAt = Date.now();
        try {
          const result = await analyzeFoodPhoto(ai, {
            imageBase64: img.b64,
            mimeType: img.mime,
            model: DEFAULT_VISION_MODEL,
          });
          return {
            dish,
            edge,
            rep,
            bytes: img.bytes,
            names: result.items.map((item) => item.name),
            kcal: Math.round(result.items.reduce((sum, item) => sum + item.kcal, 0)),
            promptTokens: (result.usage?.prompt_tokens as number | undefined) ?? null,
            completionTokens: (result.usage?.completion_tokens as number | undefined) ?? null,
            ms: Date.now() - startedAt,
          };
        } catch (error) {
          return {
            dish, edge, rep, bytes: img.bytes, names: [], kcal: 0,
            promptTokens: null, completionTokens: null,
            ms: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    }
  }
}

const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      rows.push(await job());
    }
  }),
);
writeFileSync(process.env.OUT ?? join(dir, "results.json"), JSON.stringify(rows, null, 2));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const nameSet = (r: Row[]) => new Set(r.flatMap((x) => x.names.map(norm)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 1;
};

console.log(`format=${FORMAT} reps=${REPS} errors=${rows.filter((r) => r.error).length}/${rows.length}`);
const ok = rows.filter((r) => !r.error);
const cell = (dish: string, edge: number) => ok.filter((r) => r.dish === dish && r.edge === edge);
const baseEdge = SIZES[0]!;

console.log("\nedge  KB    prompt_tok  compl_tok  ms     meanKcal  vs-base(kcal)  name-jaccard-vs-base");
for (const edge of SIZES) {
  const at = ok.filter((r) => r.edge === edge);
  const deltas: number[] = [];
  const jac: number[] = [];
  for (const [dish] of CASES) {
    const base = cell(dish, baseEdge);
    const cur = cell(dish, edge);
    if (!base.length || !cur.length) continue;
    deltas.push(mean(cur.map((r) => r.kcal)) - mean(base.map((r) => r.kcal)));
    jac.push(jaccard(nameSet(base), nameSet(cur)));
  }
  console.log(
    `${String(edge).padEnd(5)} ${mean(at.map((r) => r.bytes / 1024)).toFixed(0).padEnd(5)} ${mean(
      at.flatMap((r) => (r.promptTokens === null ? [] : [r.promptTokens])),
    ).toFixed(0).padEnd(11)} ${mean(
      at.flatMap((r) => (r.completionTokens === null ? [] : [r.completionTokens])),
    ).toFixed(0).padEnd(10)} ${mean(at.map((r) => r.ms)).toFixed(0).padEnd(6)} ${mean(
      at.map((r) => r.kcal),
    ).toFixed(0).padEnd(9)} ${mean(deltas).toFixed(1).padEnd(14)} ${mean(jac).toFixed(2)}`,
  );
}

// Run-to-run noise at the baseline size: rep 0 vs rep 1 of the same image.
const noise = CASES.flatMap(([dish]) => {
  const reps = cell(dish, baseEdge);
  return reps.length >= 2 ? [reps[1]!.kcal - reps[0]!.kcal] : [];
});
console.log(
  `\nnoise @${baseEdge}: mean |rep1-rep0| kcal = ${mean(noise.map(Math.abs)).toFixed(1)}`,
);

console.log("\nper dish, mean kcal by edge (names of the first rep):");
for (const [dish] of CASES) {
  const line = SIZES.map((edge) => {
    const c = cell(dish, edge);
    return `${edge}:${c.length ? Math.round(mean(c.map((r) => r.kcal))) : "-"}`;
  }).join("  ");
  console.log(`${dish.padEnd(14)} ${line}`);
  for (const edge of SIZES) {
    const first = cell(dish, edge)[0];
    if (first) console.log(`    ${String(edge).padEnd(5)} ${first.names.join(" | ")}`);
  }
}
