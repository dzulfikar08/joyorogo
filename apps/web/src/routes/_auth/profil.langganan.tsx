import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SubscriptionScreen } from "@/components/profil/subscription-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/langganan")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: LanggananPage,
});

function LanggananPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.subscription.title")}>
      {(ctx) => <SubscriptionScreen ctx={ctx} />}
    </ProfilGate>
  );
}
