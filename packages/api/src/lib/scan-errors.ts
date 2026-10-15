// Why a food photo scan failed, and what to tell the user about it. Shared by
// the API (message of the thrown error), web, and native (title + tips).

export const SCAN_FAIL_REASONS = ["too_many", "unclear", "not_food", "timeout", "failed"] as const;

export type ScanFailReason = (typeof SCAN_FAIL_REASONS)[number];

export type ScanFailCopy = {
  title: string;
  message: string;
};

export const SCAN_FAIL_COPY: Record<ScanFailReason, ScanFailCopy> = {
  too_many: {
    title: "Fotonya kebanyakan makanan",
    message:
      "Fotonya kebanyakan makanan. Coba foto 1 piring atau maksimal 3-4 jenis sekali foto, dari lebih dekat, dan pastikan cuma makanan yang mau dicatat yang masuk frame.",
  },
  unclear: {
    title: "Fotonya kurang jelas",
    message:
      "Fotonya buram atau terlalu gelap, jadi makanannya sulit dikenali. Coba foto lagi di tempat yang lebih terang dan tahan kamera sebentar sampai fokus.",
  },
  not_food: {
    title: "Makanan tidak terlihat",
    message:
      "AI tidak menemukan makanan di foto ini. Arahkan kamera langsung ke makanannya dan pastikan makanannya memenuhi frame, lalu foto lagi.",
  },
  timeout: {
    title: "AI kelamaan memproses",
    message:
      "AI kelamaan memproses fotonya. Coba lagi sebentar, atau foto 1 piring dari lebih dekat supaya lebih cepat selesai.",
  },
  failed: {
    title: "Gagal menganalisis foto",
    message: "AI tidak berhasil mengenali foto ini. Coba foto lain dengan pencahayaan lebih baik.",
  },
};

/** Shown above a result that kept only the items the AI managed to list. */
export const TOO_MANY_PARTIAL_MESSAGE =
  "Fotonya kebanyakan makanan, jadi AI cuma mencatat yang paling menonjol. Pakai item ini, atau foto ulang 1 piring (maksimal 3-4 jenis) dari lebih dekat.";

/**
 * The reason the server attached to a failed scan (`data.reason`), or null
 * for any other error. Duck-typed: web and native resolve different copies of
 * the ORPC client classes, so `instanceof` is not safe here.
 */
export function scanFailReason(error: unknown): ScanFailReason | null {
  const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason;
  return typeof reason === "string" && (SCAN_FAIL_REASONS as readonly string[]).includes(reason)
    ? (reason as ScanFailReason)
    : null;
}

/** Title for a message that is one of the server's failure copies; null for any other text. */
export function scanFailTitle(message: string): string | null {
  const reason = SCAN_FAIL_REASONS.find((r) => SCAN_FAIL_COPY[r].message === message);
  return reason ? SCAN_FAIL_COPY[reason].title : null;
}
