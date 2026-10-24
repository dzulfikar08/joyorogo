import {
  CONTAINER_PRESETS,
  netScaleGrams,
  parseContainers,
  rememberContainer,
  scaleGrams,
  scaleValue,
} from "@joyorogo/api/lib/scale-chip";
import type { ScaleReadChip } from "@joyorogo/api/lib/scale-chip";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { fmtGramsLabel } from "@/lib/format";

// The last empty containers this browser subtracted, newest first (a person reuses the same bowls). Local only.
const CONTAINERS_KEY = "joyorogo.scan.containers";

const readContainers = (): number[] => {
  try {
    return parseContainers(localStorage.getItem(CONTAINERS_KEY));
  } catch {
    return [];
  }
};

const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
    active
      ? "pressable bg-primary text-primary-foreground"
      : "bg-muted text-foreground hover:bg-border",
  );

/**
 * Under a scan row whose weight was read off a kitchen-scale display in the
 * photo (lib/scale-reading.ts): "Terbaca dari timbangan: 100 g" and "Perkiraan
 * foto: 150 g", one click to switch. The row's numbers follow the pick
 * (swapScaleRead); the grams can still be corrected in the box below.
 *
 * "Termasuk wadah?": the scale often weighed the bowl or plate with the food. The
 * chip opens the empty container's weight (remembered ones, a rough bowl and plate,
 * or typed); `onTare` takes it off the reading (tareScaleRows) and answers false
 * when the container is not lighter than the reading.
 */
export function ScaleReadChips({
  name,
  item,
  onSwap,
  onTare,
}: {
  name: string;
  item: { grams?: number; scaleRead?: ScaleReadChip };
  onSwap: () => void;
  onTare: (grams: number) => boolean;
}) {
  const { t } = useTranslation("scan");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tooHeavy, setTooHeavy] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  const grams = scaleGrams(item);
  const chip = item.scaleRead;
  if (!grams || !chip) return null;
  const scaleActive = chip.active === "scale";
  const value = scaleValue(chip, fmtGramsLabel);
  const tare = chip.tare ?? 0;

  const apply = (next: number) => {
    if ((next > 0 && netScaleGrams(chip, next) === null) || !onTare(next)) {
      setTooHeavy(true);
      return;
    }
    if (next > 0) {
      const list = rememberContainer(recent, next);
      setRecent(list);
      try {
        localStorage.setItem(CONTAINERS_KEY, JSON.stringify(list));
      } catch {
        // Private mode or a full quota: the list is a convenience.
      }
    }
    setTooHeavy(false);
    setTyped("");
    setOpen(false);
  };
  const typedGrams = Number(typed.replace(",", "."));
  const presets = CONTAINER_PRESETS.filter((p) => !recent.some((g) => Math.abs(g - p.grams) <= 5));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typedGrams >= 1) apply(Math.round(typedGrams));
  };

  return (
    <div className="space-y-2">
      <span
        role="group"
        aria-label={t("result.items.scaleGroup", { name })}
        className="flex flex-wrap gap-1.5"
      >
        <button
          type="button"
          aria-pressed={scaleActive}
          onClick={scaleActive ? undefined : onSwap}
          className={chipClass(scaleActive)}
        >
          {chip.count > 1
            ? t("result.items.scaleReadShared", { value, count: chip.count })
            : t("result.items.scaleRead", { value })}
        </button>
        <button
          type="button"
          aria-pressed={!scaleActive}
          onClick={scaleActive ? onSwap : undefined}
          className={chipClass(!scaleActive)}
        >
          {t("result.items.scaleAi", { grams: fmtGramsLabel(grams.ai) })}
        </button>
        {scaleActive && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setTooHeavy(false);
              if (!open) setRecent(readContainers());
              setOpen(!open);
            }}
            className={chipClass(tare > 0 || open)}
          >
            {tare > 0
              ? t("result.items.tareApplied", { grams: fmtGramsLabel(tare) })
              : t("result.items.tareChip")}
          </button>
        )}
      </span>
      {open && scaleActive && (
        <form id={panelId} onSubmit={submit} className="space-y-2 rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-semibold">{t("result.items.tareTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("result.items.tareHint")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((g) => (
              <button key={`r${g}`} type="button" onClick={() => apply(g)} className={chipClass(false)}>
                {fmtGramsLabel(g)}
              </button>
            ))}
            {presets.map((p) => (
              <button key={p.key} type="button" onClick={() => apply(p.grams)} className={chipClass(false)}>
                {t(`result.items.tare_${p.key}`, { grams: fmtGramsLabel(p.grams) })}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={typed}
              onChange={(e) => {
                setTooHeavy(false);
                setTyped(e.target.value.replace(/[^\d.,]/g, ""));
              }}
              inputMode="numeric"
              placeholder="0"
              aria-label={t("result.items.tareInput")}
              className="h-9 w-24 text-right tabular-nums"
            />
            <span className="text-sm text-muted-foreground">g</span>
            <Button type="submit" size="sm" disabled={!(typedGrams >= 1)}>
              {t("result.items.tareApply")}
            </Button>
            {tare > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => apply(0)}>
                {t("result.items.tareRemove")}
              </Button>
            )}
          </div>
          {tooHeavy && (
            <p role="alert" className="text-xs text-destructive">
              {t("result.items.tareTooHeavy", { grams: fmtGramsLabel(chip.grams) })}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
