import { Activity } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
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
        toast.success(`Strava: ${imported} aktivitas diimpor, ${skipped} dilewati.`);
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const disconnect = useMutation(
    orpc.strava.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success("Strava diputuskan.");
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
  const strava = useStrava();

  let note = "Aktivitas Strava otomatis masuk ke Burn.";
  let actions: React.ReactNode = null;
  if (strava.isChecking) {
    note = "Memeriksa status Strava...";
  } else if (strava.statusError) {
    note = `Gagal memeriksa status: ${strava.statusError}`;
    actions = (
      <Button variant="secondary" size="sm" className="min-h-11" onClick={() => strava.recheck()}>
        Coba lagi
      </Button>
    );
  } else if (!strava.configured) {
    note = "Strava belum dikonfigurasi di server, sambungan menyusul setelah kredensial disetel.";
  } else if (strava.connected) {
    note = `Terhubung${strava.athleteId ? ` (ID atlet ${strava.athleteId})` : ""}.`;
    actions = (
      <>
        <Button size="sm" className="min-h-11" onClick={strava.sync} disabled={strava.isSyncing}>
          {strava.isSyncing ? "Menyinkronkan..." : "Sinkron"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 text-muted-foreground hover:text-destructive"
          onClick={strava.disconnect}
          disabled={strava.isDisconnecting}
        >
          Putuskan
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
        {strava.isAuthorizing ? "Membuka Strava..." : "Sambungkan"}
      </Button>
    );
  }

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
    </Card>
  );
}
