import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Field, Input, Sheet, Segmented, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

const STORY_MAX = 1000;
const PHOTOS_MAX = 4;
const LONG_EDGE = 1600;

type Pending = { localUri: string; base64: string };

/**
 * Kompres satu foto ke sisi panjang ~1600px JPEG kualitas 0.8; balikin
 * base64 untuk unggahan.
 */
async function compress(asset: ImagePicker.ImagePickerAsset): Promise<Pending> {
  const scale = Math.min(1, LONG_EDGE / Math.max(asset.width, asset.height));
  const width = Math.max(1, Math.round(asset.width * scale));
  const height = Math.max(1, Math.round(asset.height * scale));
  const rendered = await ImageManipulator.manipulate(asset.uri)
    .resize({ width, height })
    .renderAsync();
  const out = await rendered.saveAsync({
    base64: true,
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  if (!out.base64) throw new Error("Foto kosong");
  return { localUri: out.uri, base64: out.base64 };
}

/**
 * Komposer post bebas 'cerita': teks (maks 1000) + 0-4 foto + penonton.
 * Foto dipilih dari galeri (multi), dipampatkan di perangkat, diunggah satu
 * per satu, lalu post dibuat dengan id fotonya. Keyboard mengikuti Sheet.
 */
export function FeedComposer({
  visible,
  onClose,
  onPosted,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { theme } = useUnistyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<"publik" | "grup">("grup");
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reset = () => {
    setCaption("");
    setPhotos([]);
    setBusy(null);
  };

  const addPhotos = async () => {
    if (photos.length >= PHOTOS_MAX) {
      toast.error(`Maksimal ${PHOTOS_MAX} foto per post.`);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      selectionLimit: PHOTOS_MAX - photos.length,
      quality: 1,
      exif: false,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      try {
        setBusy("Memproses foto...");
        const pending = await compress(asset);
        setPhotos((prev) => [...prev, pending]);
      } catch (e) {
        toast.error("Foto tidak bisa diproses", errorMessage(e));
      }
    }
    setBusy(null);
  };

  const submit = async () => {
    const text = caption.trim();
    if (text.length === 0 && photos.length === 0) {
      toast.error("Tulis cerita dulu atau lampirkan satu foto.");
      return;
    }
    try {
      const photoIds: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setBusy(`Mengunggah foto ${i + 1}/${photos.length}...`);
        const uploaded = await client.social.uploadPostPhoto({
          imageBase64: photos[i].base64,
          mimeType: "image/jpeg",
        });
        photoIds.push(uploaded.photoId);
      }
      setBusy("Membagikan...");
      await client.social.createPost({
        kind: "cerita",
        caption: text || undefined,
        photoIds: photoIds.length > 0 ? photoIds : undefined,
        visibility,
      });
      toast.success("Post kamu muncul di feed.");
      void queryClient.invalidateQueries({ queryKey: orpc.social.key() });
      reset();
      onClose();
      onPosted();
    } catch (e) {
      toast.error("Post gagal dibagikan", errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (busy === null) onClose();
      }}
      title="Buat post"
      footer={
        <Button
          label={busy ?? "Posting"}
          onPress={() => void submit()}
          disabled={busy !== null}
          loading={busy !== null}
          style={styles.postButton}
        />
      }
    >
      <Field label="Ceritamu">
        <Input
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={STORY_MAX}
          placeholder="Ada cerita hari ini? Ceritakan perjalananmu..."
          accessibilityLabel="Tulis post"
        />
        <Text style={styles.counter}>
          {caption.length}/{STORY_MAX}
        </Text>
      </Field>

      {photos.length > 0 ? (
        <View style={styles.thumbRow}>
          {photos.map((photo, index) => (
            <View key={photo.localUri} style={styles.thumbWrap}>
              <Image source={{ uri: photo.localUri }} style={styles.thumb} accessibilityLabel={`Foto ${index + 1}`} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Buang foto ${index + 1}`}
                onPress={() => setPhotos((prev) => prev.filter((p) => p !== photo))}
                style={({ pressed }) => [styles.thumbRemove, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={12} color={theme.colors.background} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tambah foto dari galeri"
        onPress={() => void addPhotos()}
        disabled={photos.length >= PHOTOS_MAX || busy !== null}
        style={({ pressed }) => [
          styles.addPhoto,
          (photos.length >= PHOTOS_MAX || busy !== null) && styles.addPhotoDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="image-outline" size={18} color={theme.colors.mutedForeground} />
        <Text style={styles.addPhotoText}>
          Foto{photos.length > 0 ? ` (${photos.length}/${PHOTOS_MAX})` : ""}
        </Text>
      </Pressable>

      <Segmented<"publik" | "grup">
        options={[
          { value: "grup", label: "Teman grup" },
          { value: "publik", label: "Publik" },
        ]}
        value={visibility}
        onChange={setVisibility}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  counter: {
    alignSelf: "flex-end",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  thumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  thumbWrap: {
    width: 72,
    height: 72,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.foreground,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    minHeight: 44,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  addPhotoDisabled: {
    opacity: 0.5,
  },
  addPhotoText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  postButton: {
    width: "100%",
  },
  pressed: {
    opacity: 0.7,
  },
}));
