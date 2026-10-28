import type { SizeOptions } from "@joyorogo/api/lib/ask-grams";
import { MAX_GRAMS } from "@joyorogo/api/lib/portion";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Scale } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { fmtGramsLabel } from "@/lib/format";

const SIZE_KEYS = ["askGramsSmall", "askGramsMedium", "askGramsLarge"] as const;

/**
 * Under a scan row whose only weight is the model's bowl / plate default (lib/ask-grams.ts): "Berapa gram? Timbang
 * biar akurat". For people without a scale, `sizes` (when the library knows the dish) are three one-tap chips,
 * "Kecil · 175 g" / "Sedang" / "Besar", the dish's typical serving x 0.5 / 1 / 1.5. The prompt opens a small grams box
 * with the focus in it; "Pakai" (or Enter) and a chip hand the weight to `onApply` (itemAtTypedGrams: kcal and macros
 * follow, the row is stamped `typed` or `size`), Escape closes the box and gives the focus back to the prompt.
 */
export function AskGrams({
  name,
  sizes,
  onApply,
}: {
  name: string;
  sizes?: SizeOptions;
  onApply: (grams: number, source: "typed" | "size") => void;
}) {
  const { t } = useTranslation("scan");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const grams = Number(typed.replace(",", "."));
  const usable = Number.isFinite(grams) && grams >= 1;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (usable) onApply(Math.min(MAX_GRAMS, Math.round(grams)), "typed");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  return (
    <div className="space-y-2">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-foreground/40 px-3 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <Scale className="size-3.5" aria-hidden />
        {t("result.items.askGrams")}
      </button>
      {sizes && (
        <span
          role="group"
          aria-label={t("result.items.askGramsSizes", { name })}
          className="flex flex-wrap gap-1.5"
        >
          {sizes.map((g, i) => (
            <button
              key={SIZE_KEYS[i]}
              type="button"
              onClick={() => onApply(g, "size")}
              className="pressable inline-flex min-h-9 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold whitespace-nowrap text-foreground transition-colors duration-150 hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {t(`result.items.${SIZE_KEYS[i]!}`, { grams: fmtGramsLabel(g) })}
            </button>
          ))}
        </span>
      )}
      {open && (
        <form
          id={panelId}
          onSubmit={submit}
          onKeyDown={onKeyDown}
          className="flex items-center gap-2"
        >
          <Input
            ref={input}
            aria-label={t("result.items.askGramsInput", { name })}
            type="number"
            min="1"
            max={MAX_GRAMS}
            inputMode="numeric"
            placeholder="0"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="h-10 w-24 text-right font-bold tabular-nums"
          />
          <span className="text-xs font-semibold text-muted-foreground">g</span>
          <Button type="submit" size="sm" disabled={!usable}>
            {t("result.items.askGramsApply")}
          </Button>
        </form>
      )}
    </div>
  );
}
