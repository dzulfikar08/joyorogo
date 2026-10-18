import "@/unistyles";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ProfilPage } from "@/components/profil/page";
import { useToast } from "@/components/toast";
import { Avatar, Button, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

/** Akun: profile photo (camera, gallery, remove) and the account email. */
export default function Akun() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.account.title")}>
      <AkunContent />
    </ProfilPage>
  );
}

function AkunContent() {
  const { t } = useTranslation(["settings", "common"]);
  const toast = useToast();
  // refetch keeps every screen's avatar in sync right after ganti/hapus foto.
  const session = authClient.useSession();
  const [avatarRemoveOpen, setAvatarRemoveOpen] = useState(false);

  const displayName = session.data?.user.name ?? t("common:more.fallbackNameNative");
  const avatarImage = session.data?.user.image ?? null;

  // Foto profil: galeri atau kamera (potong persegi di picker), lalu
  // dipampatkan ke persegi 512px JPEG sebelum diunggah.
  const refreshAfterAvatar = async () => {
    await session.refetch();
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
  };

  const uploadAvatar = useOptimisticMutation<
    { imageBase64: string; mimeType: "image/png" | "image/jpeg" | "image/webp" },
    unknown
  >({
    mutationFn: (input) => client.avatar.upload(input),
    success: () => {
      void refreshAfterAvatar();
      return {
        message: t("profile.photo.updated"),
        undo: () => {
          void client.avatar.remove().then(() => refreshAfterAvatar());
        },
      };
    },
    onError: (e) => toast.error(t("profile.photo.error.uploadFailed"), errorMessage(e)),
    invalidate: () => [orpc.profile.key()],
  });

  // Hapus foto: optimistic (avatar langsung kosong), DELETE-nya menyusul
  // setelah jendela urungkan lewat. Undo mengembalikan sesi tanpa server call.
  const removeAvatar = useDelayedDelete<{ id: string }>({
    remove: async () => {
      await client.avatar.remove();
      await refreshAfterAvatar();
    },
    patch: (_row, cache) => {
      // Sesi better-auth bukan cache oRPC; temukan query yang punya user.
      for (const query of queryClient.getQueryCache().findAll({ queryKey: [] })) {
        const data = query.state.data as { user?: { image?: string | null } } | undefined;
        if (data?.user === undefined) continue;
        cache.value(query.queryKey, (old: typeof data | undefined) =>
          old === undefined ? undefined : { ...old, user: { ...old.user, image: null } },
        );
      }
    },
    label: () => t("profile.photo.label"),
    invalidate: () => [orpc.profile.key()],
  });

  const pickAvatar = async (source: "gallery" | "camera") => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      exif: false,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    try {
      // Center-crop ke persegi lalu kecilkan ke 512px: satu bentuk untuk semua.
      const side = Math.min(asset.width, asset.height);
      const rendered = await ImageManipulator.manipulate(asset.uri)
        .crop({
          originX: Math.floor((asset.width - side) / 2),
          originY: Math.floor((asset.height - side) / 2),
          width: side,
          height: side,
        })
        .resize({ width: 512, height: 512 })
        .renderAsync();
      const out = await rendered.saveAsync({
        base64: true,
        compress: 0.85,
        format: SaveFormat.JPEG,
      });
      if (!out.base64) throw new Error(t("profile.photo.error.empty"));
      uploadAvatar.mutate({ imageBase64: out.base64, mimeType: "image/jpeg" });
    } catch (e) {
      toast.error(t("profile.photo.error.processFailed"), errorMessage(e));
    }
  };

  return (
    <>
      <Card style={styles.card}>
        <Avatar name={displayName} image={avatarImage} size={88} />
        <View style={styles.identity}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{session.data?.user.email ?? "-"}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            label={t("profile.photo.camera")}
            loading={uploadAvatar.isPending}
            onPress={() => void pickAvatar("camera")}
          />
          <Button
            variant="secondary"
            size="sm"
            label={t("profile.photo.gallery")}
            loading={uploadAvatar.isPending}
            onPress={() => void pickAvatar("gallery")}
          />
          {avatarImage ? (
            <Button
              variant="secondary"
              size="sm"
              label={t("profile.photo.remove")}
              disabled={uploadAvatar.isPending}
              onPress={() => setAvatarRemoveOpen(true)}
            />
          ) : null}
        </View>
      </Card>

      <ConfirmSheet
        visible={avatarRemoveOpen}
        onClose={() => setAvatarRemoveOpen(false)}
        title={t("profile.photo.removeConfirm.title")}
        message={t("profile.photo.removeConfirm.message")}
        confirmLabel={t("common:actions.delete")}
        onConfirm={() => {
          setAvatarRemoveOpen(false);
          removeAvatar({ id: "avatar" });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    alignItems: "center",
    gap: theme.spacing.md,
  },
  identity: {
    alignItems: "center",
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  email: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
}));
