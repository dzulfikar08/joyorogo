import { fmtInt } from "@/lib/format";

/** "+120", "−45" (true minus sign), "0": a difference that always says which way it goes. */
export function fmtSigned(n: number): string {
  if (n > 0) return `+${fmtInt(n)}`;
  if (n < 0) return `\u2212${fmtInt(-n)}`;
  return fmtInt(0);
}
