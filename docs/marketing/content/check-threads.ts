// Flags Threads text that contains a word many Indonesian Threads users hide (social-playbook.md section 3.1).
//   bun docs/marketing/content/check-threads.ts              every caption.md and drafts-*.md under docs/marketing
//   bun docs/marketing/content/check-threads.ts <file>...    those files; a .txt file is checked whole
// Only the Threads part of a caption is checked: from a "## Threads" or "**Threads**" line to the next "## " heading
// or the next bold label of another channel or section (Instagram, TikTok, Carousel, Hashtag, Cek sebelum posting).
// Exits 1 when anything is found.
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { findThreadsHiddenWords } from "../../../packages/api/src/lib/threads-bot/hidden-words";

const marketingDir = join(import.meta.dir, "..");
const START = /^(##\s+Threads\b|\*\*Threads\*\*)/;
const END = /^(##\s|\*\*(Instagram|TikTok|Carousel|Hashtag|Cek sebelum posting)\b)/;

function threadsLines(path: string): { line: number; text: string }[] {
  const lines = readFileSync(path, "utf8").split("\n");
  if (path.endsWith(".txt")) return lines.map((text, i) => ({ line: i + 1, text }));
  const out: { line: number; text: string }[] = [];
  let inThreads = false;
  lines.forEach((text, i) => {
    if (START.test(text)) inThreads = true;
    else if (END.test(text)) inThreads = false;
    else if (inThreads) out.push({ line: i + 1, text });
  });
  return out;
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      ...new Glob("**/caption.md").scanSync(marketingDir),
      ...new Glob("**/drafts-*.md").scanSync(marketingDir),
    ].map((f) => join(marketingDir, f)).sort();

let found = 0;
for (const file of files) {
  for (const { line, text } of threadsLines(file)) {
    const words = findThreadsHiddenWords(text);
    if (!words.length) continue;
    found++;
    console.log(`${relative(process.cwd(), file)}:${line}: ${words.map((w) => `"${w}"`).join(", ")}`);
  }
}
console.log(found ? `${found} line(s) with hidden words` : `ok: ${files.length} file(s), no hidden words`);
process.exit(found ? 1 : 0);
