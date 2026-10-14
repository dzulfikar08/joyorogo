import { Droplet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";

import { useOptimisticMutation } from "@/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";

type WaterInput = Parameters<AppRouterClient["water"]["add"]>[0];
type WaterToday = Awaited<ReturnType<AppRouterClient["water"]["today"]>>;

/**
 * "Air minum" — one tappable droplet per glass. Tapping a filled droplet
 * pours one back out, tapping an empty one fills one in.
 */
export function WaterCard({ date }: { date?: string }) {
  const todayKey = orpc.water.today.queryOptions({ input: date === undefined ? {} : { date } }).queryKey;
  const today = useQuery(
    orpc.water.today.queryOptions({ input: date === undefined ? {} : { date } }),
  );

  const add = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (input) => client.water.add(input),
    patch: (_input, cache) => {
      cache.value<WaterToday>(todayKey, (old) =>
        old ? { ...old, glasses: Math.min(old.glasses + 1, 99) } : old,
      );
    },
    invalidate: () => [orpc.water.key(), orpc.day.key()],
    success: (_input) => ({
      message: "+1 gelas dicatat",
      undo: () => void client.water.remove(date === undefined ? {} : { date }),
    }),
  });
  const remove = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (input) => client.water.remove(input),
    patch: (_input, cache) => {
      cache.value<WaterToday>(todayKey, (old) =>
        old ? { ...old, glasses: Math.max(old.glasses - 1, 0) } : old,
      );
    },
    invalidate: () => [orpc.water.key(), orpc.day.key()],
    success: (_input) => ({
      message: "1 gelas dihapus",
      undo: () => void client.water.add(date === undefined ? {} : { date }),
    }),
  });

  const glasses = today.data?.glasses ?? 0;
  const goal = today.data?.goal ?? 8;
  const busy = add.isPending || remove.isPending;

  return (
    <section aria-label="Air minum hari ini" className="rounded-2xl bg-muted p-4">
      {today.isPending ? (
        <>
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="mt-3 h-11 w-full rounded-xl" />
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold">Air minum</p>
            <p className="text-sm font-bold tabular-nums" aria-live="polite">
              {glasses}
              <span className="font-semibold text-muted-foreground"> / {goal} gelas</span>
            </p>
          </div>
          <div
            role="group"
            aria-label="Gelas air, ketuk untuk mengisi"
            className="mt-2 grid max-w-72 grid-cols-4 gap-1"
          >
            {Array.from({ length: goal }, (_, i) => i + 1).map((n) => {
              const filled = n <= glasses;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={filled}
                  aria-label={filled ? `Kosongkan gelas ke-${n}` : `Isi gelas ke-${n}`}
                  disabled={busy}
                  onClick={() =>
                    filled
                      ? remove.mutate(date === undefined ? {} : { date })
                      : add.mutate(date === undefined ? {} : { date })
                  }
                  className="flex h-11 items-center justify-center rounded-xl transition-colors hover:bg-card/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
                >
                  <Droplet
                    aria-hidden
                    className={cn("size-6", filled ? "fill-makan text-makan" : "text-makan/30")}
                  />
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Segelas air tiap habis makan bikin kenyang lebih lama.
          </p>
        </>
      )}
    </section>
  );
}
