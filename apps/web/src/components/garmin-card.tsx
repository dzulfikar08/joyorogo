import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Link2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

export const GARMIN_KEY_URL = "https://connect.garmin.com/app/settings/personalApiToken";

/**
 * One Garmin integration implementation for every screen that needs it: the
 * status query, the mutations (with toasts + cross-query refresh) and
 * flattened flags. `connect(apiKey)` sends the user's Personal API key. When
 * the user is connected and the last sync is missing or older than an hour,
 * `autoSync` syncs once per mount.
 */
export function useGarmin({ autoSync = false }: { autoSync?: boolean } = {}) {
  const { t } = useTranslation("garmin");
  const queryClient = useQueryClient();
  const status = useQuery(orpc.garmin.status.queryOptions());

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: orpc.garmin.key() });
    queryClient.invalidateQueries({ queryKey: orpc.exercise.key() });
    queryClient.invalidateQueries({ queryKey: orpc.day.key() });
    queryClient.invalidateQueries({ queryKey: orpc.weight.key() });
    queryClient.invalidateQueries({ queryKey: orpc.activity.key() });
  };

  const connect = useMutation(
    orpc.garmin.connect.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.connected"));
        refreshData();
      },
    }),
  );

  const sync = useMutation(
    orpc.garmin.sync.mutationOptions({
      onSuccess: ({ imported, weights, days }) => {
        toast.success(t("toast.synced", { count: imported, weights, days }));
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const disconnect = useMutation(
    orpc.garmin.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.disconnected"));
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const connected = status.data?.connected ?? false;
  const lastSyncAt = status.data?.lastSyncAt ?? null;

  // Once per mount; a failed attempt is not retried until the next mount.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!autoSync || autoSynced.current || !status.data) return;
    if (!connected) return;
    const stale = !lastSyncAt || Date.now() - new Date(lastSyncAt).getTime() > AUTO_SYNC_AFTER_MS;
    if (!stale) return;
    autoSynced.current = true;
    sync.mutate();
    // `sync` is a stable mutation handle for this one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, status.data, connected, lastSyncAt]);

  return {
    status,
    isChecking: status.isPending,
    statusError: status.error?.message ?? null,
    /** User is on the Garmin allowlist; otherwise every Garmin surface is hidden. */
    configured: status.data?.configured ?? false,
    connected,
    lastSyncAt,
    lastSyncFailed: status.data?.lastSyncFailed ?? false,
    importedCount: status.data?.importedCount ?? 0,
    /** Verifies and stores the Personal API key; resolves on success so the caller can clear its field. */
    connect: (apiKey: string) => connect.mutateAsync({ apiKey: apiKey.trim() }),
    /** The server's message when the last connect attempt failed. */
    connectError: connect.error?.message ?? null,
    /** Imports recent Garmin data; toasts the result. */
    sync: () => sync.mutate(),
    /** Disconnects the account; toasts + refreshes exercise/day data. */
    disconnect: () => disconnect.mutate(),
    isConnecting: connect.isPending,
    isSyncing: sync.isPending,
    isDisconnecting: disconnect.isPending,
    /** Retry the status check after a failure. */
    recheck: () => status.refetch(),
  };
}

/** The connected status line: last sync time (or "never"), imported count, last failure. */
export function useGarminConnectedNote(garmin: {
  lastSyncAt: Date | null;
  importedCount: number;
  lastSyncFailed: boolean;
}) {
  const { t, i18n } = useTranslation("garmin");
  const when = garmin.lastSyncAt
    ? new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(garmin.lastSyncAt))
    : t("status.neverSynced");
  return [
    t("status.connectedSynced", { when }),
    garmin.importedCount > 0 ? t("status.imported", { count: garmin.importedCount }) : null,
    garmin.lastSyncFailed ? t("status.lastFailed") : null,
  ]
    .filter(Boolean)
    .join(". ");
}

/** What Garmin reads and how duplicates are handled. */
export function GarminNotes() {
  const { t } = useTranslation("garmin");
  return (
    <div className="basis-full space-y-2 rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      <p className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("notes.text")}</span>
      </p>
      <p className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("notes.dedupe")}</span>
      </p>
    </div>
  );
}
