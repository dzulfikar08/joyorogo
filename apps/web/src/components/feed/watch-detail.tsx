import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ORPCError } from "@orpc/client";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

const CHART_W = 300;
const CHART_H = 80;
const ROUTE_SIZE = 200;
const ROUTE_PAD = 8;

/** Batang detak jantung per interval; sampel null dilewati (celah). */
function HeartRateChart({ intervalSec, bpm }: { intervalSec: number; bpm: (number | null)[] }) {
  const values = bpm.filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, 1);
  const slot = CHART_W / bpm.length;
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="h-24 w-full"
      role="img"
      aria-label={`${lo}–${hi} bpm (${Math.round((bpm.length * intervalSec) / 60)} min)`}
      preserveAspectRatio="none"
    >
      {bpm.map((v, i) => {
        if (v === null) return null;
        const h = 6 + ((v - lo) / span) * (CHART_H - 6);
        return (
          <rect
            // eslint-disable-next-line react/no-array-index-key -- seri waktu, urutan indeks adalah identitasnya
            key={i}
            x={i * slot}
            y={CHART_H - h}
            width={Math.max(slot - 0.5, 0.5)}
            height={h}
            rx={0.5}
            fill="var(--chart-2)"
          />
        );
      })}
    </svg>
  );
}

/** Proyeksi equirectangular (lon dikali cos lintang tengah), tanpa tile peta. */
function RouteMap({ route }: { route: [number, number][] }) {
  if (route.length < 2) return null;
  const lats = route.map(([lat]) => lat);
  const lons = route.map(([, lon]) => lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLon - minLon) * k, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (ROUTE_SIZE - ROUTE_PAD * 2) / Math.max(w, h);
  const offX = (ROUTE_SIZE - w * scale) / 2;
  const offY = (ROUTE_SIZE - h * scale) / 2;
  const points = route.map(([lat, lon]) => [
    offX + (lon - minLon) * k * scale,
    offY + (maxLat - lat) * scale,
  ]);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${ROUTE_SIZE} ${ROUTE_SIZE}`} className="mx-auto aspect-square w-full max-w-64" aria-hidden>
      <polyline
        points={points.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={first[0]} cy={first[1]} r={4} fill="var(--primary)" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--foreground)" />
    </svg>
  );
}

/** Detail latihan JoyoFit: grafik HR + rute untuk Pro / penulis, upsell untuk lainnya. */
export function WatchDetail({ postId }: { postId: string }) {
  const { t } = useTranslation("feed");
  const detail = useQuery(orpc.social.workoutDetail.queryOptions({ input: { postId } }));

  if (detail.isPending) return null;
  // Postingan publik bisa dibuka tanpa sesi; tamu melihat upsell, bukan galat.
  const anonymous = detail.error instanceof ORPCError && detail.error.code === "UNAUTHORIZED";
  if (detail.error && !anonymous) {
    return <p className="mt-4 text-center text-sm text-muted-foreground">{t("watch.loadFailed")}</p>;
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
  const { hr, route } = detail.data!;

  return (
    <div className="mt-4 space-y-4">
      {hr && hr.bpm.some((v) => v !== null) && (
        <Card className="p-4">
          <SectionTitle>{t("watch.hrTitle")}</SectionTitle>
          <div className="mt-2">
            <HeartRateChart intervalSec={hr.intervalSec} bpm={hr.bpm} />
          </div>
        </Card>
      )}
      {route && route.length > 1 && (
        <Card className="p-4">
          <SectionTitle>{t("watch.routeTitle")}</SectionTitle>
          <div className="mt-2">
            <RouteMap route={route} />
          </div>
        </Card>
      )}
    </div>
  );
}
