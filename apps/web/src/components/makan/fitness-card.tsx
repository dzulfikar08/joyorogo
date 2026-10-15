import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  FOOD_GUIDANCE_TEASER,
  READINESS_ID,
  fitnessHints,
  hasFitnessData,
} from "@joyorogo/api/lib/fitness-hint";
import type { FoodPick, ReadinessGuidance } from "@joyorogo/api/lib/readiness-food";
import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { Card } from "@/components/kit/surface";
import { useAppConfig } from "@/lib/app-config";
import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xl leading-tight font-extrabold tabular-nums">{value ?? "-"}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** "Sisa" figures that matter for the day's focus; a steady day shows none. */
function remaining(guidance: ReadinessGuidance): Array<{ label: string; value: string }> {
  const { numbers, focus } = guidance;
  if (!numbers || focus === "steady") return [];
  const rows = [{ label: "Sisa kkal", value: fmtInt(numbers.roomKcal) }];
  if (focus !== "fuel") rows.push({ label: "Sisa protein", value: `${fmtInt(numbers.protein.remainingG)} g` });
  if (focus !== "recover") rows.push({ label: "Sisa karbo", value: `${fmtInt(numbers.carbs.remainingG)} g` });
  return rows;
}

function pickDetail(pick: FoodPick): string {
  const parts = [`${fmtInt(pick.kcal)} kkal`];
  if (pick.proteinG !== null) parts.push(`P ${fmtInt(pick.proteinG)} g`);
  if (pick.carbsG !== null) parts.push(`K ${fmtInt(pick.carbsG)} g`);
  parts.push(pick.source === "riwayat" ? `${pick.days}x di catatanmu` : "dari database JoyoRogo");
  return parts.join(" · ");
}

function Guidance({ guidance }: { guidance: ReadinessGuidance }) {
  const stats = remaining(guidance);
  return (
    <div className="space-y-2.5 border-t border-border pt-3">
      <p className="text-sm font-semibold">{guidance.headline}</p>
      {guidance.lines.map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
      {stats.length > 0 ? (
        <div className="flex gap-3">
          {stats.map((stat) => (
            <Metric key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      ) : null}
      {guidance.foods.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Pilihan untuk hari ini</p>
          <ul className="mt-1 space-y-1.5">
            {guidance.foods.map((pick) => (
              <li key={pick.name}>
                <p className="text-sm font-medium">
                  {pick.name}
                  {pick.portion ? ` (${pick.portion})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">{pickDetail(pick)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {guidance.basis ? <p className="text-xs text-muted-foreground">{guidance.basis}</p> : null}
    </div>
  );
}

function Teaser() {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Lock className="size-3.5 text-muted-foreground" aria-hidden />
        {FOOD_GUIDANCE_TEASER.title}
      </p>
      <p className="text-sm text-muted-foreground">{FOOD_GUIDANCE_TEASER.body}</p>
      <Button
        size="sm"
        render={<Link to="/pro" search={{ from: "fitness", next: "/makan" }} />}
      >
        {FOOD_GUIDANCE_TEASER.action}
      </Button>
    </div>
  );
}

/**
 * Recovery, strain and sleep of the day from JoyoFit (the Huawei watch app).
 * Everyone gets the short qualitative hints; Founder gets personalised food
 * guidance for today (server-checked), free users a locked teaser when the
 * server can actually sell Founder. Renders nothing for a day JoyoFit pushed
 * no scores for, and nothing while loading or when the request fails.
 */
export function FitnessCard({ date }: { date: string }) {
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  const config = useAppConfig();
  const hasScores = hasFitnessData(data);
  // Guidance is about what is left to eat today; a past day only has the hints.
  const guidance = useQuery({
    ...orpc.day.readinessGuidance.queryOptions(),
    enabled: hasScores && date === jakartaToday(),
  });
  if (!hasFitnessData(data)) return null;

  const ready = guidance.data?.status === "ready" ? guidance.data.guidance : null;
  const showTeaser = guidance.data?.status === "locked" && config.data?.billing === true;
  const hints = ready ? [] : fitnessHints(data);

  return (
    <Card className="mt-3 space-y-3" aria-label="Skor kebugaran dari JoyoFit">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">Kebugaran dari JoyoFit</p>
        {data.readiness ? (
          <p className="text-sm font-bold text-tidur-ink">{READINESS_ID[data.readiness]}</p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Metric label="Pemulihan" value={data.recoveryPct === null ? null : `${data.recoveryPct}%`} />
        <Metric label="Strain" value={data.strain === null ? null : `${data.strain.toFixed(1)} / 21`} />
        <Metric label="Tidur" value={data.sleepPct === null ? null : `${data.sleepPct}%`} />
      </div>
      {hints.map((hint) => (
        <p key={hint} className="text-sm">
          {hint}
        </p>
      ))}
      {ready ? <Guidance guidance={ready} /> : null}
      {showTeaser ? <Teaser /> : null}
    </Card>
  );
}
