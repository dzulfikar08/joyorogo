import { dailyTip } from "@joyorogo/api/lib/tips";

import { SectionTitle } from "@/components/ui";
import { TipCard } from "@/components/tips/tip-card";

/** "Tips hari ini" di Beranda; tip-nya deterministik per hari Asia/Jakarta. */
export function DailyTipCard() {
  return (
    <>
      <SectionTitle title="Tips hari ini" />
      <TipCard tip={dailyTip()} />
    </>
  );
}
