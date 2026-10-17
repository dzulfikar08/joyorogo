import type { Locale } from "@joyorogo/i18n";

import { serverT } from "./messages";
import type { ScanFailReason } from "./scan-errors";

/** Localized "what went wrong with this photo" for the ORPCError message. */
export function scanFailMessage(reason: ScanFailReason, locale: Locale): string {
  return serverT(locale, "scan")(`fail.reason.${reason}.message`);
}
