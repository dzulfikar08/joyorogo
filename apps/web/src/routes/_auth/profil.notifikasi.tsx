import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { NotificationsScreen } from "@/components/profil/notifications-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/notifikasi")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: NotifikasiPage,
});

function NotifikasiPage() {
  const { t } = useTranslation("notifications");
  return <ProfilGate title={t("title")}>{() => <NotificationsScreen />}</ProfilGate>;
}
