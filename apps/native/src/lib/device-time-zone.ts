/** The device's IANA zone ("Asia/Kuala_Lumpur"), or null when Hermes cannot say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
