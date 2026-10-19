import { buyLinks } from "@joyorogo/api/lib/meal/links";
import type { BuyApp, BuyLink } from "@joyorogo/api/lib/meal/links";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Bike, ExternalLink, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { MealPlanItem } from "@/lib/api-types";

const ROW =
  "flex min-h-14 w-full items-center gap-3 rounded-2xl bg-muted px-4 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/** The sheet names these links as `buy.<app>` and says in `buy.<app>Hint` what opening one does. */
const HINT: Record<BuyApp, "buy.nearbyHint" | "buy.appHint" | "buy.grabHint"> = {
  maps: "buy.nearbyHint",
  gofood: "buy.appHint",
  grabfood: "buy.grabHint",
  shopeefood: "buy.appHint",
};

/** A meal to buy ready-made: look for it near you on Google Maps, or open GoFood, GrabFood or ShopeeFood. */
export function BuySheet({ item, onClose }: { item: MealPlanItem; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");

  const copyName = (link: BuyLink) => {
    if (!link.copyName) return;
    // Runs inside the tap, so the browser allows it; the link opens either way.
    navigator.clipboard.writeText(item.buyQuery).then(
      () => toast.success(t("buy.copied")),
      () => toast.error(t("buy.copyFailed", { name: item.buyQuery })),
    );
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("buy.title", { name: item.name })}
      description={t("buy.subtitle")}
    >
      <ul className="space-y-2">
        {buyLinks(item.buyQuery).map((link) => {
          const Icon = link.app === "maps" ? MapPin : Bike;
          return (
            <li key={link.app}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => copyName(link)}
                className={ROW}
              >
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-bold">
                    {link.app === "maps" ? t("buy.nearby") : t(`buy.${link.app}`)}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">
                    {t(HINT[link.app])}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{t("buy.note")}</p>
    </Sheet>
  );
}
