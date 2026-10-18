import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { HubScreen } from "@/components/profil/hub-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  validateSearch: (search: Record<string, unknown>): { needs?: true; maternal?: true } => ({
    needs: search.needs === true || search.needs === 1 || search.needs === "1" ? true : undefined,
    maternal:
      search.maternal === true || search.maternal === 1 || search.maternal === "1" ? true : undefined,
  }),
  // Old deep links (/profil?needs=1, /profil?maternal=1) now live on the Target & tubuh screen.
  beforeLoad: ({ search }) => {
    if (search.needs || search.maternal) {
      throw redirect({ to: "/profil/target", search, replace: true });
    }
  },
  pendingComponent: () => <ProfilSkeleton />,
  component: ProfilHubPage,
});

function ProfilHubPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hubWeb.title")} backTo="hub">
      {(ctx) => <HubScreen ctx={ctx} />}
    </ProfilGate>
  );
}
