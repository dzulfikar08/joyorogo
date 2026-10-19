import { useSyncExternalStore } from "react";

/** Live `matchMedia` result; `false` on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `sm` (640 px): phones, where menus open as bottom sheets. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639.98px)");
}
