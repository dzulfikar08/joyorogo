import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GarminScreen } from "@/components/profil/garmin-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/garmin/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: GarminPage,
});

function GarminPage() {
  const { t } = useTranslation("garmin");
  return <ProfilGate title={t("title")}>{() => <GarminScreen />}</ProfilGate>;
}
