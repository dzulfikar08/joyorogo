import { createFileRoute } from "@tanstack/react-router";

import { PlanScreen } from "@/components/meal-plan/plan-screen";
import type { PlanTab } from "@/components/meal-plan/plan-screen";

type PlanSearch = { tab?: PlanTab; date?: string };

/** "Rencana makan": the Pro meal planner. `?tab=` picks Hari ini / Minggu / Belanja, `?date=` the day shown in Hari ini. */
export const Route = createFileRoute("/_auth/rencana-makan")({
  validateSearch: (search: Record<string, unknown>): PlanSearch => ({
    tab: search.tab === "week" || search.tab === "shopping" ? search.tab : undefined,
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
  }),
  component: RencanaMakanPage,
});

function RencanaMakanPage() {
  const { tab, date } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PlanScreen
      tab={tab ?? "today"}
      date={date}
      onShow={(next) =>
        navigate({
          search: (prev) => ({
            tab: next.tab === undefined ? prev.tab : next.tab === "today" ? undefined : next.tab,
            date: next.date ?? prev.date,
          }),
          replace: true,
        })
      }
    />
  );
}
