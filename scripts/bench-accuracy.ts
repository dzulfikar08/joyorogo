// Blind accuracy benchmark runner. Hits POST /ai/bench on the deployed API
// with curated Wikimedia Commons photos of real Indonesian dishes.
// Usage: BENCH_URL=https://api.joyorogo.com AI_BENCH_KEY=... bun run scripts/bench-accuracy.ts
// Dry run: BENCH_DRY=1 bun run scripts/bench-accuracy.ts

type Case = {
  dish: string;
  url: string;
  expectKcalMin: number;
  expectKcalMax: number;
};

// Expectation bands are rumahan (home-style) portions for one serving;
// drinks/padded plates sit at the generous end on purpose.
const CASES: Case[] = [
  {
    dish: "nasi goreng",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/Nasi_goreng_indonesia.jpg/960px-Nasi_goreng_indonesia.jpg",
    expectKcalMin: 350,
    expectKcalMax: 700,
  },
  {
    dish: "sate ayam",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Sate_Ayam_Al-Huda_Jember.jpg/960px-Sate_Ayam_Al-Huda_Jember.jpg",
    expectKcalMin: 250,
    expectKcalMax: 600,
  },
  {
    dish: "bakso",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6e/Bakso_Indonesian_Meatball_Soup_from_Solo.jpg/960px-Bakso_Indonesian_Meatball_Soup_from_Solo.jpg",
    expectKcalMin: 250,
    expectKcalMax: 600,
  },
  {
    dish: "gado-gado",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Gado-gado_in_Jakarta.JPG/960px-Gado-gado_in_Jakarta.JPG",
    expectKcalMin: 250,
    expectKcalMax: 600,
  },
  {
    dish: "rendang",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/Beef_Rendang..JPG/960px-Beef_Rendang..JPG",
    expectKcalMin: 300,
    expectKcalMax: 700,
  },
  {
    dish: "mie ayam",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/82/Mi_ayam_jamur.JPG/960px-Mi_ayam_jamur.JPG",
    expectKcalMin: 350,
    expectKcalMax: 700,
  },
  {
    dish: "es teh",
    url: "https://upload.wikimedia.org/wikipedia/commons/f/f3/Glass_of_iced_tea_-_Evan_Swigart.jpg",
    expectKcalMin: 10,
    expectKcalMax: 120,
  },
  {
    dish: "pisang goreng",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0f/Pisang_Goreng.jpg/960px-Pisang_Goreng.jpg",
    expectKcalMin: 200,
    expectKcalMax: 500,
  },
];

const url = process.env.BENCH_URL ?? "https://api.joyorogo.com";
const key = process.env.AI_BENCH_KEY ?? "";

if (process.env.BENCH_DRY) {
  console.log(JSON.stringify({ endpoint: `${url}/ai/bench`, images: CASES }, null, 2));
  process.exit(0);
}

if (!key) {
  console.error("AI_BENCH_KEY is required (and must match the AI_BENCH_KEY secret).");
  process.exit(1);
}

const res = await fetch(`${url}/ai/bench`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Bench-Key": key },
  body: JSON.stringify({ images: CASES }),
});

if (!res.ok) {
  console.error(`bench failed: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
for (const r of data.results) {
  const flag = r.ok ? (r.inRange ? "HIT " : "MISS") : "ERR ";
  console.log(
    `${flag} ${r.dish.padEnd(14)} kcal=${r.totalKcal ?? "-"} ${r.latencyMs}ms${r.error ? ` ${r.error}` : ""}`,
  );
}
console.log(
  `hit rate ${(data.summary.hitRate * 100).toFixed(0)}% (${data.summary.hits}/${data.summary.n}), median latency ${data.summary.medianLatencyMs}ms`,
);
