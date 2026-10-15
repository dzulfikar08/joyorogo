import { cn } from "@joyorogo/ui/lib/utils";

import { ProgressBar } from "@/components/progress-bar";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";

/**
 * Founder intro-price banner with slot progress. Hidden while the config
 * loads, when the promo is off, and once every slot is taken.
 */
export function FounderPromo({ className }: { className?: string }) {
  const config = useAppConfig();
  const promo = config.data?.promo;
  if (!config.data || !promo || promo.slots - promo.taken <= 0) return null;
  const left = promo.slots - promo.taken;
  const nextPriceIdr = promo.nextPriceIdr ?? null;
  return (
    <aside
      className={cn("rounded-3xl bg-card p-5", className)}
      data-revklik-goal-location="founder-promo"
    >
      <p className="text-sm leading-relaxed">
        <span className="font-bold">
          Harga Founder (terbatas): {fmtRupiah(config.data.founderPriceIdr)}/bulan
        </span>{" "}
        <span className="text-muted-foreground">
          cuma untuk {promo.slots} pembeli pertama, sisa{" "}
          <span className="font-bold tabular-nums text-foreground">{left}</span> slot.
          {nextPriceIdr !== null && <> Setelah itu {fmtRupiah(nextPriceIdr)}.</>}
        </span>
      </p>
      <ProgressBar
        value={promo.taken}
        max={promo.slots}
        ariaLabel={`${left} dari ${promo.slots} slot founder tersisa`}
        className="mt-3 h-1.5"
      />
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Harga terkunci: Founder awal tetap bayar harga ini saat perpanjang.
      </p>
    </aside>
  );
}
