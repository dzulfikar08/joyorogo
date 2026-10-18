import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { MealsScreen } from "@/components/profil/meals-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/makan")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: MakanPage,
});

function MakanPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.meals.title")}>
      {(ctx) => <MealsScreen ctx={ctx} />}
    </ProfilGate>
  );
}
