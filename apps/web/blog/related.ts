// Related-post scoring and categories. Nothing here lists slugs by hand: a post
// (article or tip) is tagged with topics found in its slug, title, and
// description, and related posts are the ones sharing the most topics. A new
// post therefore links to, and is linked from, its neighbours at the next build.
// Frontmatter `related: slug-a, slug-b` pins specific posts first.

export const CATEGORIES = ["Makanan", "Ramadan", "Tips"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_BLURB: Record<Category, string> = {
  Makanan: "Kalori lauk, jajanan, dan menu sehari-hari menurut TKPI 2019.",
  Ramadan: "Sahur, takjil, berbuka, dan Lebaran tanpa kehilangan hitungan kalori.",
  Tips: "Cara menghitung dan menjalani diet, dengan studi yang bisa kamu cek sendiri.",
};

export const categoryAnchor = (c: Category): string => c.toLowerCase();

const RAMADAN_RE = /ramadan|puasa|sahur|takjil|berbuka|buka-puasa|lebaran|ketupat|opor|kurma|kolak/;

/** Topic → words that signal it. Matched against slug + title + description. */
const TOPICS: Record<string, RegExp> = {
  ramadan: RAMADAN_RE,
  gorengan: /gorengan|\bgoreng\b|minyak|\bsaus\b|\btempe\b|\btahu\b/,
  minuman: /minuman|\bcair\b|\bes[- ]teh\b|\bkopi\b|\bteh\b|sirup|soda|karbonasi|^air-|segelas|\bsusu\b/,
  protein: /protein|\botot\b|angkat-beban|angkat beban/,
  lauk: /\b(?:telur|ayam|daging|ikan|sate|rendang|bakso)\b/,
  karbo: /\b(?:nasi|mie|bubur|lontong|ketupat|roti|kentang|singkong)\b|karbohidrat/,
  defisit: /defisit|target|timbangan|berat badan|jeda|fleksibel|tdee|bmr/,
  kenyang: /kenyang|serat|sup|porsi banyak|makan-pelan|makan pelan|lapar|volume/,
  gaya: /tidur|langkah|neat|olahraga|stres|aktivitas/,
  tkpi: /tkpi|daftar kalori|kalori makanan indonesia/,
  padang: /padang|rendang|sambal|gulai|warteg/,
};

export function topicsOf(text: string): Set<string> {
  const lower = text.toLowerCase();
  return new Set(
    Object.entries(TOPICS)
      .filter(([, re]) => re.test(lower))
      .map(([topic]) => topic),
  );
}

export function categoryOf(slug: string, text: string, explicit: string | undefined): Category {
  const hit = CATEGORIES.find((c) => c.toLowerCase() === explicit?.toLowerCase());
  if (hit) return hit;
  if (explicit) throw new Error(`${slug}: category "${explicit}" tidak dikenal (${CATEGORIES.join(", ")})`);
  if (RAMADAN_RE.test(`${slug} ${text}`.toLowerCase())) return "Ramadan";
  return slug.startsWith("kalori-") ? "Makanan" : "Tips";
}

export type Linkable = {
  slug: string;
  kind: "article" | "tip";
  category: Category;
  topics: Set<string>;
  date: string;
  pinned: string[];
};

function score(a: Linkable, b: Linkable, weight: Map<string, number>): number {
  let s = 0;
  for (const t of a.topics) if (b.topics.has(t)) s += weight.get(t) ?? 0;
  if (a.category === b.category) s += 0.5;
  return s;
}

/** Rarer topics say more about closeness: weight = ln(posts / posts with the topic). */
function topicWeights(all: Linkable[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const p of all) for (const t of p.topics) df.set(t, (df.get(t) ?? 0) + 1);
  return new Map([...df].map(([t, n]) => [t, Math.log(all.length / n)]));
}

/**
 * Up to `limit` related slugs: pinned first, then the best-scoring article and
 * the best-scoring tip (so every tip links to an article and the reverse),
 * then the best of the rest. Ties break on newest date, then slug.
 */
export function relatedSlugs(post: Linkable, all: Linkable[], limit = 5): string[] {
  const weight = topicWeights(all);
  const ranked = all
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, s: score(post, p, weight) }))
    .sort((x, y) => y.s - x.s || y.p.date.localeCompare(x.p.date) || x.p.slug.localeCompare(y.p.slug))
    .map((x) => x.p);
  const out: string[] = post.pinned.filter((s) => ranked.some((p) => p.slug === s));
  const take = (p: Linkable | undefined) => {
    if (p && !out.includes(p.slug)) out.push(p.slug);
  };
  take(ranked.find((p) => p.kind === "article"));
  take(ranked.find((p) => p.kind === "tip"));
  for (const p of ranked) take(p);
  return out.slice(0, limit);
}
