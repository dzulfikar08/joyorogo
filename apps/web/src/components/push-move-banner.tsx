import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { HOSTS } from "@/lib/app-host";
import { enableWebPush, useWebPush } from "@/lib/push";
import { orpc } from "@/utils/orpc";

const DISMISSED_KEY = "jrg-push-move-dismissed";

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage blocked (private mode): treat as dismissed rather than nagging every visit.
    return true;
  }
}

/**
 * Browser push subscriptions and the notification permission belong to an origin, so everyone who turned them on at
 * joyorogo.com starts over on app.joyorogo.com (docs/app-subdomain.md). Asked once, only where it applies: on the app
 * host, for an account that has a browser registered, in a browser that has not been asked here yet.
 */
export function PushMoveBanner() {
  const { t } = useTranslation(["notifications", "settings", "common"]);
  const queryClient = useQueryClient();
  const onAppHost = HOSTS !== null && window.location.host === HOSTS.appHost;
  const prefs = useQuery({ ...orpc.push.prefs.queryOptions(), enabled: onAppHost });
  const web = useWebPush();
  const [hidden, setHidden] = useState(dismissedBefore);
  const [busy, setBusy] = useState(false);

  const askable = web.permission === "default" || web.permission === "granted";
  if (!onAppHost || hidden || !web.ready || !askable || web.subscribed || !(prefs.data && prefs.data.devices.web > 0)) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to persist to; hidden state still covers this visit.
    }
    setHidden(true);
  };

  const enable = async () => {
    setBusy(true);
    const result = await enableWebPush();
    setBusy(false);
    if (result.ok) {
      toast.success(t("notifications:web.toastEnabled"));
      dismiss();
      await queryClient.invalidateQueries({ queryKey: orpc.push.key() });
    } else if (result.reason === "denied") {
      dismiss();
    } else {
      toast.error(t(`settings:fasting.error.${result.reason}`));
    }
    await web.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3">
      <div className="flex items-center gap-1 rounded-3xl bg-makan-soft py-1.5 pr-1.5 pl-4 text-makan-ink">
        <BellRing className="size-5 shrink-0" aria-hidden />
        <button
          type="button"
          disabled={busy}
          onClick={() => void enable()}
          className="flex min-h-11 min-w-0 flex-1 items-center rounded-full pl-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
        >
          <span className="min-w-0 text-sm leading-snug font-bold">
            {t("notifications:web.move.title")}
            <span className="block text-xs font-medium opacity-80">{t("notifications:web.move.body")}</span>
            <span className="mt-1 block text-xs font-bold underline">{t("notifications:web.move.action")}</span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t("common:actions.close")}
          onClick={dismiss}
          className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none dark:hover:bg-white/10"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
