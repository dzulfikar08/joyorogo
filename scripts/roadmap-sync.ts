#!/usr/bin/env bun
// Regenerates the README roadmap from docs/roadmap.json (the same file the landing page reads).
//
//   bun scripts/roadmap-sync.ts           rewrite README.md between the roadmap markers
//   bun scripts/roadmap-sync.ts --check   exit 1 if README.md is out of date, write nothing
//
// Shape of docs/roadmap.json: { product, updated, groups: [{ id, title, items: string[] }] }.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Group = { id: string; title: string; items: string[] };
type Roadmap = { product: string; updated: string; groups: Group[] };

const root = join(import.meta.dir, "..");
const readmePath = join(root, "README.md");
const START = "<!-- roadmap:start -->";
const END = "<!-- roadmap:end -->";

const roadmap: Roadmap = JSON.parse(readFileSync(join(root, "docs/roadmap.json"), "utf8"));
if (!Array.isArray(roadmap.groups)) throw new Error("docs/roadmap.json: groups must be an array");

const body = [
  START,
  "<!-- Dibuat oleh scripts/roadmap-sync.ts dari docs/roadmap.json. Ubah file itu, jangan bagian ini. -->",
  "",
  ...roadmap.groups.flatMap((group) => [
    `**${group.title}**`,
    "",
    ...group.items.map((item) => `- ${item}`),
    "",
  ]),
  `Diperbarui ${roadmap.updated}. Tanpa tanggal rilis: urutan di tiap kelompok bukan janji jadwal.`,
  END,
].join("\n");

const readme = readFileSync(readmePath, "utf8");
const from = readme.indexOf(START);
const to = readme.indexOf(END);
if (from === -1 || to === -1 || to < from) {
  console.error(`README.md needs ${START} and ${END} markers.`);
  process.exit(2);
}

const next = readme.slice(0, from) + body + readme.slice(to + END.length);
if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md roadmap is out of date. Run: bun scripts/roadmap-sync.ts");
    process.exit(1);
  }
} else if (next !== readme) {
  writeFileSync(readmePath, next);
  console.log("README.md roadmap updated.");
} else {
  console.log("README.md roadmap already up to date.");
}
