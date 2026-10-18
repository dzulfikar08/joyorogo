import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { StravaScreen } from "@/components/profil/strava-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/strava/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: StravaPage,
});

function StravaPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.strava.title")}>
      {() => <StravaScreen />}
    </ProfilGate>
  );
}
