import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { i18n, LOCALES, LOCALE_NAMES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { Card, SectionTitle, Segmented } from "@/components/kit/surface";
import { profileOptions } from "@/components/profil/shared";
import { useTheme } from "@/components/theme-provider";
import type { MyProfileData } from "@/lib/api-types";
import { setLocale } from "@/lib/i18n";
import { orpc } from "@/utils/orpc";

/** Theme and app language. */
export function DisplayScreen() {
  const { t } = useTranslation("settings");
  return (
    <>
      <SectionTitle>{t("section.appearance")}</SectionTitle>
      <ThemeSection />

      <SectionTitle className="mt-7">{t("language.title")}</SectionTitle>
      <LanguageSection />
    </>
  );
}

function ThemeSection() {
  const { t } = useTranslation(["settings", "common"]);
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <Segmented
        label={t("theme.label")}
        value={theme}
        onChange={setTheme}
        options={[
          { value: "light", label: t("theme.light") },
          { value: "dark", label: t("theme.dark") },
          { value: "system", label: t("theme.system") },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{t("theme.hint")}</p>
    </Card>
  );
}

/** App language: applies at once on this device, then saves on the account. */
function LanguageSection() {
  const { t, i18n: instance } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const save = useMutation(
    orpc.profile.setLocale.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: profileOptions.queryKey }),
      onError: () => toast.error(i18n.t("settings:language.saveError")),
    }),
  );
  const pick = (locale: Locale) => {
    if (locale === instance.language) return;
    // Patch the cached profile first so LocaleSync keeps the new choice instead
    // of re-applying the old saved one while the request is in flight.
    queryClient.setQueryData<MyProfileData>(profileOptions.queryKey, (data) =>
      data?.profile ? { ...data, profile: { ...data.profile, locale } } : data,
    );
    void setLocale(locale);
    save.mutate({ locale });
  };
  return (
    <Card>
      <div role="radiogroup" aria-label={t("language.groupLabel")} className="space-y-1">
        {LOCALES.map((locale) => {
          const active = locale === instance.language;
          return (
            <button
              key={locale}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(locale)}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[0.9375rem] font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none ${
                active ? "bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {LOCALE_NAMES[locale]}
              {active && <Check className="size-5" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        {t("language.caption")}
      </p>
    </Card>
  );
}
