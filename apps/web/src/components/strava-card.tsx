import { ChevronDown, Clock, HeartPulse, Unplug, UsersRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BrandMark } from "@/components/kit/brand-mark";
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
      onError: (error) => {
        toast.error(error.message);
        // A refused authorize (no Strava slot left) changes what the card should show.
        queryClient.invalidateQueries({ queryKey: orpc.strava.key() });
      },
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
    /** Not connected and no Strava slot this user may take (docs/strava.md "Capacity"). */
    slotsFull: status.data?.slotsFull ?? false,
    slotsReason: status.data?.slotsReason ?? null,
    /** JoyoRogo released this user's idle Strava slot for paying users. */
    released: Boolean(status.data?.released),
    /** Redirects the browser to the Strava OAuth page. */
    authorize: () =>
      authorize.mutate({
        redirectUri: `${window.location.origin}${CALLBACK_PATH}`,
      }),
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

/**
 * Official "Connect with Strava" button (developers.strava.com/guidelines):
 * the SVG is used unmodified at its native 48px height and starts the
 * strava.com/oauth/authorize flow through `useStrava().authorize`.
 */
export function ConnectWithStravaButton({
  onClick,
  busy = false,
}: {
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy}
      className={`inline-block rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none ${busy ? "pointer-events-none" : ""}`}
    >
      <img
        src="/brand/connect-with-strava.svg"
        alt="Connect with Strava"
        width={237}
        height={48}
        className="block h-12 w-auto"
      />
    </button>
  );
}

/**
 * Official "Powered by Strava" logo, unmodified, shown where Strava data is
 * displayed. Kept small and apart from the JoyoRogo brand.
 */
export function PoweredByStrava({ className }: { className?: string }) {
  return (
    <img
      src="/brand/powered-by-strava.svg"
      alt="Powered by Strava"
      width={365}
      height={37}
      className={className ?? "mx-auto block h-5 w-auto"}
    />
  );
}

/** Strava's 7-day retention rule and the Health Connect / Apple Health alternative. */
export function StravaRetentionNotes() {
  const { t } = useTranslation("settings");
  return (
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
  );
}

/**
 * Why the user cannot connect (no slot left, or only the Pro reserve) and/or that JoyoRogo released their idle Strava
 * slot, with the alternatives: Health Connect / Apple Health or adding workouts by hand.
 */
export function StravaSlotsNotice({ slotsFull, slotsReason, released }: { slotsFull: boolean; slotsReason: string | null; released: boolean }) {
  const { t } = useTranslation("settings");
  if (!slotsFull && !released) return null;
  return (
    <div role="status" className="basis-full space-y-2 rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      {released && (
        <p className="flex items-start gap-2">
          <Unplug className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-bold text-foreground">{t("strava.slots.releasedTitle")}. </span>
            {t("strava.slots.released")}
          </span>
        </p>
      )}
      {slotsFull && (
        <p className="flex items-start gap-2">
          <UsersRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-bold text-foreground">{t("strava.slots.fullTitle")}. </span>
            {slotsReason === "full" ? t("strava.slots.full") : t("strava.slots.reserved")}
          </span>
        </p>
      )}
    </div>
  );
}

/** Strava integration as one row-like card: status line + one main action. */
export function StravaCard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation(["settings", "common", "olahraga"]);
  const strava = useStrava();

  let note = t("strava.status.idle");
  let actions: React.ReactNode = null;
  if (strava.isChecking) {
    note = t("strava.status.checkingCard");
  } else if (strava.statusError) {
    note = t("strava.status.error", { error: strava.statusError });
    actions = (
      <Button
        variant="secondary"
        size="sm"
        className="min-h-11"
        onClick={() => strava.recheck()}
      >
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
        <Button
          size="sm"
          className="min-h-11"
          onClick={strava.sync}
          disabled={strava.isSyncing}
        >
          {strava.isSyncing
            ? t("strava.action.syncing")
            : t("strava.action.sync")}
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
  } else if (strava.slotsFull) {
    note = t("strava.slots.fullTitle");
  } else {
    actions = <ConnectWithStravaButton onClick={strava.authorize} busy={strava.isAuthorizing} />;
  }

  const showRetention =
    strava.configured && !strava.isChecking && !strava.statusError;
  const notes = <StravaRetentionNotes />;

  return (
    <Card aria-label="Strava" className="flex flex-wrap items-center gap-4">
      <BrandMark brand="strava" />
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
        actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )
      )}
      {showRetention && !strava.connected && (
        <StravaSlotsNotice slotsFull={strava.slotsFull} slotsReason={strava.slotsReason} released={strava.released} />
      )}
      {showRetention &&
        (compact ? (
          <details className="group basis-full">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
              {t("olahraga:strava.notesTitle")}
              <ChevronDown
                className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            {notes}
          </details>
        ) : (
          notes
        ))}
    </Card>
  );
}
