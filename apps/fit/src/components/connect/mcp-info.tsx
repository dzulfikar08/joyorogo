import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";

import { GUIDE_URL } from "./connector-card";
import { Bullets } from "./shared";

const READS = [
  "get_profile",
  "get_food_log",
  "get_daily_totals",
  "get_weight_history",
  "list_workouts",
  "get_workout",
  "get_recovery_metrics",
] as const;
const LIMITS = ["l1", "l2", "l3", "l4", "l5"] as const;

/** What the seven tools can read, and what is never shared. */
export function ReadsCard() {
  const { t } = useTranslation("fitWebConnect");
  return (
    <Card>
      <CardHeader title={t("mcp.reads.title")} subtitle={t("mcp.reads.intro")} />
      <Bullets items={READS.map((tool) => t(`mcp.reads.${tool}`))} />
      <p className="mt-3 rounded-2xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        {t("mcp.reads.never")}
      </p>
    </Card>
  );
}

/** Rate limits, Pro, audit retention, and the one honest sentence about API keys. */
export function LimitsCard() {
  const { t } = useTranslation("fitWebConnect");
  return (
    <Card>
      <CardHeader title={t("mcp.limits.title")} />
      <Bullets items={LIMITS.map((key) => t(`mcp.limits.${key}`))} />
      <div className="mt-4 flex gap-3 rounded-2xl bg-muted/60 p-3.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{t("mcp.apiKeys.title")}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {t("mcp.apiKeys.body")}
          </p>
          <a
            href={GUIDE_URL}
            className="mt-1 inline-flex min-h-9 items-center text-sm font-semibold text-primary underline underline-offset-4"
          >
            {t("mcp.apiKeys.link")}
          </a>
        </div>
      </div>
    </Card>
  );
}
