// Turns a folder of contributed photos plus a hand-checked labels file into
// external eval cases (packages/api/src/lib/external-case.ts):
//
//   R2  dataset/external/<source>/<caseId>/photo.jpg   1024 px long side, JPEG q75, EXIF
//                                                      stripped: what the app would upload
//       dataset/external/<source>/<caseId>/meta.json   source, consent, his weights, the
//                                                      TKPI/library reference kcal per item
//
// Usage: bun run scripts/external-import.ts <photos-dir> <labels.json> [options]
//        bun run scripts/external-import.ts --delete <labels.json> [--bucket <name>]
//   (no option)      dry run: validate, resolve every reference, print what would be written
//   --out <dir>      also write <dir>/<source>/<caseId>/{photo.jpg,meta.json} (the layout
//                    scripts/eval-scans.ts reads: use .tmp/dataset/external)
//   --upload         put the objects into R2 with `wrangler r2 object put --remote`
//   --delete         delete every object of the cases in the labels file from R2
//   --only <caseId>  restrict to one case (repeatable)
//   --bucket <name>  default joyorogo-scans (the STICKERS binding of apps/server)
//
// Nothing leaves this machine unless --upload is given. The photos folder is never
// committed; the labels file is (scripts/external-cases/<source>.labels.json).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import sharp from "sharp";

import {
  buildExternalMeta,
  caseIdOf,
  externalCaseKey,
  labelProblems,
  labelsSchema,
} from "../packages/api/src/lib/external-case";
import type { ExternalMeta, Labels } from "../packages/api/src/lib/external-case";

const ROOT = join(import.meta.dir, "..");
const WRANGLER_CONFIG = join(ROOT, "apps", "server", "wrangler.jsonc");
const MAX_SIDE = 1024;
const JPEG_QUALITY = 75;
const PREPARED = `long side ${MAX_SIDE} px, JPEG q${JPEG_QUALITY}, EXIF stripped (what the app uploads)`;

type Args = {
  positional: string[];
  out?: string;
  upload: boolean;
  del: boolean;
  only: string[];
  bucket: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    positional: [],
    upload: false,
    del: false,
    only: [],
    bucket: "joyorogo-scans",
  };
  const value = (i: number) => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") args.out = join(process.cwd(), value(i++));
    else if (arg === "--upload") args.upload = true;
    else if (arg === "--delete") args.del = true;
    else if (arg === "--only") args.only.push(value(i++));
    else if (arg === "--bucket") args.bucket = value(i++);
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else args.positional.push(arg);
  }
  const wanted = args.del ? 1 : 2;
  if (args.positional.length !== wanted) {
    throw new Error(
      args.del
        ? "usage: --delete <labels.json>"
        : "usage: <photos-dir> <labels.json> [--out <dir>] [--upload]",
    );
  }
  if (args.del && (args.upload || args.out))
    throw new Error("--delete does not combine with --upload or --out");
  return args;
}

