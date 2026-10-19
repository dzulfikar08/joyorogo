import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { fmtStart } from "@/lib/format";
import { orpc } from "@/lib/orpc";

import { Pill } from "./shared";

const TOOLS = [
  "get_profile",
  "get_food_log",
  "get_daily_totals",
  "get_weight_history",
  "list_workouts",
  "get_workout",
  "get_recovery_metrics",
] as const;
const OUTCOMES = ["ok", "error", "not_pro", "rate_limited", "scope"] as const;
const TONE = {
  ok: "good",
  error: "bad",
  not_pro: "warn",
  rate_limited: "warn",
  scope: "quiet",
} as const;

const isTool = (value: string): value is (typeof TOOLS)[number] =>
  (TOOLS as readonly string[]).includes(value);
const isOutcome = (value: string): value is (typeof OUTCOMES)[number] =>
  (OUTCOMES as readonly string[]).includes(value);

/** The audit log of the connector: the latest tool calls, a table from `xl`, one card per call below. */
export function ActivityCard() {
  const { t } = useTranslation("fitWebConnect");
  const activity = useQuery(orpc.mcpConnection.activity.queryOptions({ input: { limit: 30 } }));

  const toolName = (tool: string) => (isTool(tool) ? t(`mcp.activity.tool.${tool}`) : tool);
  const outcome = (value: string) =>
    isOutcome(value) ? (
      <Pill tone={TONE[value]}>{t(`mcp.activity.outcome.${value}`)}</Pill>
    ) : (
      <Pill tone="quiet">{value}</Pill>
    );

  return (
    <Card>
      <CardHeader
        title={t("mcp.activity.title")}
        subtitle={t("mcp.activity.hint")}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={activity.isFetching}
            onClick={() => void activity.refetch()}
          >
            <RotateCw className={activity.isFetching ? "animate-spin" : undefined} aria-hidden />
            {t("mcp.activity.refresh")}
          </Button>
        }
      />
      {activity.isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : activity.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
          <p className="min-w-0 flex-1 text-destructive">{t("mcp.activity.error")}</p>
          <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
            {t("mcp.activity.retry")}
          </Button>
        </div>
      ) : activity.data.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {t("mcp.activity.empty")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 xl:hidden">
            {activity.data.map((row) => (
              <li key={row.id} className="rounded-2xl bg-muted/60 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <p className="min-w-0 text-sm font-bold break-words">{toolName(row.tool)}</p>
                  {outcome(row.outcome)}
                </div>
                <p className="mt-1 text-xs break-words text-muted-foreground">
                  {[
                    row.clientName ?? t("mcp.activity.unknownApp"),
                    fmtStart(Math.floor(row.createdAt / 1000)),
                  ].join(" · ")}
                </p>
                {row.args && (
                  <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                    {row.args}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("mcp.activity.tableLabel")}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t("mcp.activity.col.tool")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("mcp.activity.col.app")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("mcp.activity.col.time")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("mcp.activity.col.outcome")}
                  </th>
                  <th scope="col" className="py-2 pl-3 font-semibold">
                    {t("mcp.activity.col.args")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activity.data.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="py-2.5 pr-3 font-semibold">{toolName(row.tool)}</td>
                    <td className="px-3 py-2.5 break-words">
                      {row.clientName ?? t("mcp.activity.unknownApp")}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {fmtStart(Math.floor(row.createdAt / 1000))}
                    </td>
                    <td className="px-3 py-2.5">{outcome(row.outcome)}</td>
                    <td className="max-w-[16rem] py-2.5 pl-3 font-mono text-xs break-all text-muted-foreground">
                      {row.args ?? "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
