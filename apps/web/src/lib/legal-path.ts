// Which legal page a link opens. Malay users get the Malay notice and terms (PDPA wants the national language);
// every other language keeps the Indonesian pages, as before. The English notice is reached from the Malay page
// ("Read this in English") and from /my. The native app has the same two lines in apps/native/src/lib/legal-url.ts.

export type LegalKind = "privacy" | "terms";

export type LegalRoute = "/privasi" | "/syarat" | "/my/privasi" | "/my/syarat";

export function legalPath(kind: LegalKind, locale: string): LegalRoute {
  if (locale === "ms") return kind === "privacy" ? "/my/privasi" : "/my/syarat";
  return kind === "privacy" ? "/privasi" : "/syarat";
}
