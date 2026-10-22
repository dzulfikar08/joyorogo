import "@/unistyles";
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";

import { MoreProCard } from "@/components/pro/more-pro-card";
import {
  Avatar,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Skeleton,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { useUnreadCount } from "@/src/lib/group";

/**
 * Lainnya tab: the overflow destination — Profil, Berat, Rekap, Sumber data, Grup, Kotak Masuk, and the
 * Founder paywall when the account is still free.
 */
export default function Lainnya() {
  const { t } = useTranslation();
  const gate = useSessionGate();
  const { data: session } = authClient.useSession();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.count ?? 0;
  const displayName = session?.user.name ?? t("more.fallbackNameNative");

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("more.title")} />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={140} radius={20} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  // The Pro card (free accounts that can buy) sits first: /founder bounces a Pro account back home and
  // when billing is off (self-hosted copies, Play build without the service account), so the card checks both.
  return (
    <Screen>
      <PageHeader title={t("more.title")} caption={t("more.subtitleNative")} />
      <MoreProCard />
      <ListGroup>
        <ListRow
          thumb={<Avatar name={displayName} image={session?.user.image ?? null} size={32} />}
          title={displayName}
          subtitle={session?.user.email ?? "-"}
          chevron
          onPress={() => router.push("/profil")}
        />
        <ListRow
          icon="scale"
          iconTint="tidur"
          title={t("more.weight.title")}
          subtitle={t("more.weight.subtitle")}
          chevron
          onPress={() => router.push("/berat")}
        />
        <ListRow
          icon="calendar"
          iconTint="makan"
          title={t("more.recap.title")}
          subtitle={t("more.recap.subtitle")}
          chevron
          onPress={() => router.push("/rekap")}
        />
        <ListRow
          icon="swap-horizontal"
          iconTint="tidur"
          title={t("more.sources.title")}
          subtitle={t("more.sources.subtitle")}
          chevron
          onPress={() => router.push("/sumber")}
        />
        <ListRow
          icon="people"
          iconTint="makan"
          title={t("more.groups.title")}
          subtitle={t("more.groups.subtitleNative")}
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/grup")}
        />
        <ListRow
          icon="notifications"
          iconTint="bakar"
          title={t("more.inbox.title")}
          subtitle={t("more.inbox.subtitle")}
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/inbox")}
        />
      </ListGroup>
    </Screen>
  );
}
