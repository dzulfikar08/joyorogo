import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DisplayScreen } from "@/components/profil/display-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/tampilan")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: TampilanPage,
});

function TampilanPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.display.title")}>
      {() => <DisplayScreen />}
    </ProfilGate>
  );
}
