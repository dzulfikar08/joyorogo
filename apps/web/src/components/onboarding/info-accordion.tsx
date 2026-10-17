import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/** Collapsed-by-default row for explanations, so each onboarding step stays one screen. */
export function InfoAccordion({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-bold select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-1.5 px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
