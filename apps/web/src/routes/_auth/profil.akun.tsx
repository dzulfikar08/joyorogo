import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AccountScreen } from "@/components/profil/account-screen";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/akun")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: AkunPage,
});

function AkunPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.account.title")}>
      {(ctx) => <AccountScreen ctx={ctx} />}
    </ProfilGate>
  );
}
