import { useSyncExternalStore } from "react";

import { trackConversion } from "./analytics";

// One shared "Pasang di iPhone" sheet for the whole SPA: any CTA or the
// in-app banner opens it, the host in the root route renders it.

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `source` says which surface asked: hero, closing, harga, blog, banner, profil, link. */
export function openIosInstall(source: string) {
  if (open) return;
  open = true;
  trackConversion("ios_install_sheet_open", { source });
  emit();
}

export function closeIosInstall() {
  if (!open) return;
  open = false;
  emit();
}

export function useIosInstallOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}

const BANNER_KEY = "jrg-ios-install-banner-dismissed";

function bannerDismissed(): boolean {
  try {
    return localStorage.getItem(BANNER_KEY) === "1";
  } catch {
    // Storage blocked (private mode): treat as dismissed rather than nagging every visit.
    return true;
  }
}

/** Banner shown once: dismissing it, or opening the sheet from it, retires it for good. */
export function dismissIosInstallBanner() {
  try {
    localStorage.setItem(BANNER_KEY, "1");
  } catch {
    // Nothing to persist to; the banner state below still hides it for this visit.
  }
  bannerHidden = true;
  emit();
}

let bannerHidden = false;

export function useIosInstallBannerVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !bannerHidden && !bannerDismissed(),
    () => false,
  );
}
