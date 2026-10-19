import { useEffect } from "react";

/** The browser tab's title. A hook, not route metadata, so it follows a language switch (the tree remounts then). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · JoyoFit`;
  }, [title]);
}
