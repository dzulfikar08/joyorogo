/**
 * JoyoArto (family finance ledger, app.arto.joyorogo.com) sells no Pro of its own: one Joyo Pro per JoyoRogo account
 * covers JoyoRogo, JoyoFit and JoyoArto. JoyoArto's Upgrade opens `/pro?from=joyoarto`; that tag rides through the
 * checkout (`source` on the order, `from` on the return pages) and turns into a "Back to JoyoArto" link.
 *
 * The return link is this one constant. Nothing in a URL can change where it points, so `from` is not an open redirect.
 */
export const JOYOARTO_RETURN_URL = "https://app.arto.joyorogo.com/settings";

/** Where a checkout was started from besides JoyoRogo itself; the server accepts the same allowlist. */
export type CheckoutSource = "joyoarto";

/** `from` query value to checkout source; anything else is ignored. */
export function checkoutSource(from: unknown): CheckoutSource | undefined {
  return from === "joyoarto" ? "joyoarto" : undefined;
}

/** True when a path (with its query) is the JoyoArto upgrade path, e.g. the login page's `redirect`. */
export function isJoyoArtoReturn(path: string | undefined): boolean {
  if (!path) return false;
  const query = path.split("?")[1] ?? "";
  return checkoutSource(new URLSearchParams(query).get("from")) !== undefined;
}
