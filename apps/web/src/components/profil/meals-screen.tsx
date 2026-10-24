import { useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { BudgetSetting } from "@/components/plate/budget-setting";
import { DishwareSection } from "@/components/dishware/dishware-section";
import { FastingSettingsSection } from "@/components/fasting/settings-section";
import { Card, Segmented, SectionTitle } from "@/components/kit/surface";
import { profileOptions } from "@/components/profil/shared";
import { ScanSimpleSection } from "@/components/profil/scan-simple-section";
import type { ProfilCtx } from "@/components/profil/shared";
import type { MyProfileData } from "@/lib/api-types";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

/** Ramadan mode, intermittent fasting, reminders note, the shopping budget and Mode simpel after a scan. */
export function MealsScreen({ ctx }: { ctx: ProfilCtx }) {
  const { t } = useTranslation(["settings", "maternal"]);
  const { row, targets } = ctx;
  return (
    <>
      <SectionTitle>{t("section.ramadan")}</SectionTitle>
      <RamadanSection mode={row.ramadanMode} />
      {targets.maternal && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
          {t("maternal:settings.ramadanNote")}
        </p>
      )}

      {!targets.maternal && (
        <>
          <SectionTitle className="mt-7">{t("section.fasting")}</SectionTitle>
          <FastingSettingsSection />
        </>
      )}

      <SectionTitle className="mt-7">{t("section.reminders")}</SectionTitle>
      <AppRemindersNote />

      <SectionTitle className="mt-7">{t("section.shopping")}</SectionTitle>
      <BudgetSetting />

      <DishwareSection />
      <ScanSimpleSection />
    </>
  );
}

/**
 * Meal/water/weigh-in reminders are scheduled on the phone (local
 * notifications) and are not stored on the server, so the web has nothing to
 * sync. Only the IF reminders above also reach the browser via Web Push.
 */
function AppRemindersNote() {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Card>
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">{t("reminders.webNote")}</p>
    </Card>
  );
}

function RamadanSection({ mode }: { mode: "auto" | "on" | "off" }) {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const previous = useRef<"auto" | "on" | "off" | null>(null);
  const setMode = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["setRamadanMode"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.setRamadanMode(input),
    patch: (input, cache) => {
      previous.current = mode;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile ? { ...data, profile: { ...data.profile, ramadanMode: input.mode } } : data,
      );
    },
    invalidate: () => [orpc.profile.key()],
    success: () => {
      const prev = previous.current;
      previous.current = null;
      if (prev === null) return undefined;
      return {
        message: t("ramadan.toast"),
        undo: () => void client.profile.setRamadanMode({ mode: prev }),
      };
    },
  });
  const hint: Record<"auto" | "on" | "off", string> = {
    auto: t("ramadan.hint.auto"),
    on: t("ramadan.hint.on"),
    off: t("ramadan.hint.off"),
  };
  return (
    <Card>
      <Segmented
        label={t("section.ramadan")}
        value={mode}
        onChange={(value) => setMode.mutate({ mode: value })}
        options={[
          { value: "auto", label: t("ramadan.option.auto") },
          { value: "on", label: t("ramadan.option.on") },
          { value: "off", label: t("ramadan.option.off") },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{hint[mode]}</p>
    </Card>
  );
}
