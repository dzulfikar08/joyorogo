// Which legal page the app opens. Malay users get the Malay notice and terms (PDPA wants the national language);
// every other language keeps the Indonesian pages. The English PDPA notice is one tap away from the Malay page.
// Web has the same two lines in apps/web/src/lib/legal-path.ts.

export function privacyUrl(base: string, locale: string): string {
  return `${base}${locale === "ms" ? "/my/privasi" : "/privasi"}`;
}

export function termsUrl(base: string, locale: string): string {
  return `${base}${locale === "ms" ? "/my/syarat" : "/syarat"}`;
}
