import "@/unistyles";
import { Redirect, router } from "expo-router";

import { useAppConfig } from "@/components/billing";
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
 * Lainnya tab: the overflow destination — Profil, Grup, Kotak Masuk, and the
 * Founder paywall when the account is still free.
 */
export default function Lainnya() {
  const gate = useSessionGate();
  const { data: session } = authClient.useSession();
  const config = useAppConfig();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.count ?? 0;
  const displayName = session?.user.name ?? "Pengguna JoyoRogo";

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Lainnya" />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={140} radius={20} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  // Free accounts see the paywall row; Founder sees nothing to buy.
  const showPricing = config.data?.paywall === true;

  return (
    <Screen>
      <PageHeader title="Lainnya" caption="Akun, grup, dan notifikasi." />
      <ListGroup>
        <ListRow
          thumb={<Avatar name={displayName} size={32} />}
          title={displayName}
          subtitle={session?.user.email ?? "-"}
          chevron
          onPress={() => router.push("/profil")}
        />
        <ListRow
          icon="scale"
          iconTint="tidur"
          title="Berat"
          subtitle="Berat badan, lingkar perut, dan tren"
          chevron
          onPress={() => router.push("/berat")}
        />
        <ListRow
          icon="people"
          iconTint="makan"
          title="Grup"
          subtitle="Colek, catatan, dan VAR perut"
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/grup")}
        />
        <ListRow
          icon="notifications"
          iconTint="bakar"
          title="Kotak masuk"
          subtitle="Colek dan catatan untukmu"
          value={unreadCount > 0 ? String(unreadCount) : undefined}
          chevron
          onPress={() => router.push("/inbox")}
        />
        {showPricing ? (
          <ListRow
            icon="star"
            iconTint="tidur"
            title="Harga"
            subtitle="Jadi Founder, buka semua fitur"
            chevron
            onPress={() =>
              router.push({ pathname: "/founder", params: { from: "profile" } })
            }
          />
        ) : null}
      </ListGroup>
    </Screen>
  );
}
