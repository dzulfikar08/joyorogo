import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AboutScreen } from "@/components/profil/about-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/tentang")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: TentangPage,
});

function TentangPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.about.title")}>
      {() => <AboutScreen />}
    </ProfilGate>
  );
}
