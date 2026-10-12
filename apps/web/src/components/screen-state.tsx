import { type ReactNode } from "react";

import { ErrorNote } from "@/components/kit/error-note";
import { Page } from "@/components/kit/surface";

// R-27: every screen ships loading, error, and empty states that name the
// cause and the next action. Loading pages use skeletons shaped like the
// real content (route pendingComponent), not this module.

/** Whole-screen error: the page column with one ErrorNote. */
export function ScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Page className="max-w-xl pt-6">
      <ErrorNote message={message} onRetry={onRetry} />
    </Page>
  );
}

export function EmptyHint({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-card px-5 py-8 text-center">
      <p className="text-[0.9375rem] font-bold">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
