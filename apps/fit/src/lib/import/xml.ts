// GPX and TCX are XML with vendor extensions in different namespaces: read them by local name, whatever prefix a file uses.

export function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement ? null : doc;
}

/** Descendant elements with this local name, in document order. */
export function all(root: ParentNode, name: string): Element[] {
  return Array.from((root as Element | Document).getElementsByTagName("*")).filter(
    (el) => el.localName === name,
  );
}

export function first(root: ParentNode, name: string): Element | null {
  return all(root, name)[0] ?? null;
}

/** Text of the first descendant with this local name. */
export function textOf(root: ParentNode, name: string): string | null {
  const text = first(root, name)?.textContent?.trim();
  return text ? text : null;
}

export function numberOf(root: ParentNode, name: string): number | null {
  const text = textOf(root, name);
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** ISO 8601 time to unix seconds; null when it is not a date. */
export function secondsOf(text: string | null): number | null {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}
