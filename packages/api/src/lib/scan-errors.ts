// Why a food photo scan failed. The server throws ORPCError with
// `data: { reason }`; web and native look the copy up by code
// (`scan:fail.reason.<code>.title|message`).

export const SCAN_FAIL_REASONS = ["too_many", "unclear", "not_food", "timeout", "failed"] as const;

export type ScanFailReason = (typeof SCAN_FAIL_REASONS)[number];

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
