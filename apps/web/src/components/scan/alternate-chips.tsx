import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { carryAlternates } from "@joyorogo/api/lib/name-alternates";
import { cn } from "@joyorogo/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { toPayload } from "@/components/scan/correct-box";
import type { CorrectScanResult } from "@/components/scan/correct-box";
import type { AiFoodItem } from "@/lib/api-types";
import { client } from "@/utils/orpc";

/**
 * "Mungkin juga:" under a scan row the model was unsure about (`item.alt`): one tap renames the row to that
 * dish. It is the Koreksi box's own path (ai.correctScan with `bukan <name>, <dish>`), so the new dish gets
 * its grams, kcal and macros the way a typed rename does; the screen applies the patch (with undo). `altTap`
 * only tells the ledger the text came from a chip.
 */
export function AlternateChips({
  index,
  photoId,
  items,
  kcals,
  kinds,
  disabled,
  onApply,
}: {
  index: number;
  photoId: string | null;
  items: AiFoodItem[];
  kcals: Record<number, string>;
  kinds: Record<number, FoodKind>;
  disabled: boolean;
  onApply: (result: CorrectScanResult, base: AiFoodItem[]) => boolean;
}) {
  const { t } = useTranslation("scan");
  const [busy, setBusy] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const item = items[index];
  const names = item?.alt ?? [];
  if (!item || names.length === 0) return null;

  const pick = async (name: string) => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(name);
    try {
      const result = await client.ai.correctScan(
        {
          ...(photoId ? { photoId } : {}),
          items: toPayload(items, kcals, kinds),
          text: `bukan ${item.name}, ${name}`,
          altTap: { from: item.name, to: name },
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      onApply(carryAlternates(result, items, { index, name }), items);
    } catch {
      // The chips stay; the typed Koreksi box reports errors.
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <span
      role="group"
      aria-label={t("result.items.altGroup", { name: item.name })}
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="text-xs font-semibold text-muted-foreground">
        {t("result.items.altTitle")}
      </span>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => void pick(name)}
          className={cn(
            "pressable inline-flex min-h-8 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold whitespace-nowrap text-foreground transition-colors duration-150 hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
            busy === name && "animate-pulse",
          )}
        >
          {name.charAt(0).toUpperCase() + name.slice(1)}
        </button>
      ))}
    </span>
  );
}
