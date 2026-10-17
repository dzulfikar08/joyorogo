import { Activity, Clock, HeartPulse } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

const CALLBACK_PATH = "/profil/strava/callback";

/**
 * One Strava integration implementation for every screen that needs it: the
 * status query, the three mutations (with toasts + cross-query refresh), and
 * flattened flags. `authorize()` redirects the browser to the OAuth page.
 */
export function useStrava() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const status = useQuery(orpc.strava.status.queryOptions());

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: orpc.strava.key() });
    queryClient.invalidateQueries({ queryKey: orpc.exercise.key() });
    queryClient.invalidateQueries({ queryKey: orpc.day.key() });
  };

  const authorize = useMutation(
    orpc.strava.authorizeUrl.mutationOptions({
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const sync = useMutation(
    orpc.strava.sync.mutationOptions({
      onSuccess: ({ imported, skipped }) => {
        toast.success(t("strava.toast.synced", { count: imported, skipped }));
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const disconnect = useMutation(
    orpc.strava.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success(t("strava.toast.disconnected"));
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    /** Raw status query, e.g. for the skeleton state. */
    status,
    isChecking: status.isPending,
    statusError: status.error?.message ?? null,
    /** Server has Strava credentials at all; without this nobody can connect. */
    configured: status.data?.configured ?? false,
    connected: status.data?.connected ?? false,
    athleteId: status.data?.athleteId ?? null,
    /** Redirects the browser to the Strava OAuth page. */
    authorize: () => authorize.mutate({ redirectUri: `${window.location.origin}${CALLBACK_PATH}` }),
    /** Imports recent Strava activities; toasts the result. */
    sync: () => sync.mutate(),
    /** Disconnects the account; toasts + refreshes exercise/day data. */
    disconnect: () => disconnect.mutate(),
    isAuthorizing: authorize.isPending,
    isSyncing: sync.isPending,
    isDisconnecting: disconnect.isPending,
    /** Retry the status check after a failure. */
    recheck: () => status.refetch(),
  };
}

/** Strava integration as one row-like card: status line + one main action. */
export function StravaCard() {
  const { t } = useTranslation(["settings", "common"]);
  const strava = useStrava();

  let note = t("strava.status.idle");
  let actions: React.ReactNode = null;
  if (strava.isChecking) {
    note = t("strava.status.checkingCard");
  } else if (strava.statusError) {
    note = t("strava.status.error", { error: strava.statusError });
    actions = (
      <Button variant="secondary" size="sm" className="min-h-11" onClick={() => strava.recheck()}>
        {t("common:actions.retry")}
      </Button>
    );
  } else if (!strava.configured) {
    note = t("strava.status.comingSoon");
  } else if (strava.connected) {
    note = strava.athleteId
      ? t("strava.status.connectedAthlete", { id: strava.athleteId })
      : t("strava.status.connected");
    actions = (
      <>
        <Button size="sm" className="min-h-11" onClick={strava.sync} disabled={strava.isSyncing}>
          {strava.isSyncing ? t("strava.action.syncing") : t("strava.action.sync")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 text-muted-foreground hover:text-destructive"
          onClick={strava.disconnect}
          disabled={strava.isDisconnecting}
        >
          {t("strava.action.disconnect")}
        </Button>
      </>
    );
  } else {
    actions = (
      <Button
        size="sm"
        className="min-h-11"
        onClick={strava.authorize}
        disabled={strava.isAuthorizing}
      >
        {strava.isAuthorizing ? t("strava.action.connecting") : t("strava.action.connect")}
      </Button>
    );
  }

  const showRetention = strava.configured && !strava.isChecking && !strava.statusError;

  return (
    <Card aria-label="Strava" className="flex flex-wrap items-center gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar">
        <Activity className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-52">
        <p className="text-[0.9375rem] font-bold">Strava</p>
        <p
          className={
            strava.statusError
              ? "mt-0.5 text-xs text-destructive"
              : "mt-0.5 text-xs text-muted-foreground"
          }
        >
          {note}
        </p>
      </div>
      {strava.isChecking ? (
        <Skeleton className="h-10 w-28 rounded-full" />
      ) : (
        actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
      {showRetention && (
        <div className="basis-full space-y-2 rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("strava.retention.text")}</span>
          </p>
          <p className="flex items-start gap-2">
            <HeartPulse className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("strava.retention.healthAlternative")}</span>
          </p>
        </div>
      )}
    </Card>
  );
}
