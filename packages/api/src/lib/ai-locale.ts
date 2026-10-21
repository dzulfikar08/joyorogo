import { DEFAULT_LOCALE } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

// Output language for AI prompts. The prompts stay Indonesian (the model reads
// them well, and the TKPI database and local dishes are Indonesian); only the
// language of what comes back to the user changes.

/** Language name as the model should read it. Add one per shipped locale. */
const LANGUAGE_NAME: Record<Locale, string> = {
  id: "Indonesian",
  en: "English",
  ms: "Malay (Bahasa Melayu, Malaysian usage: kalori, makan tengah hari, hidangan, kedai mamak)",
};

/** Examples of a dish with a common name in the language, and the rule for a dish that has none. */
const NAME_EXAMPLES: Record<Locale, { translated: string; kept: string }> = {
  id: { translated: "", kept: "" },
  en: {
    translated: '"Fried chicken", "Iced sweet tea"',
    kept: 'masakan khas Indonesia tanpa padanan umum tulis apa adanya (mis. "Nasi goreng", "Gado-gado", "Rendang")',
  },
  ms: {
    translated: '"Ayam goreng", "Teh ais manis", "Nasi putih"',
    kept: 'masakan khas tanpa padanan umum tulis apa adanya (mis. "Gado-gado", "Rendang", "Nasi lemak")',
  },
};

/**
 * Extra JSON field + rule for non-Indonesian users. `name` stays the
 * Indonesian dish name: matching against TKPI, broth and kind detection all
 * read it. `localName` (and `portion`) are what the user sees; the parser swaps
 * them in last.
 */
export function localNameShape(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `"localName":"name in ${LANGUAGE_NAME[locale]}",`;
}

export function localNameRule(locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return "";
  const language = LANGUAGE_NAME[locale];
  const examples = NAME_EXAMPLES[locale];
  return `\nUser language: ${language}. "name" tetap nama masakan Bahasa Indonesia seperti aturan di atas (dipakai untuk mencocokkan database gizi). Isi "localName" dengan nama dalam ${language}: makanan yang punya nama umum dalam ${language} pakai nama itu (mis. ${examples.translated}); ${examples.kept}. "portion" juga dalam ${language}.`;
}

/** Name the model should whisper-transcribe as; ISO 639-1 equals our locale codes. */
export function transcriptionLanguage(locale: Locale): string {
  return locale;
}
