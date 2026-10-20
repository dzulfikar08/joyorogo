import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { PlatePhoto } from "@/components/dishware/plate-photo";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Segmented, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

export type Plate = InferClientOutputs<AppRouterClient>["dishware"]["status"]["plates"][number];
type Kind = Plate["kind"];

const KINDS: Kind[] = ["flat", "bowl", "rattan", "lunchbox"];
const MAX_SIDE = 1024;

type Photo = { uri: string; base64: string };

/** Parses "12,5" / "12.5"; null when empty or not a number. */
function parseCm(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
}

/** Same resize + JPEG encode as the scan photos (<= 1024 px). */
async function encode(uri: string, width: number, height: number): Promise<Photo> {
  let context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_SIDE) {
    context =
      height >= width ? context.resize({ height: MAX_SIDE }) : context.resize({ width: MAX_SIDE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.75, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error("encode");
  return { uri: saved.uri, base64: saved.base64 };
}

/** Add form (photo + measure) or, with `plate`, an edit form for name/kind/size. */
export function DishwareForm({ plate, onDone }: { plate?: Plate; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = plate !== undefined;

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [name, setName] = useState(plate?.name ?? "");
  const [kind, setKind] = useState<Kind>(plate?.kind ?? "flat");
  const [length, setLength] = useState(plate ? String(plate.diameterCm) : "");
  const [width, setWidth] = useState(plate?.widthCm != null ? String(plate.widthCm) : "");
  const [source, setSource] = useState<"manual" | "card">(plate?.diameterSource ?? "manual");
  const [description, setDescription] = useState<string | undefined>(undefined);
  const [measureNote, setMeasureNote] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.dishware.key() });
    toast.success(t("dishware.saved"));
    onDone();
  };
  const create = useMutation(orpc.dishware.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(orpc.dishware.update.mutationOptions({ onSuccess: done }));
  const saving = create.isPending || update.isPending;

  const setPhotoFrom = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    try {
      setPhoto(await encode(asset.uri, asset.width, asset.height));
      setDescription(undefined);
      setMeasureNote(null);
      setSource("manual");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const takePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    await setPhotoFrom(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }));
  };

  const pickPhoto = async () => {
    setError(null);
    await setPhotoFrom(
      await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, exif: false }),
    );
  };

  const measure = async () => {
    if (!photo) return;
    setMeasuring(true);
    setError(null);
    setMeasureNote(null);
    try {
      const result = await client.dishware.analyze({ imageBase64: photo.base64, mimeType: "image/jpeg" });
      setDescription(result.description);
      if (result.cardDiameterCm === null) {
        setMeasureNote(t("dishware.measure.noCard"));
      } else {
        setLength(String(result.cardDiameterCm));
        setSource("card");
        setMeasureNote(t("dishware.measure.result", { cm: result.cardDiameterCm }));
      }
    } catch (e) {
      setMeasureNote(errorMessage(e) || t("dishware.measure.failed"));
    } finally {
      setMeasuring(false);
    }
  };

  const save = () => {
    setError(null);
    const diameterCm = parseCm(length);
    const widthCm = kind === "lunchbox" ? parseCm(width) : null;
    if (!name.trim() || diameterCm === null || diameterCm < 5 || diameterCm > 60) {
      setError(t("dishware.error.save"));
      return;
    }
    if (kind === "lunchbox" && (widthCm === null || widthCm < 3 || widthCm > 60)) {
      setError(t("dishware.error.save"));
      return;
    }
    if (editing) {
      update.mutate(
        { id: plate.id, name: name.trim(), kind, diameterCm, widthCm },
        { onError: (e) => setError(errorMessage(e) || t("dishware.error.save")) },
      );
      return;
    }
    if (!photo) {
      setError(t("dishware.error.save"));
      return;
    }
    create.mutate(
      {
        imageBase64: photo.base64,
        mimeType: "image/jpeg",
        name: name.trim(),
        kind,
        diameterCm,
        ...(kind === "lunchbox" && widthCm !== null ? { widthCm } : {}),
        diameterSource: source,
        ...(description ? { description } : {}),
      },
      { onError: (e) => setError(errorMessage(e) || t("dishware.error.save")) },
    );
  };

  return (
    <Card style={styles.gap}>
      <Text style={styles.title}>{editing ? t("dishware.edit") : t("dishware.form.title")}</Text>

      {editing ? (
        <PlatePhoto photoUrl={plate.photoUrl} size={96} />
      ) : (
        <Field label={t("dishware.form.photo")} hint={t("dishware.form.photoHint")}>
          {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" /> : null}
          <View style={styles.row}>
            <Button
              variant="secondary"
              size="sm"
              icon="camera"
              label={photo ? t("dishware.form.retake") : t("dishware.form.takePhoto")}
              onPress={() => void takePhoto()}
              disabled={measuring || saving}
            />
            <Button
              variant="ghost"
              size="sm"
              icon="images"
              label={t("dishware.form.photo")}
              onPress={() => void pickPhoto()}
              disabled={measuring || saving}
            />
          </View>
        </Field>
      )}

      <Field label={t("dishware.form.name")}>
        <Input
          value={name}
          onChangeText={setName}
          placeholder={t("dishware.form.namePlaceholder")}
          maxLength={40}
        />
      </Field>

      <Field label={t("dishware.form.kind")}>
        <Segmented
          options={KINDS.map((value) => ({ value, label: t(`dishware.kind.${value}`) }))}
          value={kind}
          onChange={setKind}
        />
      </Field>

      <Field
        label={kind === "lunchbox" ? t("dishware.form.length") : t("dishware.form.diameter")}
        hint={t("dishware.form.diameterHelp")}
      >
        <Input
          value={length}
          onChangeText={(text) => {
            setLength(text);
            setSource("manual");
          }}
          keyboardType="decimal-pad"
          maxLength={5}
        />
      </Field>
      {kind === "lunchbox" ? (
        <Field label={t("dishware.form.width")}>
          <Input value={width} onChangeText={setWidth} keyboardType="decimal-pad" maxLength={5} />
        </Field>
      ) : null}

      {!editing ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            icon="scan"
            label={measuring ? t("dishware.form.measuring") : t("dishware.form.measureCard")}
            onPress={() => void measure()}
            loading={measuring}
            disabled={!photo || measuring || saving}
          />
          {measureNote ? <Text style={styles.note}>{measureNote}</Text> : null}
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Button
          label={saving ? t("dishware.form.saving") : t("dishware.form.save")}
          onPress={save}
          loading={saving}
          disabled={measuring || (!editing && !photo)}
          style={styles.grow}
        />
        <Button variant="ghost" label={t("dishware.form.cancel")} onPress={onDone} disabled={saving} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  gap: { gap: theme.spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  grow: { flex: 1 },
  title: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  error: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.destructive },
  preview: { width: "100%", height: 180, borderRadius: theme.radius.tile },
}));
