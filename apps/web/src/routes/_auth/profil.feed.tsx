import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { FeedSettingsSection } from "@/components/feed/settings";
import { ProfilGate, ProfilSkeleton, profileOptions } from "@/components/profil/shared";

export const Route = createFileRoute("/_auth/profil/feed")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: () => <ProfilSkeleton sub />,
  component: FeedPage,
});

function FeedPage() {
  const { t } = useTranslation("settings");
  return (
    <ProfilGate title={t("hub.rows.feed.title")}>
      {() => <FeedSettingsSection />}
    </ProfilGate>
  );
}
