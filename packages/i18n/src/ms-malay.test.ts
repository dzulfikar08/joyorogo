import { describe, expect, test } from "bun:test";

import { resources } from "./resources";

// Bahasa Melayu is not Indonesian with a few words swapped. Words below exist only in Indonesian (or mean
// something else in Malay: Malay "bisa" is venom) and must never reach a Malaysian screen. The list holds
// whole words, lowercase; it is a tripwire for the machine draft, not a spell checker.
const INDONESIAN_ONLY = [
  "kamu", "kalian", "aku", "gue", "nggak", "gak", "enggak", "banget", "udah", "gimana", "bisa", "mau",
  "kemarin", "besok", "olahraga", "kkal", "pengaturan", "hapus", "unduh", "unggah", "pindai", "perangkat",
  "kata sandi", "surel", "ponsel", "berkas", "tautan", "pengingat", "jadwal", "tantangan",
  "teman", "karena", "saja", "setelah", "tips", "kapan", "nomor", "kantor",
  "mobil", "sehat", "kesehatan", "dokter", "gratis", "layanan", "pembaruan", "perbarui", 
  "makan siang", "camilan", "cemilan", "warteg", "lingkar pinggang", "harus", "kirim", "gabung", "bergabung",
  "bagikan", "membagikan", "berbagi", "koreksi", "estimasi", "akurat", "grup", "target", "foto",
];
// "foto" and "target" are shared with Malay usage in places ("foto" is common in Malaysia); they are
// allowed by the exceptions below so only real slips fail.
const ALLOWED = new Set(["foto", "target", "tips", "grup"]);

function strings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) strings(value, `${path}.${key}`, out);
  }
}

describe("ms reads as Malay, not Indonesian", () => {
  const all: Array<[string, string]> = [];
  for (const [ns, tree] of Object.entries(resources.ms)) strings(tree, ns, all);

  test("has text to check", () => {
    expect(all.length).toBeGreaterThan(2000);
  });

  test("no Indonesian-only word in any string", () => {
    const hits: string[] = [];
    for (const [path, value] of all) {
      // Placeholders, tags and the "Rp" payment rails text are not prose.
      const text = value.toLowerCase().replace(/\{\{[^}]*\}\}|<[^>]*>/g, " ");
      for (const word of INDONESIAN_ONLY) {
        if (ALLOWED.has(word)) continue;
        if (new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "u").test(text)) hits.push(`${path}: "${word}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("no em or en dashes in UI text", () => {
    const hits = all.filter(([, value]) => /[\u2013\u2014]/.test(value)).map(([path]) => path);
    expect(hits).toEqual([]);
  });

  test("kcal is the energy unit, never kkal", () => {
    expect(all.filter(([, value]) => /\bkkal\b/i.test(value)).map(([path]) => path)).toEqual([]);
  });
});
