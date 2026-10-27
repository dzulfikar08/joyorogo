import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { StyleSheet } from "react-native-unistyles";

import { BadgeMedal } from "@/components/badges/badge-medal";
import { Button, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { isShareCancel, shareBadgeImage } from "@/components/story/share";
import { badgeKey, RING_COLORS, ringFor, starsFor, type BadgeLike } from "@/src/lib/badges";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

const CARD_WIDTH = 300;
const EXPORT_WIDTH = 1080;

/**
 * Share card of kind "badge": medallion art, badge name, tier stars and @handle. Carries nothing else:
 * no weight, no body data. Captured with view-shot and handed to the system share sheet.
 */
export function BadgeShareSheet({
  badge,
  visible,
  onClose,
}: {
  badge: BadgeLike | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(["badges", "common"]);
  const toast = useToast();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const profile = useQuery(orpc.social.myProfile.queryOptions({ enabled: visible }));
  const handle = profile.data?.handle ?? null;

  if (!badge) return null;
  const ring = ringFor(badge);
  const stars = starsFor(badge);
  const name = t(badgeKey(badge.id, "name"));

  const share = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(cardRef, {
        format: "png",
        result: "tmpfile",
        quality: 1,
        width: EXPORT_WIDTH,
      });
      await shareBadgeImage(uri, name);
    } catch (error) {
      if (!isShareCancel(error)) toast.error(t("share.title"), errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("share.title")}
      footer={<Button label={t("share.cta")} icon="share-social" loading={busy} onPress={share} />}
    >
      <View style={styles.stage}>
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <BadgeMedal badge={badge} size={168} stars={false} />
          <Text style={styles.name}>{name}</Text>
          {stars > 0 ? (
            <View style={styles.stars}>
              {Array.from({ length: stars }, (_, i) => (
                <Ionicons key={i} name="star" size={20} color={RING_COLORS[ring ?? "gold"]} />
              ))}
            </View>
          ) : null}
          {handle ? <Text style={styles.handle}>@{handle}</Text> : null}
          <Text style={styles.brand}>JoyoRogo</Text>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  stage: { alignItems: "center", paddingVertical: theme.spacing.sm },
  card: {
    width: CARD_WIDTH,
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  name: { fontSize: theme.fontSize["2xl"], fontWeight: "800", color: theme.colors.foreground, textAlign: "center" },
  stars: { flexDirection: "row", gap: 3 },
  handle: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.mutedForeground },
  brand: { fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.primary, letterSpacing: 1 },
}));
