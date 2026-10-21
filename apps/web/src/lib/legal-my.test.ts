import { describe, expect, test } from "bun:test";

import { COMPANY_ADDRESS, whatsappUrl } from "./contact";
import { inlineParts, LEGAL_DOCS, LEGAL_PATHS, LEGAL_PEERS } from "./legal-my";
import { legalPath } from "./legal-path";

// Same tripwire idea as packages/i18n/src/ms-malay.test.ts, for the prose in the Malay legal pages.
const INDONESIAN_ONLY = [
  "kamu", "kalian", "aku", "nggak", "banget", "udah", "gimana", "bisa", "mau", "olahraga", "pengaturan", "hapus",
  "unduh", "unggah", "pindai", "perangkat", "kata sandi", "ponsel", "berkas", "tautan", "pengingat", "jadwal",
  "tantangan", "teman", "karena", "saja", "setelah", "kapan", "nomor", "dokter", "gratis", "layanan",
  "kesehatan", "harus", "kirim", "bagikan", "membagikan", "koreksi", "akurat", "estimasi",
];

function allText(path: (typeof LEGAL_PATHS)[number]): string[] {
  const doc = LEGAL_DOCS[path];
  const out = [doc.title, doc.intro, doc.version];
  for (const section of doc.sections) {
    out.push(section.title);
    for (const block of section.blocks) {
      if (typeof block === "string") out.push(block);
      else if ("note" in block) out.push(block.note);
      else out.push(...block.list);
    }
  }
  return out;
}

describe("Malaysian legal pages", () => {
  test("Malay pages use no Indonesian-only word", () => {
    for (const path of ["/my/privasi", "/my/syarat"] as const) {
      const hits: string[] = [];
      for (const text of allText(path)) {
        // The USD section keeps Indonesian page names in link labels; check prose only.
        const prose = text.toLowerCase().replace(/\]\([^)]*\)/g, "]");
        for (const word of INDONESIAN_ONLY) {
          if (new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "u").test(prose)) hits.push(`${path}: ${word}`);
        }
      }
      expect(hits).toEqual([]);
    }
  });

  test("no em or en dashes, no halal wording, in any language", () => {
    for (const path of LEGAL_PATHS) {
      for (const text of allText(path)) {
        expect(text).not.toMatch(/[\u2013\u2014]/);
        expect(text.toLowerCase()).not.toContain("halal");
      }
    }
  });

  test("every PDPA block is in both notices", () => {
    for (const path of ["/my/privasi", "/my/privacy"] as const) {
      const text = allText(path).join("\n");
      for (const needle of ["PT Joyo Digitama Solusi", "aduan@pdp.gov.my", "03-7456 3888", "2026-10-21", "21", "18"]) {
        expect(text).toContain(needle);
      }
    }
    for (const path of LEGAL_PATHS) expect(allText(path).join("\n")).toContain("+62 896-8083-9591");
  });

  test("the address line appears only when an address is set", () => {
    const text = allText("/my/privacy").join("\n");
    expect(text.includes("Malang, Jawa Timur, Indonesia")).toBe(true);
    if (!COMPANY_ADDRESS) expect(text).not.toContain(", ,");
  });

  test("peers point at each other and section ids are unique per page", () => {
    for (const path of LEGAL_PATHS) {
      expect(LEGAL_PEERS[LEGAL_PEERS[path]]).toBe(path);
      const ids = LEGAL_DOCS[path].sections.flatMap((s) => (s.id ? [s.id] : []));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("inline links and bold parse", () => {
    expect(inlineParts("a [b](/c) **d** e")).toEqual([
      { text: "a " },
      { label: "b", href: "/c" },
      { text: " " },
      { bold: "d" },
      { text: " e" },
    ]);
  });
});

describe("whatsappUrl", () => {
  test("plain and prefilled", () => {
    expect(whatsappUrl()).toBe("https://wa.me/6289680839591");
    expect(whatsappUrl("Hai JoyoRogo, saya ada soalan tentang ")).toBe(
      "https://wa.me/6289680839591?text=Hai%20JoyoRogo%2C%20saya%20ada%20soalan%20tentang%20",
    );
  });
});

describe("legalPath", () => {
  test("ms goes to the Malay pages, others keep the Indonesian ones", () => {
    expect(legalPath("privacy", "ms")).toBe("/my/privasi");
    expect(legalPath("terms", "ms")).toBe("/my/syarat");
    expect(legalPath("privacy", "id")).toBe("/privasi");
    expect(legalPath("privacy", "en")).toBe("/privasi");
    expect(legalPath("terms", "en")).toBe("/syarat");
  });
});
