import { Input } from "@joyorogo/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { FastingPattern } from "@joyorogo/api/lib/fasting";
import { i18n } from "@joyorogo/i18n";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Card, Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { useOptimisticMutation } from "@/lib/optimistic";
import { enableWebPush } from "@/lib/push";
import { client, orpc } from "@/utils/orpc";

type FastingSettings = {
  pattern: "off" | FastingPattern;
  windowStart: string;
  notify: boolean;
};

/** Same toast copy as before the push module was shared. */
async function subscribeBrowser(): Promise<boolean> {
  const result = await enableWebPush();
  if (!result.ok) toast.error(i18n.t(`settings:fasting.error.${result.reason}`));
  return result.ok;
}

/**
 * "Puasa intermiten" setelan di /profil/makan: pola, jam buka jendela, dan toggle
 * notifikasi Web Push (izin → /sw.js → langganan VAPID).
 */
export function FastingSettingsSection() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.fasting.settings.queryOptions());

  // Previous settings for the undo re-apply.
  const previousSettings = useRef<Awaited<ReturnType<AppRouterClient["fasting"]["settings"]>> | null>(null);
  const save = useOptimisticMutation<
    Parameters<AppRouterClient["fasting"]["setSettings"]>[0],
    unknown
  >({
    mutationFn: (input) => client.fasting.setSettings(input),
    patch: (input, cache) => {
      const key = orpc.fasting.settings.queryOptions().queryKey;
      previousSettings.current = queryClient.getQueryData(key) ?? null;
      cache.value(key, (old) => (old ? { ...old, ...input } : old));
    },
    invalidate: () => [orpc.fasting.key()],
    success: () => {
      const prev = previousSettings.current;
      previousSettings.current = null;
      if (!prev) return { message: t("fasting.toast.saved") };
      return {
        message: t("fasting.toast.saved"),
        undo: () =>
          void client.fasting.setSettings({
            pattern: prev.pattern,
            windowStart: prev.windowStart,
            notify: prev.notify,
          }),
      };
    },
  });

  const data = settings.data;
  if (settings.isPending || !data) {
    return (
      <Card>
        <div className="h-9 animate-pulse rounded-full bg-muted" />
        <div className="mt-4 h-11 animate-pulse rounded-xl bg-muted" />
      </Card>
    );
  }

  const pattern = data.pattern;
  const windowStart = data.windowStart;
  const notify = data.notify;

  const change = (patch:
    | { pattern: FastingSettings["pattern"] }
    | { windowStart: string }
    | { notify: boolean }) => {
    save.mutate({ ...data, ...patch });
  };

  const toggleNotify = async (enabled: boolean) => {
    // Mirrors native: the switch only stays on when permission was granted.
    // Switching off keeps the browser subscribed: the same subscription now
    // carries the other notification categories, and the server only sends
    // fasting reminders while `notify` is on.
    change({ notify: enabled ? await subscribeBrowser() : false });
  };
  const patternOptions: Array<{ value: FastingSettings["pattern"]; label: string }> = [
    { value: "off", label: t("fasting.pattern.off") },
    { value: "16:8", label: "16:8" },
    { value: "18:6", label: "18:6" },
    { value: "20:4", label: "20:4" },
    { value: "omad", label: "OMAD" },
  ];
  const [fastHours, eatHours] = pattern.split(":");
  const hint =
    pattern === "off"
      ? t("fasting.hint.off")
      : pattern === "omad"
        ? t("fasting.hint.omad")
        : t("fasting.hint.window", { fast: fastHours, eat: eatHours });

  return (
    <Card>
      <Segmented
        label={t("fasting.pattern.label")}
        value={pattern}
        onChange={(value) => change({ pattern: value })}
        options={patternOptions}
      />
      <div className="mt-4 flex items-center gap-3">
        <label
          htmlFor="fasting-window-start"
          className="shrink-0 text-sm font-semibold text-muted-foreground"
        >
          {t("fasting.window.label")}
        </label>
        <Input
          id="fasting-window-start"
          type="time"
          value={windowStart}
          disabled={pattern === "off" || save.isPending}
          onChange={(event) => {
            const value = event.target.value;
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) change({ windowStart: value });
          }}
          className="w-32"
        />
      </div>
      <div className="mt-4 flex min-h-[2.75rem] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="size-4 text-makan" aria-hidden />
            {t("fasting.notify.title")}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("fasting.notify.hint")}
          </p>
        </div>
        <Switch
          checked={notify}
          onCheckedChange={(value) => void toggleNotify(value)}
          disabled={save.isPending || pattern === "off"}
          label={t("fasting.notify.aria")}
        />
      </div>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </Card>
  );
}
