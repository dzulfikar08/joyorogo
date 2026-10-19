import { ENERGY_SOURCES } from "@joyorogo/api/lib/energy-sources";
import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/** "Sumber": every reference behind the energy model, with what it is used for and a link to open it. */
export function EnergySources({ className }: { className?: string }) {
  const { t } = useTranslation("energy");
  return (
    <section className={className} aria-label={t("sources.title")}>
      <h3 className="text-base font-bold tracking-tight">{t("sources.title")}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("sources.intro")}</p>
      <ol className="mt-3 divide-y divide-border">
        {ENERGY_SOURCES.map((source) => (
          <li key={source.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm leading-relaxed font-semibold">{t(`sources.items.${source.id}.ref`)}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`sources.items.${source.id}.use`)}</p>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-semibold text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {t("sources.open")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
        ))}
      </ol>
      <Link
        to="/panduan/kalori"
        className="mt-3 inline-flex min-h-11 items-center rounded-full text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        {t("readMore")}
      </Link>
    </section>
  );
}
