import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Heart, Scale, Users, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Card, IconChip, ListGroup, ListRow, SectionTitle } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { useOptimisticMutation } from "@/lib/optimistic";
import { usePlatform } from "@/lib/platform";
import { disableWebPush, enableWebPush, useWebPush } from "@/lib/push";
import { client, orpc } from "@/utils/orpc";

type Prefs = Awaited<ReturnType<AppRouterClient["push"]["prefs"]>>;
type PrefsInput = Parameters<AppRouterClient["push"]["setPrefs"]>[0];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const CATEGORIES: Array<{
  key: "social" | "group" | "meal" | "weigh" | "recap";
  icon: LucideIcon;
  tone: "makan" | "bakar" | "tidur";
  input: (on: boolean) => PrefsInput;
}> = [
  { key: "social", icon: Heart, tone: "bakar", input: (social) => ({ social }) },
  { key: "group", icon: Users, tone: "makan", input: (group) => ({ group }) },
  { key: "meal", icon: Utensils, tone: "makan", input: (meal) => ({ meal }) },
  { key: "weigh", icon: Scale, tone: "tidur", input: (weigh) => ({ weigh }) },
  { key: "recap", icon: CalendarCheck, tone: "tidur", input: (recap) => ({ recap }) },
];

/**
 * Pengaturan > Notifikasi: status browser ini, lima kategori, jam tenang,
 * notifikasi uji, dan petunjuk batas harian. Server (`push.*`) adalah sumber
 * kebenaran; app JoyoRogo dan JoyoFit di HP memakai pengaturan yang sama.
 */
