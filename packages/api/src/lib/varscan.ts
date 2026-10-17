// VAR perut: AI membandingkan dua foto perut milik pengguna sendiri (scan
// sekarang vs scan sebelumnya) dan memutuskan seperti juri VAR. Ini estimasi
// visual, bukan pengukuran — prompt melarang angka persen lemak/cm/berat.
import { z } from "zod";

import type { Locale } from "@joyorogo/i18n";

import { serverT } from "./messages";
import {
  extractJson,
  extractUsage,
  responseText,
  defaultSchedule,
} from "./vision";
import type { AiRunner, ScheduleTimeout } from "./vision";

// Model sama dengan scan piring; jawaban pendek (satu baris JSON) jadi
// thinking dimatikan untuk latensi rendah, senada dengan vision.ts.
export const VAR_VISION_PROMPT_BASE = `Anda juri VAR perut. Bandingkan dua foto perut orang yang SAMA: foto pertama = scan lama, foto kedua = scan terbaru.
Putuskan secara VISUAL saja apakah perut di foto terbaru terlihat lebih rata (turun), sama saja, atau lebih menonjol (naik) dibanding foto lama.
Jawab HANYA JSON valid satu baris (tanpa \`\`\`, tanpa teks lain) dengan bentuk persis:
{"verdict":"turun|sama|naik|beda","confidence":number,"reason":"satu kalimat Bahasa Indonesia"}
verdict "beda" artinya kedua foto TIDAK bisa dibandingkan: pose/jarak/pencahayaan/pakaian berbeda jauh, perut tidak terlihat jelas, atau subjeknya bukan perut orang dewasa. Kalau ragu antara dua verdict, pilih "beda" atau turunkan confidence.
confidence = 0-1, kepercayaan pada verdict visual itu. HONEST: foto telepon TIDAK bisa mengukur lemak tubuh, berat badan, atau cm lingkar perut — jangan pernah menyebut angka pengukuran di reason. reason maksimal 120 karakter, tanpa tanda kutip ganda.`;

export type VarVerdict = "pertama" | "turun" | "sama" | "naik" | "beda";

export const VAR_VERDICTS = ["turun", "sama", "naik", "beda"] as const;

// Loose upper bounds — real clamping happens in varResultFromText, mirroring
// vision.ts's parse-then-clamp approach.
export const varResultSchema = z.object({
  verdict: z.enum(VAR_VERDICTS),
  confidence: z.number().optional(),
  reason: z.string().max(2000).optional(),
});

export type VarAnalysis = {
  verdict: VarVerdict;
  confidence: number;
  reason: string;
  model: string;
  usage: Record<string, unknown> | null;
};

/**
 * Prompt tambahan untuk "Hitung ulang": pengguna menilai verdict pertama
 * kurang tepat. Catatan opsionalnya kata-kata pengguna sendiri; keduanya
 * hanya mengarahkan pembacaan ulang foto yang sama, bukan menyetir hasil.
 */
export function varRetryInstruction(hint?: string): string {
  const base =
    "Koreksi: verdict sebelumnya untuk pasangan foto ini dinilai kurang tepat oleh pengguna. Periksa ulang kedua foto dengan teliti dan jawab jujur sesuai yang terlihat, dengan bentuk JSON yang sama.";
  return hint ? `${base} Catatan pengguna: "${hint}".` : base;
}

/** Satu usaha inferensi dengan batas waktu keras (pola yang sama dengan vision.ts). */
function runVarOnce(
  ai: AiRunner,
  model: string,
  opts: {
    previous: { imageBase64: string; label: string };
    current: { imageBase64: string; mimeType: string; label: string };
    waistCm: number | null;
    retry?: { hint?: string };
  },
  timeoutMs: number,
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<unknown> {
  const waistLine =
    opts.waistCm !== null
      ? ` Data objektif pemiliknya: lingkar perut tercatat ${opts.waistCm} cm (meteran, jangan diulang di reason).`
      : "";
  const retryLine = opts.retry ? ` ${varRetryInstruction(opts.retry.hint)}` : "";
  const run = ai.run(model, {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${VAR_VISION_PROMPT_BASE}${waistLine}${retryLine} Foto lama (${opts.previous.label}) dikirim lebih dulu, lalu foto terbaru (${opts.current.label}).`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${opts.previous.imageBase64}` },
          },
          {
            type: "image_url",
            image_url: { url: `data:${opts.current.mimeType};base64,${opts.current.imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 300,
    chat_template_kwargs: { enable_thinking: false },
  });
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const cancel = schedule(() => reject(new Error("var-vision-timeout")), timeoutMs);
  return Promise.race([run, deadline]).finally(cancel);
}

/** Parse dan batkalkan satu jawaban model; error biasa kalau tidak layak. */
export function varResultFromText(
  text: string,
): { verdict: Exclude<VarVerdict, "pertama">; confidence: number; reason: string } {
  const parsed = varResultSchema.parse(extractJson(text.replace(/```(?:json)?/g, "")));
  const confidence = parsed.confidence;
  return {
    verdict: parsed.verdict,
    // Models sometimes answer percents (72) instead of fractions (0.72).
    confidence:
      confidence === undefined
        ? 0.6
        : Math.round(Math.min(1, Math.max(0, confidence > 1 ? confidence / 100 : confidence)) * 100) /
          100,
    reason: (parsed.reason ?? "").trim().slice(0, 200),
  };
}

/**
 * Dua usaha dengan pola vision.ts: usaha kedua hanya setelah kegagalan cepat
 * (jawaban tak ter-parse, transport blip). Timeout/slow fail langsung berhenti
 * — pengguna sudah menunggu cukup lama.
 */
export async function analyzeVarPhotos(
  ai: AiRunner,
  opts: {
    previous: { imageBase64: string; label: string };
    current: { imageBase64: string; mimeType: string; label: string };
    waistCm: number | null;
    /** Present when this run re-checks a pair the user judged inaccurate. */
    retry?: { hint?: string };
    model?: string;
    /** Language of the failure message. */
    locale: Locale;
    /** Injectable for tests. */
    timeouts?: [number, number];
    /** Fast-failure budget, ms; a failure past it never chains a retry. */
    budgetMs?: number;
    schedule?: ScheduleTimeout;
  },
): Promise<VarAnalysis> {
  const model = opts.model || "@cf/google/gemma-4-26b-a4b-it";
  const deadlines = opts.timeouts ?? [25_000, 20_000];
  const budgetMs = opts.budgetMs ?? 12_000;

  for (const [attempt, timeoutMs] of deadlines.entries()) {
    const attemptStartedAt = Date.now();
    try {
      const result = await runVarOnce(ai, model, opts, timeoutMs, opts.schedule);
      const text = responseText(result);
      if (text === null) throw new Error("no text in response");
      const parsed = varResultFromText(text);
      return { ...parsed, model, usage: extractUsage(result) };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "var-vision-timeout";
      const elapsed = Date.now() - attemptStartedAt;
      console.error(
        `[var-scan] attempt ${attempt + 1} failed after ${elapsed}ms`,
        error,
      );
      if (isTimeout || elapsed > budgetMs) break;
    }
  }

  throw new Error(serverT(opts.locale, "varperut")("errors.compareFailed"));
}
