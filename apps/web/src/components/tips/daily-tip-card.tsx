import { dailyTip } from "@joyorogo/api/lib/tips";

import { SectionTitle } from "@/components/kit/surface";
import { TipCard } from "@/components/tips/tip-card";

/** "Tips hari ini" di Beranda; tip-nya deterministik per hari Asia/Jakarta. */
export function DailyTipCard() {
  return (
    <section aria-label="Tips hari ini" className="mt-7">
      <SectionTitle>Tips hari ini</SectionTitle>
      <div className="mt-3">
        <TipCard tip={dailyTip()} />
      </div>
    </section>
  );
}
