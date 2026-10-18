import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PrivacyScreen } from "@/components/profil/privacy-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/privasi")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: PrivasiPage,
});

function PrivasiPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.privacy.title")}>
      {(ctx) => <PrivacyScreen ctx={ctx} />}
    </ProfilGate>
  );
}
