import { dayOfMs } from "@joyorogo/i18n";
import { isMcpDataScope } from "@joyorogo/api/lib/mcp-scopes";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, ListGroup, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ErrorNote } from "@/components/kit/error-note";
import { EmptyHint } from "@/components/screen-state";
import { fmtDateMedium, timeAgo } from "@/lib/format";
import { scopeKey } from "@/lib/mcp-scope-key";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/koneksi")({
  component: KoneksiPage,
});

const OUTCOME_TONE: Record<string, string> = {
  ok: "bg-makan-soft text-makan-ink",
  error: "bg-destructive/10 text-destructive",
  not_pro: "bg-bakar-soft text-bakar-ink",
  rate_limited: "bg-bakar-soft text-bakar-ink",
  scope: "bg-muted text-muted-foreground",
};

function KoneksiPage() {
  const { t } = useTranslation("koneksi");
  const queryClient = useQueryClient();
  const info = useQuery(orpc.mcpConnection.info.queryOptions());
  const list = useQuery(orpc.mcpConnection.list.queryOptions());
  const activity = useQuery(orpc.mcpConnection.activity.queryOptions({ input: { limit: 30 } }));
  const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState<{ clientId: string; name: string } | null>(null);

  const revoke = useMutation(
    orpc.mcpConnection.revoke.mutationOptions({
      onSuccess: () => {
        setTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.mcpConnection.key() });
      },
    }),
  );

  const copy = async () => {
    if (!info.data) return;
    try {
      await navigator.clipboard.writeText(info.data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address stays visible and selectable.
    }
  };

  return (
    <Page className="max-w-xl">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {info.data && !info.data.unlocked && (
        <div className="mb-4 rounded-3xl bg-bakar-soft p-5 text-bakar-ink">
          <p className="text-sm leading-relaxed">{t("pro.required")}</p>
          <Link to="/harga" className="mt-2 inline-block text-sm font-semibold underline underline-offset-4">
            {t("pro.cta")}
          </Link>
        </div>
      )}

      <Card>
        <h2 className="text-base font-bold tracking-tight">{t("connector.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("connector.hint")}</p>
        {info.isPending ? (
          <Skeleton className="mt-3 h-12 w-full rounded-2xl" />
        ) : info.data ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-muted p-1.5 pl-4">
            <code className="min-w-0 flex-1 truncate text-sm select-all">{info.data.url}</code>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              <span aria-live="polite">{copied ? t("connector.copied") : t("connector.copy")}</span>
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <ErrorNote message={t("list.error")} onRetry={() => void info.refetch()} />
          </div>
        )}
        <Link
          to="/panduan/ai"
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80"
        >
          <BookOpen className="size-4 shrink-0" aria-hidden />
          {t("connector.guide")}
        </Link>
      </Card>

      <SectionTitle className="mt-7">{t("list.title")}</SectionTitle>
      {list.isPending ? (
        <Skeleton className="h-40 w-full rounded-3xl" />
      ) : list.isError ? (
        <ErrorNote message={t("list.error")} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyHint title={t("list.empty")}>{t("list.emptyHint")}</EmptyHint>
      ) : (
        <ul className="space-y-3">
          {list.data.map((app) => {
            const scopes = app.scopes.filter(isMcpDataScope);
            return (
              <li key={app.clientId}>
                <Card>
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10">
                      <Plug className="size-5 text-primary" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold break-words">{app.name}</p>
                      {app.redirectHosts.length > 0 && (
                        <p className="text-xs break-all text-muted-foreground">
                          {t("list.via", { hosts: app.redirectHosts.join(", ") })}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setTarget({ clientId: app.clientId, name: app.name })}
                    >
                      {t("revoke.action")}
                    </Button>
                  </div>
                  <ul className="mt-3 space-y-0.5 text-sm text-muted-foreground">
                    <li>{t("list.connectedAt", { date: fmtDateMedium(dayOfMs(app.connectedAt)) })}</li>
                    <li>
                      {app.lastUsedAt === null
                        ? t("list.neverUsed")
                        : t("list.lastUsed", { when: timeAgo(new Date(app.lastUsedAt)) })}
                    </li>
                    <li>{t("list.calls", { count: app.calls30d })}</li>
                  </ul>
                  {scopes.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                        {t("list.allows")}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {scopes.map((scope) => (
                          <li
                            key={scope}
                            className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold"
                          >
                            {t(`scope.${scopeKey(scope)}.label`)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <SectionTitle className="mt-7">{t("activity.title")}</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-sm text-muted-foreground">{t("activity.hint")}</p>
      {activity.isPending ? (
        <Skeleton className="h-32 w-full rounded-3xl" />
      ) : activity.isError ? (
        <ErrorNote message={t("list.error")} onRetry={() => void activity.refetch()} />
      ) : activity.data.length === 0 ? (
        <EmptyHint title={t("activity.empty")} />
      ) : (
        <ListGroup>
          {activity.data.map((row) => (
            <li key={row.id} className="relative flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t(`activity.tool.${row.tool}`, { defaultValue: row.tool })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[row.clientName, timeAgo(new Date(row.createdAt))].filter(Boolean).join(" · ")}
                </p>
                {row.args && (
                  <p className="mt-0.5 text-xs break-all text-muted-foreground">{row.args}</p>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                  OUTCOME_TONE[row.outcome] ?? "bg-muted text-muted-foreground",
                )}
              >
                {t(`activity.outcome.${row.outcome}`, { defaultValue: row.outcome })}
              </span>
            </li>
          ))}
        </ListGroup>
      )}

      <Sheet
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) {
            setTarget(null);
            revoke.reset();
          }
        }}
        title={t("revoke.title", { name: target?.name ?? "" })}
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">
            {t("revoke.body", { name: target?.name ?? "" })}
          </p>
          {revoke.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("revoke.error")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              disabled={revoke.isPending}
              onClick={() => target && revoke.mutate({ clientId: target.clientId })}
            >
              {t("revoke.confirm")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={revoke.isPending}
              onClick={() => {
                setTarget(null);
                revoke.reset();
              }}
            >
              {t("revoke.cancel")}
            </Button>
          </div>
        </div>
      </Sheet>
    </Page>
  );
}
