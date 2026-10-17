// `bun run i18n:check` — translation completeness + leftover Indonesian UI literals.
//
//   bun run i18n:check            summary: missing keys, remaining files/literals per app
//   bun run i18n:check --list     also print every literal (file:line  text)
//   bun run i18n:check --json     machine-readable summary (for slicing the migration)
//
// Exit code 1 when a language lacks keys of the source language (or has orphans).
// The literal scan is a regex heuristic over an Indonesian word list: it informs
// the migration, it never fails the run. See docs/i18n.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { LOCALES } from "../packages/i18n/src/locale";
import { missingKeys, orphanKeys } from "../packages/i18n/src/keys";

const root = join(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));

// ── 1. keys ────────────────────────────────────────────────────────────────

let keysFailed = false;
const keyReport: Record<string, { missing: string[]; orphan: string[] }> = {};
for (const locale of LOCALES) {
  if (locale === "id") continue;
  const missing = missingKeys(locale);
  const orphan = orphanKeys(locale);
  keyReport[locale] = { missing, orphan };
  if (missing.length > 0 || orphan.length > 0) keysFailed = true;
}

// ── 2. Indonesian UI literals ───────────────────────────────────────────────

const APPS: Record<string, string[]> = {
  "apps/web": ["apps/web/src"],
  "apps/native": [
    "apps/native/app",
    "apps/native/components",
    "apps/native/src",
    "apps/native/utils",
    "apps/native/lib",
  ],
};
const SKIP_DIR = new Set(["node_modules", "dist", ".expo", "android", "ios", "assets"]);
const SKIP_FILE = /(\.test\.[tj]sx?|\.gen\.ts|\.d\.ts)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.has(name)) yield* walk(path);
    } else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) {
      yield path;
    }
  }
}

// Words that are Indonesian and not English, product names or code. Lower-case,
// whole-word. Extend it when the scan misses a screen.
const WORDS = new Set(
  `yang dan untuk dengan tidak belum sudah atau dari pada akan bisa juga masih lagi coba ini itu
   hari kemarin besok minggu bulan tahun jam menit detik pagi siang sore malam semalam
   makan makanan minum minuman camilan sarapan sahur berbuka porsi piring gelas kalori
   catat catatan simpan batal hapus ubah tambah tambahkan tutup kembali lanjut selesai kirim bagikan
   pilih cari lihat buka muat memuat gagal berhasil terjadi kesalahan salah benar
   kamu kami anda saya mu kita mereka aku
   berat badan tinggi umur usia tujuan kenaikan penurunan turun naik stabil
   olahraga latihan gerakan langkah tidur istirahat
   foto ambil kamera galeri pindai hitung ulang hasil akurat
   pengguna profil akun masuk keluar daftar sandi surel nama
   grup teman colek kotak pesan notifikasi pengingat
   harga paket langganan bayar pembayaran gratis berakhir perpanjang aktifkan
   pengaturan bahasa tema gelap terang sistem privasi
   belanja anggaran biaya lainnya beranda rekap mingguan ringkasan
   selamat datang halo terima kasih maaf tolong silakan ya yuk dong nih deh
   sisa lebih kurang cukup habis tercapai batas kuota
   jangan harus perlu mau ingin sedang sambil setelah sebelum selama saat ketika
   semua setiap beberapa banyak sedikit satu dua tiga empat lima
   dulu dulunya tanpa antara sampai hingga bagi oleh karena sehingga agar supaya
   cerita ceritakan suara rekam mikrofon teks tulis
   tanggal waktu jadwal jendela puasa ramadan
   sehat gizi protein karbohidrat lemak serat gula garam`
    .split(/\s+/)
    .filter(Boolean),
);

const WORD_RE = /[A-Za-zÀ-ÿ]+/g;
/** At least one Indonesian word, or a hard Indonesian marker such as "-nya" / "me-" verbs. */
function isIndonesian(text: string): boolean {
  const cleaned = text.replace(/\{\{[^}]*\}\}|\$\{[^}]*\}/g, " ");
  for (const word of cleaned.toLowerCase().match(WORD_RE) ?? []) {
    if (WORDS.has(word)) return true;
  }
  return false;
}

// Props and object keys whose string value is shown to the user.
const PROPS =
  "title|label|placeholder|description|subtitle|caption|message|alt|hint|heading|text|helper|helperText|emptyTitle|emptyText|cta|confirmLabel|cancelLabel|actionLabel|aria-label|aria-description|accessibilityLabel|accessibilityHint|tabBarLabel|headerTitle|header|name";
const PROP_RE = new RegExp(
  `(?:^|[\\s{(,])(?:${PROPS})\\s*[=:]\\s*\\{?\\s*(?:"((?:[^"\\\\\\n]|\\\\.)*)"|'((?:[^'\\\\\\n]|\\\\.)*)'|\`((?:[^\`\\\\]|\\\\.)*)\`)`,
  "g",
);
// toast.error("..."), toast.success(...), Alert.alert("...", "..."), confirm("...").
const CALL_RE =
  /\b(?:toast(?:\.\w+)?|Alert\.alert|alert|confirm)\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
