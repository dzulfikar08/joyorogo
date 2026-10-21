import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { cn } from "@joyorogo/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { toPayload } from "@/components/scan/correct-box";
import type { CorrectScanResult } from "@/components/scan/correct-box";
import type { AiFoodItem } from "@/lib/api-types";
import { client } from "@/utils/orpc";

const chipClass = (busy: boolean) =>
  cn(
    "pressable inline-flex min-h-8 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold whitespace-nowrap text-foreground transition-colors duration-150 hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
    busy && "animate-pulse",
  );

/**
 * "Maksudnya ini?": foods this user taught the scan by correcting it. One tap
 * runs the same ai.correctScan path as the Koreksi box with
 * `bukan <top answer>, <chip>`; the screen applies the patch (with undo).
 */
export function MemoryChips({
  names,
  photoId,
  items,
  kcals,
  kinds,
  onApply,
}: {
  names: string[];
  photoId: string | null;
  items: AiFoodItem[];
  kcals: Record<number, string>;
  kinds: Record<number, FoodKind>;
  onApply: (result: CorrectScanResult, base: AiFoodItem[]) => boolean;
}) {
  const { t } = useTranslation("scan");
  const [busy, setBusy] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  useEffect(() => () => abortRef.current?.abort(), []);

  const first = items[0];
  if (!first || names.length === 0) return null;

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
          text: `bukan ${first.name}, ${name}`,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      onApplyRef.current(result, items);
    } catch {
      // The chip stays; the typed Koreksi box reports errors.
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <section
      aria-label={t("result.memory.group")}
      className="mt-3 flex flex-wrap items-center gap-1.5"
    >
      <p className="text-xs font-semibold text-muted-foreground">{t("result.memory.title")}</p>
      <div role="group" aria-label={t("result.memory.group")} className="contents">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            disabled={busy !== null}
            onClick={() => void pick(name)}
            className={chipClass(busy === name)}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
    </section>
  );
}
