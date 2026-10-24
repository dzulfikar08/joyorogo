import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Link2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/**
 * One COROS integration implementation for every screen that needs it: the
 * status query, the mutations (with toasts + cross-query refresh) and
 * flattened flags. `authorize()` redirects the browser to COROS's authorize
 * page; PKCE and state live on the server. When the user is connected and the
 * last sync is missing or older than an hour, `autoSync` syncs once per mount.
 */
export function useCoros({ autoSync = false }: { autoSync?: boolean } = {}) {
  const { t } = useTranslation("coros");
  const queryClient = useQueryClient();
  const status = useQuery(orpc.coros.status.queryOptions());

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: orpc.coros.key() });
    queryClient.invalidateQueries({ queryKey: orpc.exercise.key() });
    queryClient.invalidateQueries({ queryKey: orpc.day.key() });
  };

  const authorize = useMutation(
    orpc.coros.authorizeUrl.mutationOptions({
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const sync = useMutation(
    orpc.coros.sync.mutationOptions({
      onSuccess: ({ imported, skipped }) => {
        toast.success(t("toast.synced", { count: imported, skipped }));
        refreshData();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const disconnect = useMutation(
    orpc.coros.disconnect.mutationOptions({
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
    /** Server has COROS credentials at all; without this nobody can connect. */
    configured: status.data?.configured ?? false,
    connected,
    lastSyncAt,
    lastSyncFailed: status.data?.lastSyncFailed ?? false,
    importedCount: status.data?.importedCount ?? 0,
    /** Redirects the browser to the COROS authorize page. */
    authorize: () => authorize.mutate({ returnTo: "web" }),
    /** Imports recent COROS workouts; toasts the result. */
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

/** The connected status line: last sync time (or "never"), imported count, last failure. */
export function useCorosConnectedNote(coros: {
  lastSyncAt: Date | null;
  importedCount: number;
  lastSyncFailed: boolean;
}) {
  const { t, i18n } = useTranslation("coros");
  const when = coros.lastSyncAt
    ? new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(coros.lastSyncAt))
    : t("status.neverSynced");
  return [
    t("status.connectedSynced", { when }),
    coros.importedCount > 0 ? t("status.imported", { count: coros.importedCount }) : null,
    coros.lastSyncFailed ? t("status.lastFailed") : null,
  ]
    .filter(Boolean)
    .join(". ");
}

/** What COROS reads and how duplicates are handled. */
export function CorosNotes() {
  const { t } = useTranslation("coros");
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
