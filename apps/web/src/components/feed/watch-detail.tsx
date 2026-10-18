import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ORPCError } from "@orpc/client";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RouteMapPreview } from "@/components/feed/route-map-preview";
import { Card } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

import { BasicWorkoutView, WorkoutAnalysisView } from "./workout-analysis/workout-analysis-view";

/**
 * Detail latihan JoyoFit: analisis lengkap untuk Pro / penulis, upsell untuk lainnya. `mapLine` (garis rute yang
 * dibagikan, sudah dipotong dan disederhanakan) digambar sebagai peta besar, kecuali analisis sudah punya peta
 * sendiri (rute atau track), supaya tidak ada dua peta.
 */
export function WatchDetail({ postId, mapLine, title }: { postId: string; mapLine?: string; title: string }) {
  const { t } = useTranslation("feed");
  // A signed-out visitor of a public post gets 401 here and sees the sign-in prompt below, not a redirect to /login.
  const detail = useQuery(orpc.social.workoutDetail.queryOptions({ input: { postId }, meta: { allowAnonymous: true } }));
  const sharedMap = mapLine ? (
    <RouteMapPreview line={mapLine} title={title} size="detail" className="mt-4" />
  ) : null;

  if (detail.isPending) return sharedMap;
  // Postingan publik bisa dibuka tanpa sesi; tamu melihat upsell, bukan galat.
  const anonymous = detail.error instanceof ORPCError && detail.error.code === "UNAUTHORIZED";
  if (detail.error && !anonymous) {
    return (
      <>
        {sharedMap}
        <p className="mt-4 text-center text-sm text-muted-foreground">{t("watch.loadFailed")}</p>
      </>
    );
  }

  if (anonymous || detail.data?.locked) {
    return (
      <>
        {sharedMap}
        <Card className="mt-4 p-4 text-center">
          <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-base font-extrabold">{t("watch.lockedTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("watch.lockedBody")}</p>
          <Button className="mt-3" render={<Link to="/harga" />}>
            {t("watch.lockedCta")}
          </Button>
        </Card>
      </>
    );
  }
  const { hr, route, analysis } = detail.data!;
  // Pos dari JoyoFit lama tidak punya analisis: tampilan dasar (grafik HR + peta rute).
  // The analysis (author, or a viewer who gets the track) and the basic view draw their own map; otherwise the
  // shared line stands in for it.
  const ownMap = analysis ? Boolean(analysis.series?.track) : Boolean(route && route.length > 1);
  return (
    <>
      {ownMap ? null : sharedMap}
      {analysis ? <WorkoutAnalysisView analysis={analysis} /> : <BasicWorkoutView hr={hr} route={route} />}
    </>
  );
}
