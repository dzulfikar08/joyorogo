import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { Page } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/profil/coros/callback")({
  component: CorosCallbackPage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});

function CorosCallbackPage() {
  const { t } = useTranslation("coros");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { code, state, error: oauthError } = Route.useSearch();
  const [failed, setFailed] = useState<string | null>(
    oauthError ? t("callback.denied", { error: oauthError }) : null,
  );
  // OAuth callbacks must run exactly once, even under StrictMode remounts.
  const ran = useRef(false);

  const exchange = useMutation(orpc.coros.exchangeCode.mutationOptions());

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (oauthError) return;
    if (!code || !state) {
      setFailed(t("callback.noCode"));
      return;
    }
    exchange.mutate(
      { code, state },
      {
        onSuccess: () => {
          toast.success(t("toast.connected"));
          queryClient.invalidateQueries({ queryKey: orpc.coros.key() });
          navigate({ to: "/profil/coros" });
        },
        onError: (error) => setFailed(error.message),
      },
    );
    // Mutations and search params are stable for this one-shot flow.
  }, [code, state, oauthError, exchange, navigate, queryClient, t]);

  if (failed) {
    return (
      <Page className="max-w-xl">
        <div role="alert" className="rounded-3xl bg-card p-5">
          <span className="flex size-9 items-center justify-center rounded-full bg-destructive/10">
            <CircleAlert className="size-[1.125rem] text-destructive" aria-hidden />
          </span>
          <p className="mt-3 text-[0.9375rem] font-bold">{t("callback.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{failed}</p>
          <Button variant="secondary" size="sm" className="mt-4" render={<Link to="/profil" />}>
            {t("callback.back")}
          </Button>
        </div>
      </Page>
    );
  }

  return (
    <Page className="max-w-xl">
      <div className="flex flex-col items-center py-24 text-center" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="mt-4 text-sm font-semibold text-muted-foreground">
          {t("callback.connecting")}
        </p>
      </div>
    </Page>
  );
}
