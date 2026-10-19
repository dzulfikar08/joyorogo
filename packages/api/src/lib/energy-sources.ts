// The sources behind the energy model, as the "Sumber" list shows them. The citation text and what each is used for
// live in the i18n namespace `energy` (sources.items.<id>.ref / .use); this is the order and the link of each. Every
// entry was checked against its PubMed / FAO page. Contract for humans: docs/energy-model.md.

export const ENERGY_SOURCES = [
  { id: "mifflin", url: "https://pubmed.ncbi.nlm.nih.gov/2305711/" },
  { id: "fao", url: "https://www.fao.org/4/y5686e/y5686e00.htm" },
  { id: "westerterp", url: "https://pubmed.ncbi.nlm.nih.gov/15507147/" },
  { id: "shcherbina", url: "https://pubmed.ncbi.nlm.nih.gov/28538708/" },
  { id: "tudor", url: "https://pubmed.ncbi.nlm.nih.gov/14715035" },
  { id: "hall", url: "https://pubmed.ncbi.nlm.nih.gov/21872751/" },
] as const;

export type EnergySourceId = (typeof ENERGY_SOURCES)[number]["id"];
