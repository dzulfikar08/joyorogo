import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { homeCardsFor, isDefaultHomeCards } from "@joyorogo/api/lib/home-cards";
import type { HomeCardId } from "@joyorogo/api/lib/home-cards";

import { Page, PageHeader } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { moveCard, resetHomeCards, setCardHidden, useHomeCards } from "@/lib/home-cards-store";

export const Route = createFileRoute("/_auth/beranda-kartu")({
  component: BerandaKartuPage,
});

const WEB_CARDS: readonly HomeCardId[] = homeCardsFor("web");

const MOVE_BUTTON =
  "flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-30 disabled:hover:bg-transparent";

/** Which cards Beranda shows and in what order; kept on this device. Every control is a real button for the keyboard. */
function BerandaKartuPage() {
  const { t } = useTranslation(["home", "common"]);
  const prefs = useHomeCards();
  const list = prefs.order.filter((id) => WEB_CARDS.includes(id));
  const page = useRef<HTMLUListElement>(null);
  // The DOM node of a moved row is re-inserted, which drops focus in some browsers: put it back on the same button.
  const refocus = useRef<{ id: HomeCardId; dir: "up" | "down" } | null>(null);

  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const row = page.current?.querySelector<HTMLElement>(`[data-card="${target.id}"]`);
    const wanted = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${target.dir === "up" ? "down" : "up"}"]`,
    );
    // At the end of the list the pressed button is now disabled: land on the other one.
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [prefs]);

  return (
    <Page className="max-w-xl">
      <Link
        to="/beranda"
        className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeft className="size-5" aria-hidden />
        {t("common:actions.back")}
      </Link>
      <PageHeader title={t("cards.title")} subtitle={t("cards.lead")} className="pt-0" />

      <ul ref={page} className="divide-y divide-border overflow-hidden rounded-3xl bg-card">
        {list.map((id, index) => {
          const hidden = prefs.hidden.includes(id);
          const name = t(`cards.names.${id}`);
          return (
            <li key={id} data-card={id} className="flex min-h-16 items-center gap-2 py-2 pr-2 pl-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Switch
                  checked={!hidden}
                  onCheckedChange={(on) => setCardHidden(id, !on)}
                  label={name}
                />
                <span
                  aria-hidden
                  className={cn(
                    "min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold",
                    hidden && "text-muted-foreground",
                  )}
                >
                  {name}
                </span>
                <span className="sr-only">
                  {t("cards.position", { card: name, n: index + 1, total: list.length })}
                </span>
              </div>
              <button
                type="button"
                data-move="up"
                aria-label={t("cards.moveUp", { card: name })}
                disabled={index === 0}
                onClick={() => {
                  refocus.current = { id, dir: "up" };
                  moveCard(id, -1);
                }}
                className={MOVE_BUTTON}
              >
                <ChevronUp className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                data-move="down"
                aria-label={t("cards.moveDown", { card: name })}
                disabled={index === list.length - 1}
                onClick={() => {
                  refocus.current = { id, dir: "down" };
                  moveCard(id, 1);
                }}
                className={MOVE_BUTTON}
              >
                <ChevronDown className="size-5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      {!isDefaultHomeCards(prefs) && (
        <Button variant="secondary" className="mt-4 min-h-11 w-full" onClick={resetHomeCards}>
          {t("cards.reset")}
        </Button>
      )}
    </Page>
  );
}