async function readLabels(path: string): Promise<Labels> {
  const parsed = labelsSchema.safeParse(await Bun.file(path).json());
  if (!parsed.success) {
    throw new Error(
      `${path}:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  const problems = labelProblems(parsed.data);
  if (problems.length) throw new Error(`${path}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  return parsed.data;
}

/** The photo the model will see: same resize and JPEG settings as the app's upload. */
async function preparePhoto(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

async function wrangler(args: string[]): Promise<void> {
  const proc = Bun.spawn(["bunx", "wrangler", ...args, "--remote", "--config", WRANGLER_CONFIG], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
}

function describe(meta: ExternalMeta, photoBytes: number): string[] {
  const lines = [
    `${meta.source.name}/${meta.caseId}  day ${meta.source.day} ${meta.source.meal}  mapping ${meta.mapping}, trust ${meta.trust}  photo ${(photoBytes / 1024).toFixed(0)} kB`,
    `  trust: ${meta.trustWhy}`,
  ];
  for (const item of meta.items) {
    const grams =
      item.grams !== null
        ? `${item.grams} g`
        : item.group
          ? `in ${item.group} (${meta.groups.find((g) => g.id === item.group)?.grams} g together)`
          : `~${item.assumedGrams} g assumed`;
    const ref = item.ref
      ? `${item.ref.source === "manual" ? "manual" : item.ref.name} ${item.ref.kcalPer100g}/100g${item.ref.proxy ? " PROXY" : ""}`
      : "no reference";
    lines.push(
      `  [${item.inPhoto.padEnd(9)}] ${item.name.padEnd(24)} ${grams.padEnd(28)} ${item.kcal !== undefined ? `${item.kcal} kcal` : "no kcal"}  (${ref})`,
    );
  }
  for (const extra of meta.extras)
    lines.push(`  [extra    ] ${extra.name}${extra.note ? `: ${extra.note}` : ""}`);
  for (const cmp of meta.comparators)
    lines.push(
      `  [compare  ] ${cmp.source} (${cmp.scope}) ${cmp.kcalLow}-${cmp.kcalHigh} kcal: a comparator, not truth`,
    );
  const t = meta.truth;
  lines.push(
    `  scored: ${t.plateGrams ?? "n/a"} g, ${t.kcalComplete ? `${t.plateKcal} kcal` : "kcal incomplete (names + grams only)"}`,
  );
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const labelsPath = args.del ? args.positional[0]! : args.positional[1]!;
  const labels = await readLabels(labelsPath);
  const cases = labels.cases.filter((c) => !args.only.length || args.only.includes(caseIdOf(c)));
  if (!cases.length) throw new Error("no case selected");
  const source = labels.source.name;

  if (args.del) {
    for (const c of cases) {
      for (const file of ["photo.jpg", "meta.json"] as const) {
        const key = externalCaseKey(source, caseIdOf(c), file);
        console.log(`delete ${args.bucket}/${key}`);
        await wrangler(["r2", "object", "delete", `${args.bucket}/${key}`]);
      }
    }
    return;
  }

  const photosDir = args.positional[0]!;
  const importedAt = new Date().toISOString();
  const built: Array<{ id: string; meta: ExternalMeta; photo: Buffer }> = [];
  for (const c of cases) {
    const file = join(photosDir, basename(c.photo.file));
    if (!existsSync(file)) throw new Error(`${caseIdOf(c)}: photo ${file} not found`);
    const original = new Uint8Array(await Bun.file(file).arrayBuffer());
    const photo = await preparePhoto(original);
    const meta = buildExternalMeta(
      labels,
      c,
      {
        sourceSha256: createHash("sha256").update(original).digest("hex"),
        prepared: PREPARED,
        bytes: photo.byteLength,
      },
      importedAt,
    );
    built.push({ id: caseIdOf(c), meta, photo });
  }

  console.log(
    `consent: ${labels.consent.by} via ${labels.consent.channel} (${labels.consent.at})\n  scope: ${labels.consent.scope}\n  deletion: ${labels.consent.deletion}\n`,
  );
  for (const { meta, photo } of built)
    console.log(describe(meta, photo.byteLength).join("\n"), "\n");
  for (const u of labels.unmapped)
    console.log(`no photo yet: day ${u.day} ${u.meal}: ${u.said}  (${u.why})`);
  const proxies = built.flatMap(({ meta }) =>
    meta.items.filter((i) => i.ref?.proxy).map((i) => `${meta.caseId} / ${i.name}`),
  );
  console.log(
    `\n${built.length} case(s) ready, ${proxies.length} item(s) use a proxy reference row`,
  );

  if (args.out) {
    for (const { id, meta, photo } of built) {
      const dir = join(args.out, source, id);
      await mkdir(dir, { recursive: true });
      await Bun.write(join(dir, "photo.jpg"), photo);
      await Bun.write(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    }
    console.log(`wrote ${built.length} case(s) under ${args.out}/${source}/`);
  }

  if (!args.upload) {
    console.log(
      `\ndry run${args.out ? " (local copy written)" : ""}: nothing uploaded. Add --upload to put these into R2 bucket ${args.bucket}.`,
    );
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), "external-import-"));
  try {
    for (const { id, meta, photo } of built) {
      const files = [
        { name: "photo.jpg", bytes: photo, type: "image/jpeg" },
        {
          name: "meta.json",
          bytes: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`),
          type: "application/json",
        },
      ] as const;
      for (const file of files) {
        const local = join(tmp, `${id}.${file.name}`);
        await Bun.write(local, file.bytes);
        const key = externalCaseKey(source, id, file.name);
        console.log(`put ${args.bucket}/${key}`);
        await wrangler([
          "r2",
          "object",
          "put",
          `${args.bucket}/${key}`,
          "--file",
          local,
          "--content-type",
          file.type,
        ]);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  console.log(`uploaded ${built.length} case(s) to ${args.bucket}`);
}

if (import.meta.main) await main();
