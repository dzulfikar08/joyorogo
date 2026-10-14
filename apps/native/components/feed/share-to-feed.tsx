import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Chip, Field, Input, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import type { PostKind, Visibility } from "@/src/lib/social";

const CAPTION_MAX = 280;

/**
 * Sheet "Bagikan ke feed": caption opsional + pilih penonton. `share`
 * dipasok layar pemanggil supaya urutan simpan sumber (misal sesi latihan
 * dulu) tetap di tangan layar, sama seperti versi web.
 */
export function ShareToFeedSheet({
  visible,
  onClose,
  title,
  preview,
  kind,
  refId,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Satu baris tentang apa yang dibagikan, mis. "Sate ayam · 350 kcal". */
  preview: string;
  kind: PostKind;
  refId: string;
}) {
  const { theme } = useUnistyles();
  const toast = useToast();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("grup");

  const profile = useQuery({
    ...orpc.social.myProfile.queryOptions(),
    enabled: visible,
  });

  const publicProfile = profile.data?.publicProfile ?? false;

  // Default visibility follows the profile setting each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setCaption("");
      setVisibility(profile.data?.defaultVisibility ?? "grup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, profile.data?.defaultVisibility]);

  type ShareInput = { caption: string; visibility: Visibility };

  const share = useOptimisticMutation<ShareInput, { id: string; visibility: string }>({
    mutationFn: (input) => client.social.createPost({ kind, refId, ...input }),
    success: (input, data) => {
      onClose();
      // The feed list lives in another screen's cache; the invalidate on
      // settle is enough. Undo deletes the post outright.
      return {
        message: "Postingan dibagikan",
        undo: () => void client.social.deletePost({ id: data.id }),
      };
    },
    onError: (e) => toast.error("Gagal membagikan", errorMessage(e)),
    invalidate: () => [orpc.social.key()],
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Bagikan ke feed"
      footer={
        <Button
          label={share.isPending ? "Membagikan…" : "Bagikan"}
          onPress={() => share.mutate({ caption: caption.trim(), visibility })}
          disabled={!publicProfile && visibility === "publik"}
          loading={share.isPending}
        />
      }
    >
      <View style={styles.preview}>
        <Text style={styles.previewTitle}>{title}</Text>
        <Text style={styles.previewSub}>{preview}</Text>
      </View>

      <Field label={`Caption (opsional) · ${caption.length}/${CAPTION_MAX}`}>
        <Input
          value={caption}
          onChangeText={setCaption}
          maxLength={CAPTION_MAX}
          multiline
          placeholder="Ceritakan prosesnya..."
        />
      </Field>

      <Field label="Siapa yang bisa lihat">
        <View style={styles.chipRow}>
          <Chip
            label="Teman grup"
            selected={visibility === "grup"}
            onPress={() => setVisibility("grup")}
          />
          <Chip
            label="Publik"
            selected={visibility === "publik"}
            disabled={!publicProfile}
            onPress={() => setVisibility("publik")}
          />
        </View>
        {!publicProfile ? (
          <Text style={[styles.hint, { color: theme.colors.warning }]}>
            Nyalakan "Profil publik" di Pengaturan feed dulu agar bisa memilih Publik.
          </Text>
        ) : null}
      </Field>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  preview: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: 2,
  },
  previewTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  previewSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing.sm,
  },
}));
