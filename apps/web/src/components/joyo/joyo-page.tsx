import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { grantHostedConsent } from "@joyorogo/api/lib/joyo-ai/consent";
import { hostedAccess } from "@joyorogo/api/lib/joyo-ai/settings";

import { ErrorNote } from "@/components/kit/error-note";
import { Page } from "@/components/kit/surface";
import { useAppConfig } from "@/lib/app-config";
import { classifyJoyoError, readSettings, writeSettings } from "@/lib/joyo-chat";
import { orpc } from "@/utils/orpc";

import { BlockedCard, ConsentCard, ProGateCards } from "./cards";
import { ChatBody } from "./joyo-chat";

const statusOptions = () => ({
  ...orpc.joyo.status.queryOptions(),
  // The gate (Pro, age, today's count) is read fresh every time the page opens; a saved copy only fills the first paint.
  staleTime: 0,
  refetchOnMount: "always" as const,
  retry: false,
});

function Title() {
  const { t } = useTranslation("joyoAiWeb");
  return <h1 className="px-1 pt-1 pb-3 text-xl leading-tight font-extrabold tracking-tight">{t("title")}</h1>;
}

/**
 * /joyo: Joyo AI on the web, the hosted engine only. In front of the chat: the account's status (Pro or paywall off, age, the
 * server's own answer when it does not know Joyo AI yet) and the one-time consent. A free account sees why and where the free
 * own-key engine is (the phone app).
 */
export function JoyoPage({ ask, onAskTaken }: { ask: string | undefined; onAskTaken: () => void }) {
  const { t } = useTranslation("joyoAiWeb");
  const queryClient = useQueryClient();
  const config = useAppConfig();
  const navigate = useNavigate();
  const status = useQuery(statusOptions());
  const [settings, setSettings] = useState(readSettings);
  const key = statusOptions().queryKey;

  const patchStatus = useCallback(
    (patch: Partial<NonNullable<typeof status.data>>) => {
      queryClient.setQueryData(key, (old: typeof status.data) => (old ? { ...old, ...patch } : old));
    },
    // The key is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient],
  );

  const agree = () => {
    const next = grantHostedConsent(settings, Math.floor(Date.now() / 1000));
    writeSettings(next);
    setSettings(next);
  };

  const refuse = useCallback(
    (failure: { kind: "paywall" | "minor" | "noConsent" }) => {
      if (failure.kind === "paywall") patchStatus({ unlocked: false });
      else if (failure.kind === "minor") patchStatus({ ageBlocked: true });
      else {
        // The server wants a consent version this browser has not shown: ask again.
        setSettings((old) => {
          const next = { ...old, hostedConsent: null };
          writeSettings(next);
          return next;
        });
      }
    },
    [patchStatus],
  );

  const onUsage = useCallback((used: number, cap: number) => patchStatus({ usedToday: used, dailyCap: cap }), [patchStatus]);

  const data = status.data;
  const failure = status.error ? classifyJoyoError(status.error) : null;

  let body;
  if (data === undefined && status.isPending) {
    body = <Skeleton aria-busy="true" aria-label={t("status.loading")} className="h-56 rounded-3xl" />;
  } else if (failure?.kind === "unavailable") {
    body = <BlockedCard kind="unavailable" onRetry={() => void status.refetch()} />;
  } else if (data === undefined) {
    body = <ErrorNote message={status.error?.message ?? ""} onRetry={() => void status.refetch()} />;
  } else if (data.ageBlocked) {
    body = <BlockedCard kind="minor" />;
  } else if (!data.unlocked) {
    body = <ProGateCards canUpgrade={config.data?.billing ?? false} />;
  } else if (data.dailyCap === 0) {
    body = <BlockedCard kind="off" onRetry={() => void status.refetch()} />;
  } else if (!hostedAccess(settings, null).ok) {
    body = <ConsentCard onAgree={agree} onLater={() => void navigate({ to: "/beranda" })} />;
  }

  const ready = data !== undefined && data.unlocked && !data.ageBlocked && data.dailyCap !== 0 && hostedAccess(settings, null).ok;

  return (
    <Page className="max-w-xl pb-0 lg:max-w-3xl">
      {ready ? (
        <ChatBody
          ask={ask}
          onAskTaken={onAskTaken}
          usage={{ used: data.usedToday, cap: data.dailyCap }}
          onUsage={onUsage}
          onRefused={refuse}
        />
      ) : (
        <>
          <Title />
          {body}
        </>
      )}
    </Page>
  );
}
