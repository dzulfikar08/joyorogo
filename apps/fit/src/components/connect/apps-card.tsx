import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { fmtStart } from "@/lib/format";
import { orpc } from "@/lib/orpc";

/** The data scopes the connector grants, mapped to their words in the `koneksi` namespace (shared with the JoyoRogo web). */
const SCOPE_LABEL = {
  "profile:read": "scope.profile_read.label",
  "food:read": "scope.food_read.label",
  "weight:read": "scope.weight_read.label",
  "workouts:read": "scope.workouts_read.label",
  "recovery:read": "scope.recovery_read.label",
} as const;

type Target = { clientId: string; name: string };

export function AppsCard() {
  const { t } = useTranslation("fitWebConnect");
  const { t: tk } = useTranslation("koneksi");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.mcpConnection.list.queryOptions());
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const revoke = useMutation(
    orpc.mcpConnection.revoke.mutationOptions({
      onSuccess: (result, variables) => {
        const name = target?.clientId === variables.clientId ? target.name : "";
        setNotice(t(result.revoked ? "mcp.revoke.done" : "mcp.revoke.gone", { name }));
        setTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.mcpConnection.key() });
      },
    }),
  );

  const close = () => {
    if (revoke.isPending) return;
    setTarget(null);
    revoke.reset();
  };

  return (
    <Card>
      <CardHeader title={t("mcp.apps.title")} subtitle={t("mcp.apps.subtitle")} />
      {/* Always mounted so a screen reader hears the result of a disconnect after the row is gone. */}
      <p role="status" aria-live="polite" className="mb-2 text-sm text-recovery empty:hidden">
        {notice}
      </p>
      {list.isPending ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : list.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
          <p className="min-w-0 flex-1 text-destructive">{t("mcp.apps.error")}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("mcp.apps.retry")}
          </Button>
        </div>
      ) : list.data.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl bg-muted/60 px-4 py-8 text-center">
          <span className="mb-3 grid size-11 place-items-center rounded-full bg-card text-muted-foreground">
            <Plug className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-bold">{t("mcp.apps.empty")}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("mcp.apps.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((app) => {
            const scopes = app.scopes.filter(
              (s): s is keyof typeof SCOPE_LABEL => s in SCOPE_LABEL,
            );
            return (
              <li key={app.clientId} className="rounded-2xl bg-muted/60 p-3.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Plug className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-base font-bold break-words">{app.name}</p>
                    {app.redirectHosts.length > 0 && (
                      <p className="text-xs break-all text-muted-foreground">
                        {t("mcp.apps.via", { hosts: app.redirectHosts.join(", ") })}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("mcp.revoke.actionFor", { name: app.name })}
                    onClick={() => {
                      setNotice(null);
                      revoke.reset();
                      setTarget({ clientId: app.clientId, name: app.name });
                    }}
                  >
                    {t("mcp.revoke.action")}
                  </Button>
                </div>
                <ul className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <li className="text-muted-foreground">
                    {t("mcp.apps.connectedAt", {
                      date: fmtStart(Math.floor(app.connectedAt / 1000)),
                    })}
                  </li>
                  <li className="text-muted-foreground">
                    {app.lastUsedAt === null
                      ? t("mcp.apps.neverUsed")
                      : t("mcp.apps.lastUsed", {
                          when: fmtStart(Math.floor(app.lastUsedAt / 1000)),
                        })}
                  </li>
                  <li className="font-semibold tabular-nums">
                    {t("mcp.apps.calls", { count: app.calls30d })}
                  </li>
                </ul>
                {scopes.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-muted-foreground">
                      {t("mcp.apps.allows")}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {scopes.map((scope) => (
                        <li
                          key={scope}
                          className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold ring-1 ring-foreground/10"
                        >
                          {tk(SCOPE_LABEL[scope])}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.data && list.data.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">{t("mcp.apps.viaHint")}</p>
      )}

      <Sheet
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t("mcp.revoke.title", { name: target?.name ?? "" })}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[0.9375rem] leading-relaxed">
            {t("mcp.revoke.body", { name: target?.name ?? "" })}
          </p>
          {revoke.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("mcp.revoke.error")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              disabled={revoke.isPending}
              onClick={() => target && revoke.mutate({ clientId: target.clientId })}
            >
              {revoke.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {revoke.isPending ? t("mcp.revoke.working") : t("mcp.revoke.confirm")}
            </Button>
            <Button variant="ghost" className="w-full" disabled={revoke.isPending} onClick={close}>
              {t("mcp.revoke.cancel")}
            </Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}
