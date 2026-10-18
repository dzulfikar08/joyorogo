import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { TargetScreen } from "@/components/profil/target-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/target")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  validateSearch: (search: Record<string, unknown>): { needs?: true; maternal?: true } => ({
    needs: search.needs === true || search.needs === 1 || search.needs === "1" ? true : undefined,
    maternal:
      search.maternal === true || search.maternal === 1 || search.maternal === "1" ? true : undefined,
  }),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: TargetPage,
});

function TargetPage() {
  const { t } = useTranslation("settings");
  const { needs, maternal } = Route.useSearch();
  return (
    <ProfilGate title={t("hub.rows.body.title")}>
      {(ctx) => <TargetScreen ctx={ctx} needs={needs === true} openMaternal={maternal === true} />}
    </ProfilGate>
  );
}
