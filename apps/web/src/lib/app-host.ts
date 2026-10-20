import { appHref, hostConfig, hostRedirect } from "./hosts";

/** Null unless the build knows both hosts (VITE_APP_URL set): self-hosted, localhost and workers.dev builds serve everything from one. */
export const HOSTS = hostConfig(import.meta.env.VITE_SITE_URL || "https://joyorogo.com", import.meta.env.VITE_APP_URL);

/** Link to an app screen from a page that may be on the marketing host. */
export function appUrl(path: string, search?: Record<string, string>): string {
  const query = search && Object.keys(search).length > 0 ? `?${new URLSearchParams(search)}` : "";
  return appHref(HOSTS, window.location.host, `${path}${query}`);
}

/** Where the router must send the browser instead of rendering `pathname` here, or null. */
export function wrongHostUrl(pathname: string, search: string, hash: string): string | null {
  return hostRedirect(HOSTS, window.location.host, pathname, search, hash);
}
