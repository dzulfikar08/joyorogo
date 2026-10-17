import { localizeTip, type Tip } from "@joyorogo/api/lib/tips";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TipIconGlyph } from "@/components/tips/tip-icon";

const FOCUS =
  "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/** Halaman artikel tip adalah berkas statis di luar SPA, jadi ini anchor biasa. */
export function blogTipUrl(slug: string): string {
  return `/blog/${slug}/`;
}

/** Kartu tips ringkas untuk feed; seluruh kartu jadi tautan ke artikelnya. */
export function TipCard({ tip: meta }: { tip: Tip }) {
  const { t } = useTranslation("tips");
  const tip = localizeTip(meta);
  return (
    <a
      href={blogTipUrl(tip.slug)}
      aria-label={t("card.aria", { title: tip.title })}
      className={`flex items-center gap-3 rounded-2xl bg-muted p-3.5 transition-colors hover:bg-card ${FOCUS}`}
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft text-makan-ink"
      >
        <TipIconGlyph icon={tip.icon} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-makan-ink">{t("card.kicker")}</p>
        <h3 className="mt-0.5 line-clamp-2 leading-snug font-bold">{tip.title}</h3>
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground">
          {tip.summary}
        </p>
      </div>
      <span className="flex shrink-0 items-center text-sm font-semibold text-muted-foreground">
        {t("card.read")}
        <ChevronRight className="size-4" aria-hidden />
      </span>
    </a>
  );
}
