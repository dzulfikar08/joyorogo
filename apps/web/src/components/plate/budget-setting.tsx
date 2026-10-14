import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { parseIdrInput } from "@joyorogo/api/lib/format";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { FieldLabel } from "@/components/kit/surface";
import { IdrInput } from "@/components/plate/idr-input";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

/**
 * Anggaran belanja makan (Profil): a daily or monthly IDR limit. Empty input
 * turns the budget off; the remaining amount shows next to the kcal on Beranda
 * and Makan.
 */
export function BudgetSetting() {
  const spending = useQuery(orpc.plate.spending.queryOptions());
  const [amount, setAmount] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "month" | null>(null);

  // Optimistic spending.budget patch; undo re-applies the previous budget.
  const previousBudget = useRef<{ idr: number; period: "day" | "month" } | null>(null);
  const setBudget = useOptimisticMutation<
    Parameters<AppRouterClient["plate"]["setBudget"]>[0],
    unknown
  >({
    mutationFn: (input) => client.plate.setBudget(input),
    patch: (input, cache) => {
      const key = orpc.plate.spending.queryOptions().queryKey;
      previousBudget.current = spending.data?.budget ?? null;
      cache.value<{ budget: { idr: number; period: "day" | "month" } | null }>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          budget: input.idr !== null ? { idr: input.idr, period: input.period ?? "month" } : null,
        };
      });
    },
    invalidate: () => [orpc.plate.key(), orpc.profile.key()],
    success: () => {
      const prev = previousBudget.current;
      previousBudget.current = null;
      if (!prev) return { message: "Anggaran disimpan" };
      return {
        message: "Anggaran disimpan",
        undo: () => void client.plate.setBudget({ idr: prev.idr, period: prev.period }),
      };
    },
  });

  const current = spending.data?.budget ?? null;
  const value = amount ?? (current ? String(current.idr) : "");
  const save = (idr: number | null) =>
    setBudget.mutate({ idr, period: period ?? current?.period ?? "month" });

  return (
    <div className="rounded-3xl bg-card px-5 py-4">
      <p className="text-[0.9375rem] font-bold">Anggaran belanja makan</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Batas pengeluaran makan. Sisa anggarannya tampil di samping sisa kalori.
      </p>
      <div className="mt-3 flex items-end gap-2">
        <div className="w-36">
          <FieldLabel htmlFor="food-budget">Batas (Rp)</FieldLabel>
          <IdrInput id="food-budget" value={value} onChange={setAmount} placeholder="mis. 50.000" />
        </div>
        <div role="group" aria-label="Periode anggaran" className="flex rounded-full bg-muted p-1">
          {(["day", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={(period ?? current?.period ?? "month") === option}
              onClick={() => setPeriod(option)}
              className={`min-h-9 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none ${
                (period ?? current?.period ?? "month") === option
                  ? "bg-card shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {option === "day" ? "Harian" : "Bulanan"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={setBudget.isPending}
          onClick={() => {
            const parsed = parseIdrInput(value);
            if (parsed === null) {
              toast.error("Isi angka rupiah yang valid, atau kosongkan.");
              return;
            }
            save(parsed);
          }}
        >
          {setBudget.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setBudget.isPending}
            onClick={() => {
              setAmount("");
              save(null);
            }}
          >
            Hapus anggaran
          </Button>
        )}
      </div>
    </div>
  );
}
