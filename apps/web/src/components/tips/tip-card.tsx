import type { Tip } from "@joyorogo/api/lib/tips";
import { BookOpen } from "lucide-react";

import { TipIconGlyph } from "@/components/tips/tip-icon";

const FOCUS =
  "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/** Halaman artikel tip adalah berkas statis di luar SPA, jadi ini anchor biasa. */
export function blogTipUrl(slug: string): string {
  return `/blog/${slug}/`;
}

/** Kartu tips ringkas untuk feed; seluruh kartu jadi tautan ke artikelnya. */
export function TipCard({ tip }: { tip: Tip }) {
  return (
    <a
      href={blogTipUrl(tip.slug)}
      aria-label={`Tips: ${tip.title}. Baca artikelnya.`}
      className={`block rounded-2xl bg-muted p-4 transition-colors hover:bg-card ${FOCUS}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft text-makan-ink"
        >
          <TipIconGlyph icon={tip.icon} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-makan-ink">Tips</p>
          <h3 className="mt-0.5 font-bold leading-snug">{tip.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{tip.summary}</p>
        </div>
      </div>
      <span className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-4 text-sm font-semibold">
        <BookOpen className="size-4" aria-hidden />
        Baca
      </span>
    </a>
  );
}
