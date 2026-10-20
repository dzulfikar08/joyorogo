import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getActiveLocale } from "@joyorogo/i18n";

import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** The account-wide sleep insights switch and free-days setting (server side `sleep_insight_pref`). */
export function useSleepStatus() {
  return useQuery(orpc.sleepInsights.status.queryOptions());
}

/** The computed view; only asked for while the switch is on. */
export function useSleepView(enabled: boolean) {
  const locale = getActiveLocale();
  return useQuery({
    ...orpc.sleepInsights.get.queryOptions({ input: { locale } }),
    enabled,
  });
}

/** Mutations of the status: consent switch and free days. Every change refetches status and view. */
export function useSleepSettings() {
  const { t } = useTranslation("sleepInsights");
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.sleepInsights.key() });

  const setConsent = useMutation(
    orpc.sleepInsights.setConsent.mutationOptions({
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.sleepInsights.status.queryOptions().queryKey, status);
        void refresh();
        toast.success(status.enabled ? t("consent.enabledToast") : t("consent.disabledToast"));
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  );
  const setFreeDays = useMutation(
    orpc.sleepInsights.setFreeDays.mutationOptions({
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.sleepInsights.status.queryOptions().queryKey, status);
        void refresh();
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  );
  const dismiss = useMutation(
    orpc.sleepInsights.dismiss.mutationOptions({
      onSuccess: () => void refresh(),
      onError: (error) => toast.error(errorMessage(error)),
    }),
  );
  return { setConsent, setFreeDays, dismiss };
}
