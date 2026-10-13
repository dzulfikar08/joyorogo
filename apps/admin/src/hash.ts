import { useEffect, useState } from "react";

/** Hash format: `#tab?key=value&…` — the query part keeps filter/pagination state across reloads. */
export function currentTab(): string {
  return window.location.hash.replace(/^#/, "").split("?")[0] || "overview";
}

/**
 * Read/write the current tab's hash query params. `set` merges the patch into
 * the URL (null deletes) so reload and back/forward keep state.
 */
export function useHashQuery(tab: string) {
  const [params, setParams] = useState(
    () => new URLSearchParams(window.location.hash.split("?")[1] ?? ""),
  );

  useEffect(() => {
    const onHash = () =>
      setParams(new URLSearchParams(window.location.hash.split("?")[1] ?? ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    const q = next.toString();
    window.location.hash = q ? `${tab}?${q}` : tab;
  };

  return { params, set };
}
