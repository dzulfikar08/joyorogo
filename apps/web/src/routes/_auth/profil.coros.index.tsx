import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { CorosScreen } from "@/components/profil/coros-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/coros/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: CorosPage,
});

function CorosPage() {
  const { t } = useTranslation("coros");
  return <ProfilGate title={t("title")}>{() => <CorosScreen />}</ProfilGate>;
}
