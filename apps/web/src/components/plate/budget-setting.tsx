import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { FieldLabel } from "@/components/kit/surface";
import { parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/**
 * Anggaran belanja makan (Profil): a daily or monthly IDR limit. Empty input
 * turns the budget off; the remaining amount shows next to the kcal on Beranda
 * and Makan.
 */
export function BudgetSetting() {
  const queryClient = useQueryClient();
  const spending = useQuery(orpc.plate.spending.queryOptions());
  const [amount, setAmount] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "month" | null>(null);

  const setBudget = useMutation(
    orpc.plate.setBudget.mutationOptions({
      onSuccess: () => {
        toast.success("Anggaran disimpan.");
        queryClient.invalidateQueries({ queryKey: orpc.plate.key() });
        queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

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
          <Input
            id="food-budget"
            type="number"
            min="0"
            inputMode="numeric"
            value={value}
            placeholder="mis. 50000"
            onChange={(event) => setAmount(event.target.value)}
          />
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
            const parsed = parseNum(value);
            if (parsed === null || parsed < 0) {
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