// JSX text: between a tag's `>` and the next `<` or `{`; statements are excluded.
const JSX_TEXT_RE = />([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)(?=<|\{)/g;

type Literal = { line: number; text: string };

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function scan(source: string, isTsx: boolean): Literal[] {
  const found = new Map<number, Literal>();
  const add = (index: number, text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 3 || !isIndonesian(clean)) return;
    const line = lineOf(source, index);
    if (!found.has(line * 10_000 + (index % 10_000)))
      found.set(line * 10_000 + (index % 10_000), { line, text: clean });
  };
  for (const re of [PROP_RE, CALL_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      add(m.index, m[1] ?? m[2] ?? m[3] ?? "");
    }
  }
  if (isTsx) {
    JSX_TEXT_RE.lastIndex = 0;
    for (let m = JSX_TEXT_RE.exec(source); m; m = JSX_TEXT_RE.exec(source)) {
      const text = m[1] ?? "";
      // Statements between a generic's `>` and the next tag are not UI text.
      if (/[;=]|&&|\|\||=>|\?\.|[({]\s*$|\)\s*[,;:?]/.test(text)) continue;
      add(m.index, text);
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

const HAND_FORMAT_RE = /toLocale\w*String\(\s*["']id(?:-ID)?["']|Intl\.\w+\(\s*["']id(?:-ID)?["']/g;

type FileHit = { file: string; literals: Literal[]; handFormat: number };
const apps: Record<string, FileHit[]> = {};
for (const [app, dirs] of Object.entries(APPS)) {
  const hits: FileHit[] = [];
  for (const dir of dirs) {
    const abs = join(root, dir);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    for (const file of walk(abs)) {
      const source = readFileSync(file, "utf8");
      const literals = scan(source, file.endsWith(".tsx"));
      const handFormat = (source.match(HAND_FORMAT_RE) ?? []).length;
      if (literals.length > 0 || handFormat > 0) {
        hits.push({ file: relative(root, file), literals, handFormat });
      }
    }
  }
  hits.sort((a, b) => b.literals.length - a.literals.length || a.file.localeCompare(b.file));
  apps[app] = hits;
}

// ── report ──────────────────────────────────────────────────────────────────

const summary = Object.fromEntries(
  Object.entries(apps).map(([app, hits]) => [
    app,
    {
      files: hits.filter((h) => h.literals.length > 0).length,
      literals: hits.reduce((n, h) => n + h.literals.length, 0),
      handFormatFiles: hits.filter((h) => h.handFormat > 0).length,
    },
  ]),
);

if (args.has("--json")) {
  console.log(JSON.stringify({ keys: keyReport, summary, apps }, null, 2));
  process.exit(keysFailed ? 1 : 0);
}

console.log("Translation keys");
for (const [locale, { missing, orphan }] of Object.entries(keyReport)) {
  console.log(`  ${locale}: ${missing.length} missing, ${orphan.length} orphan`);
  for (const key of missing) console.log(`    missing  ${key}`);
  for (const key of orphan) console.log(`    orphan   ${key}`);
}

console.log("\nIndonesian UI literals still in the apps (heuristic)");
for (const [app, hits] of Object.entries(apps)) {
  const s = summary[app]!;
  console.log(`\n  ${app}: ${s.files} files, ${s.literals} literals`);
  for (const hit of hits) {
    if (hit.literals.length === 0) continue;
    console.log(`    ${String(hit.literals.length).padStart(4)}  ${hit.file}`);
    if (args.has("--list")) {
      for (const literal of hit.literals) {
        console.log(`          ${hit.file}:${literal.line}  ${literal.text.slice(0, 90)}`);
      }
    }
  }
}

// Rollup by directory (two levels under the app source root) to slice the migration.
console.log("\nBy area (files / literals)");
for (const [app, hits] of Object.entries(apps)) {
  const areas = new Map<string, { files: number; literals: number }>();
  for (const hit of hits) {
    if (hit.literals.length === 0) continue;
    const parts = hit.file.split("/");
    const inner = parts.slice(app === "apps/web" ? 3 : 2); // after apps/web/src | apps/native
    const area = inner.length > 2 ? inner.slice(0, 2).join("/") : (inner[0] ?? "");
    const entry = areas.get(area) ?? { files: 0, literals: 0 };
    entry.files += 1;
    entry.literals += hit.literals.length;
    areas.set(area, entry);
  }
  console.log(`  ${app}`);
  for (const [area, n] of [...areas].sort((a, b) => b[1].literals - a[1].literals)) {
    console.log(
      `    ${String(n.literals).padStart(5)}  ${String(n.files).padStart(3)} files  ${area}`,
    );
  }
}

console.log("\nHand-rolled id-ID number/date formatting (replace with @joyorogo/i18n helpers)");
for (const [app, hits] of Object.entries(apps)) {
  const files = hits.filter((h) => h.handFormat > 0);
  console.log(`  ${app}: ${files.length} files`);
  for (const hit of files) console.log(`    ${String(hit.handFormat).padStart(4)}  ${hit.file}`);
}

console.log("\nTotals");
for (const [app, s] of Object.entries(summary)) {
  console.log(`  ${app}: ${s.files} files with literals, ${s.literals} literals`);
}
process.exit(keysFailed ? 1 : 0);
