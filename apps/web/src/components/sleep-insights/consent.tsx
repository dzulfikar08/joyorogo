import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { Moon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SleepInsightsStatus } from "@joyorogo/api/lib/sleep-insights-types";

import { IconChip, ListButtonRow, ListGroup, ListRow } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import { useSleepSettings, useSleepStatus } from "@/components/sleep-insights/use-sleep-insights";

/** What JoyoFit sends, what it does not, how long it is kept, and how it is deleted. */
function ConsentDetails() {
  const { t } = useTranslation("sleepInsights");
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>{t("consent.summary")}</p>
      <div>
        <p className="font-bold text-foreground">{t("consent.fieldsTitle")}</p>
        <p>{t("consent.fields")}</p>
      </div>
      <p>{t("consent.notSent")}</p>
      <p>{t("consent.retention")}</p>
      <p>{t("consent.delete")}</p>
      <p>{t("consent.shared")}</p>
    </div>
  );
}

/** Shows the consent text and turns the switch on at the server's current version. */
export function SleepConsentSheet({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: SleepInsightsStatus;
}) {
  const { t } = useTranslation(["sleepInsights", "common"]);
  const { setConsent } = useSleepSettings();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("sleepInsights:consent.title")}>
      <div className="space-y-4">
        <ConsentDetails />
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            disabled={setConsent.isPending}
            onClick={() =>
              setConsent.mutate(
                { enabled: true, version: status.currentVersion },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {t("sleepInsights:ui.off.enable")}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Confirm before the switch goes off: it deletes every stored night. */
export function SleepOffConfirm({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: SleepInsightsStatus;
}) {
  const { t } = useTranslation("sleepInsights");
  const { setConsent } = useSleepSettings();
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("consent.offConfirmTitle")}
      body={t("consent.offConfirmBody")}
      confirmLabel={t("consent.offConfirm")}
      pending={setConsent.isPending}
      onConfirm={() =>
        setConsent.mutate(
          { enabled: false, version: status.currentVersion },
          { onSuccess: () => onOpenChange(false) },
        )
      }
    />
  );
}

/** Weekday chips (Sunday first, bit i = weekday i) for the free days used by the regularity math. */
function FreeDays({ status }: { status: SleepInsightsStatus }) {
  const { t } = useTranslation("sleepInsights");
  const { setFreeDays } = useSleepSettings();
  const days = t("ui.settings.days", { returnObjects: true }) as unknown as string[];
  return (
    <div className="px-5 pb-4">
      <p className="text-sm font-bold">{t("ui.settings.title")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("ui.settings.body")}</p>
      <div role="group" aria-label={t("ui.settings.title")} className="mt-3 flex flex-wrap gap-2">
        {days.map((label, i) => {
          const on = (status.freeDaysMask & (1 << i)) !== 0;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              disabled={setFreeDays.isPending}
              onClick={() => setFreeDays.mutate({ mask: status.freeDaysMask ^ (1 << i) })}
              className={cn(
                "pressable min-h-11 min-w-12 rounded-full px-4 text-sm font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
                on ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Privasi screen block: the same server switch the Tidur screen's enable card turns on. */
export function SleepConsentSection() {
  const { t } = useTranslation("sleepInsights");
  const statusQuery = useSleepStatus();
  const [consentOpen, setConsentOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const status = statusQuery.data;
  if (!status) return null;

  return (
    <>
      <ListGroup className="mt-3">
        <ListRow
          icon={
            <IconChip tone="tidur">
              <Moon />
            </IconChip>
          }
          title={t("consent.switch")}
          trailing={
            <Switch
              label={t("consent.switch")}
              checked={status.enabled}
              disabled={statusQuery.isFetching}
              onCheckedChange={(next) => (next ? setConsentOpen(true) : setOffOpen(true))}
            />
          }
        />
        <li className="relative px-5 py-4">
          <ConsentDetails />
        </li>
        {status.enabled ? (
          <li className="relative pt-4">
            <FreeDays status={status} />
          </li>
        ) : null}
        {status.enabled ? (
          <ListButtonRow
            destructive
            icon={<Trash2 aria-hidden />}
            title={t("ui.deleteData")}
            onClick={() => setOffOpen(true)}
          />
        ) : null}
      </ListGroup>
      <SleepConsentSheet open={consentOpen} onOpenChange={setConsentOpen} status={status} />
      <SleepOffConfirm open={offOpen} onOpenChange={setOffOpen} status={status} />
    </>
  );
}
