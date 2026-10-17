import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ORPCError } from "@orpc/client";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

import { BasicWorkoutView, WorkoutAnalysisView } from "./workout-analysis/workout-analysis-view";

/** Detail latihan JoyoFit: analisis lengkap untuk Pro / penulis, upsell untuk lainnya. */
export function WatchDetail({ postId }: { postId: string }) {
  const { t } = useTranslation("feed");
  const detail = useQuery(orpc.social.workoutDetail.queryOptions({ input: { postId } }));

  if (detail.isPending) return null;
  // Postingan publik bisa dibuka tanpa sesi; tamu melihat upsell, bukan galat.
  const anonymous = detail.error instanceof ORPCError && detail.error.code === "UNAUTHORIZED";
  if (detail.error && !anonymous) {
    return (
      <p className="mt-4 text-center text-sm text-muted-foreground">{t("watch.loadFailed")}</p>
    );
  }

  if (anonymous || detail.data?.locked) {
    return (
      <Card className="mt-4 p-4 text-center">
        <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-base font-extrabold">{t("watch.lockedTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("watch.lockedBody")}</p>
        <Button className="mt-3" render={<Link to="/harga" />}>
          {t("watch.lockedCta")}
        </Button>
      </Card>
    );
  }
  const { hr, route, analysis } = detail.data!;
  // Pos dari JoyoFit lama tidak punya analisis: tampilan dasar (grafik HR + peta rute).
  if (analysis) return <WorkoutAnalysisView analysis={analysis} />;
  return <BasicWorkoutView hr={hr} route={route} />;
}
