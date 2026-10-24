/** Pure helpers behind the live caption of the spoken correction (see components/scan/use-live-speech.ts). */

/** The server takes 2..300 characters of correction text. */
export const MIN_CORRECTION_CHARS = 2;
export const MAX_CORRECTION_CHARS = 300;
/** How many trailing characters of the live transcript fit the three-line caption. */
const CAPTION_CHARS = 120;

const SPEECH_LANG: Record<string, string> = { id: "id-ID", en: "en-US", ms: "ms-MY" };

/** App locale to the BCP-47 tag the recognizer wants. Unknown locales read as Indonesian, the app default. */
export function speechLang(locale: string): string {
  return SPEECH_LANG[locale] ?? SPEECH_LANG.id!;
}

/**
 * What the recognizer has produced so far. Android's continuous mode ends a segment with a final result and starts the
 * next one; iOS streams the whole utterance as interim results and finalizes once at the end. Both read the same way:
 * final segments pile up in `committed`, the live segment sits in `interim`.
 */
export type LiveText = { committed: string; interim: string };

export const EMPTY_LIVE_TEXT: LiveText = { committed: "", interim: "" };

function joinWords(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function applyResult(state: LiveText, result: { transcript: string; isFinal: boolean }): LiveText {
  const transcript = result.transcript.trim();
  if (result.isFinal) {
    return { committed: joinWords(state.committed, transcript), interim: "" };
  }
  return { committed: state.committed, interim: transcript };
}

/** The recognizer restarted (or stopped) mid-segment: keep what it heard as final text. */
export function commitInterim(state: LiveText): LiveText {
  return { committed: joinWords(state.committed, state.interim), interim: "" };
}

export function liveTranscript(state: LiveText): string {
  return joinWords(state.committed, state.interim).replace(/\s+/g, " ");
}

/** The text to send as a correction, or null when it is too short to mean anything. */
export function correctionText(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.replace(/\s/g, "").length < MIN_CORRECTION_CHARS) return null;
  return collapsed.slice(0, MAX_CORRECTION_CHARS).trim();
}

/** The latest words of a long transcript, cut at a word boundary, with a leading ellipsis. */
export function captionTail(text: string, max: number = CAPTION_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const space = cut.indexOf(" ");
  const tail = space > 0 && space < cut.length - 1 ? cut.slice(space + 1) : cut;
  return `…${tail}`;
}

/** Errors that mean "live recognition cannot work here": the next take falls back to recording audio. */
const AVAILABILITY_ERRORS: Record<string, true> = {
  "not-allowed": true,
  "service-not-allowed": true,
  "language-not-supported": true,
  network: true,
};

export function isAvailabilityError(code: string): boolean {
  return AVAILABILITY_ERRORS[code] === true;
}

/** `id-ID` and `id_ID` name the same installed language pack. */
export function hasInstalledLocale(installed: string[], lang: string): boolean {
  const want = lang.toLowerCase().replace("_", "-");
  return installed.some((tag) => tag.toLowerCase().replace("_", "-") === want);
}
