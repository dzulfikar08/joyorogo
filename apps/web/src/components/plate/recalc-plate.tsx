import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { fmtGramsLabel, fmtInt, fmtKcalLabel } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

/**
 * "Hitung ulang kalori" for one plate. The server previews which AI rows would
 * change (food.recalculatePlate without `apply`); the button only shows when
 * there is at least one, and "Simpan" in the dialog writes exactly that preview.
 */
export function RecalcPlateAction({ plateId }: { plateId: string }) {
  const { t } = useTranslation(["makan", "common"]);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const preview = useQuery(orpc.food.recalculatePlate.queryOptions({ input: { plateId } }));
  const apply = useMutation({
    mutationFn: () => client.food.recalculatePlate({ plateId, apply: true }),
    onSuccess: () => {
      setOpen(false);
      toast.success(t("plate.recalc.done"));
    },
    onError: () => toast.error(t("plate.recalc.error")),
    onSettled: () => {
      for (const key of [orpc.food.key(), orpc.plate.key(), orpc.day.key()]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  const data = preview.data;
  if (!data || data.items.length === 0) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Calculator aria-hidden />
        {t("plate.recalc.action")}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("plate.recalc.title")}
        description={t("plate.recalc.description")}
      >
        <ul className="divide-y divide-border">
          {data.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                {item.grams !== null && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {fmtGramsLabel(item.grams)}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {t("plate.recalc.change", {
                  from: fmtInt(item.before.kcal),
                  to: fmtInt(item.after.kcal),
                })}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 text-sm font-bold">
          <span>{t("plate.recalc.total")}</span>
          <span className="tabular-nums">
            {fmtKcalLabel(data.totals.before)} → {fmtKcalLabel(data.totals.after)}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? t("plate.recalc.saving") : t("common:actions.save")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