export function NotificationsScreen() {
  const { t } = useTranslation(["notifications", "settings"]);
  const queryClient = useQueryClient();
  const prefs = useQuery(orpc.push.prefs.queryOptions());
  const vapid = useQuery(orpc.push.vapidPublicKey.queryOptions());
  const web = useWebPush();
  const platform = usePlatform();
  const prefsKey = orpc.push.prefs.queryOptions().queryKey;

  const save = useOptimisticMutation<PrefsInput, unknown>({
    mutationFn: (input) => client.push.setPrefs(input),
    patch: (input, cache) => {
      const { quiet, ...flags } = input;
      cache.value<Prefs>(prefsKey, (old) =>
        old ? { ...old, ...flags, quiet: { ...old.quiet, ...quiet } } : old,
      );
    },
    invalidate: () => [orpc.push.key()],
  });

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: orpc.push.prefs.key() });

  const enable = useMutation({
    mutationFn: enableWebPush,
    onSuccess: async (result) => {
      if (result.ok) toast.success(t("notifications:web.toastEnabled"));
      else toast.error(t(`settings:fasting.error.${result.reason}`));
      await web.refresh();
      await refreshDevices();
    },
  });
  const disable = useMutation({
    mutationFn: disableWebPush,
    onSuccess: async () => {
      toast.success(t("notifications:web.toastDisabled"));
      await web.refresh();
      await refreshDevices();
    },
  });
  const test = useMutation({
    mutationFn: () => client.push.sendTest(),
    onSuccess: (result) => {
      if (result.status === "sent") toast.success(t("notifications:test.sent"));
      else if (result.status === "skipped") toast.error(t("notifications:test.skipped"));
      else toast.error(t("notifications:test.failed"));
    },
    onError: () => toast.error(t("notifications:test.failed")),
  });

  const data = prefs.data;
  const serverCanPush = vapid.data ? vapid.data.key !== null : true;
  const busy = enable.isPending || disable.isPending;

  let status: string | null = null;
  if (vapid.data && !serverCanPush) status = t("notifications:status.unavailable");
  else if (web.ready) {
    if (web.permission === "unsupported") status = t("notifications:status.unsupported");
    else if (web.permission === "denied") status = t("notifications:status.denied");
    else if (web.permission === "granted") {
      status = web.subscribed
        ? t("notifications:status.granted")
        : t("notifications:web.notSubscribed");
    } else status = t("notifications:status.undetermined");
  }
  const needsInstall = web.ready && web.permission === "unsupported" && platform.os === "ios";
  const canToggle =
    web.ready && serverCanPush && (web.permission === "default" || web.permission === "granted");

  return (
    <>
      <p className="mb-5 px-1 text-sm leading-relaxed text-muted-foreground">
        {t("notifications:intro")}
      </p>

      <SectionTitle>{t("notifications:web.sections.browser")}</SectionTitle>
      <Card>
        {status === null ? (
          <Skeleton className="h-5 w-3/4" />
        ) : (
          <p className="text-sm leading-relaxed">{status}</p>
        )}
        {needsInstall && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("notifications:web.iosInstall")}
          </p>
        )}
        {canToggle &&
          (web.permission === "granted" && web.subscribed ? (
            <Button
              variant="outline"
              className="mt-4 w-full"
              disabled={busy}
              onClick={() => disable.mutate()}
            >
              {disable.isPending ? t("notifications:web.working") : t("notifications:web.disable")}
            </Button>
          ) : (
            <Button className="mt-4 w-full" disabled={busy} onClick={() => enable.mutate()}>
              {enable.isPending ? t("notifications:web.working") : t("notifications:web.enable")}
            </Button>
          ))}
        {data && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("notifications:devices", {
              web: data.devices.web,
              rogo: data.devices.joyorogo,
              fit: data.devices.joyofit,
            })}
          </p>
        )}
      </Card>

      <SectionTitle className="mt-7">{t("notifications:web.sections.categories")}</SectionTitle>
      {prefs.isPending ? (
        <Skeleton className="h-72 rounded-3xl" />
      ) : prefs.error || !data ? (
        <p className="text-sm font-semibold text-destructive">
          {prefs.error?.message ?? t("notifications:saveFailed")}
        </p>
      ) : (
        <>
          <ListGroup>
            {CATEGORIES.map(({ key, icon: Icon, tone, input }) => (
              <ListRow
                key={key}
                icon={
                  <IconChip tone={tone}>
                    <Icon />
                  </IconChip>
                }
                title={t(`notifications:categories.${key}.title`)}
                subtitle={t(`notifications:categories.${key}.desc`)}
                trailing={
                  <Switch
                    checked={data[key]}
                    onCheckedChange={(checked) => save.mutate(input(checked))}
                    label={t(`notifications:categories.${key}.title`)}
                  />
                }
              />
            ))}
          </ListGroup>

          <SectionTitle className="mt-7">{t("notifications:web.sections.quiet")}</SectionTitle>
          <Card>
            <div className="flex min-h-[2.75rem] items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t("notifications:quiet.title")}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("notifications:quiet.desc")}
                </p>
              </div>
              <Switch
                checked={data.quiet.enabled}
                onCheckedChange={(checked) => save.mutate({ quiet: { enabled: checked } })}
                label={t("notifications:web.quietAria")}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <QuietTime
                id="quiet-start"
                label={t("notifications:quiet.start")}
                aria={t("notifications:web.startAria")}
                value={data.quiet.start}
                disabled={!data.quiet.enabled}
                onChange={(start) => save.mutate({ quiet: { start } })}
              />
              <QuietTime
                id="quiet-end"
                label={t("notifications:quiet.end")}
                aria={t("notifications:web.endAria")}
                value={data.quiet.end}
                disabled={!data.quiet.enabled}
                onChange={(end) => save.mutate({ quiet: { end } })}
              />
            </div>
          </Card>
        </>
      )}

      <SectionTitle className="mt-7">{t("notifications:web.sections.test")}</SectionTitle>
      <Card>
        <Button
          variant="outline"
          className="w-full"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? t("notifications:test.sending") : t("notifications:test.button")}
        </Button>
      </Card>

      <p className="mt-4 px-1 text-xs leading-relaxed text-muted-foreground">
        {t("notifications:limits")}
      </p>
    </>
  );
}

function QuietTime({
  id,
  label,
  aria,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  aria: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="shrink-0 text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="time"
        aria-label={aria}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (HHMM.test(next) && next !== value) onChange(next);
        }}
        className="w-32"
      />
    </div>
  );
}
