const HINT_KEY = "jfit-signed-in";

/**
 * "This browser had a session last time": a hint only (no data, no token), so a returning user's pages can load their
 * chunks and data in parallel with the session check instead of after it. The session query stays the authority: a
 * wrong hint ends in a redirect to /login, never in showing anything.
 */
export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSessionHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Private mode: the hint is an optimisation only.
  }
}
