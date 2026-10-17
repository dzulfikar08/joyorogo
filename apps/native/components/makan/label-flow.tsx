import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { BarcodeLookup } from "@joyorogo/api/lib/barcode";
import { checkPer100, toPer100 } from "@joyorogo/api/lib/barcode-nutrition";
import type {
  LabelBasis,
  LabelDraft,
  LabelNutrients,
  LabelUnit,
  LabelWarning,
} from "@joyorogo/api/lib/barcode-nutrition";

import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Segmented, Text } from "@/components/ui";
import { encodeLabelPhoto } from "@/src/lib/label-photo";
import { errorMessage, fmtInt, parseNum } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

export type ContributeOutcome = "saved" | "confirmed" | "outvoted";

/** What contribute and confirm answer: the outcome and the product as everyone sees it now. */
export type LabelResponse = {
  outcome: ContributeOutcome;
  contributors: number;
  lookup: BarcodeLookup;
};

/** Puts a server-fresh lookup into the screen's lookup query so the found UI renders it at once. */
export function cacheLookup(code: string, lookup: BarcodeLookup): void {
  queryClient.setQueryData(orpc.barcode.lookup.queryOptions({ input: { code } }).queryKey, lookup);
}

/** `data.reason` of a refused call; duck-typed like isPaywallError (ORPCError is rebuilt from JSON). */
function reasonOf(error: unknown): string | null {
  const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason;
  return typeof reason === "string" ? reason : null;
}

type Photo = { uri: string; width: number; height: number };
type Slot = "label" | "front";

/** Name, brand and net content already known (an incomplete product), used when the draft has none. */
export type LabelInitial = { name?: string | null; brand?: string | null; quantity?: string | null };

const EMPTY_DRAFT: LabelDraft = {
  name: null,
  brand: null,
  quantity: null,
  servingSize: null,
  unit: "g",
  basis: "serving",
  nutrients: { kcal: null, protein: null, carbs: null, fat: null, fiber: null, sugar: null },
  warnings: [],
};

type Step = "capture" | "reading" | "form";

/**
 * Photo of the "Informasi Nilai Gizi" panel (and optionally the pack front),
 * read into an editable draft, confirmed on a form and saved for everyone.
 * Photos live in memory only; the server deletes them after reading.
 */
export function LabelFlow({
  code,
  initial,
  onCancel,
  onSaved,
}: {
  code: string;
  initial?: LabelInitial;
  onCancel: () => void;
  onSaved: (response: LabelResponse) => void;
}) {
  const { t } = useTranslation(["barcode", "common"]);
  const { theme } = useUnistyles();
  const [step, setStep] = useState<Step>("capture");
  const [photos, setPhotos] = useState<Record<Slot, Photo | null>>({ label: null, front: null });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabelDraft>(EMPTY_DRAFT);
  // Slot waiting on the pre-prompt card, and whether the OS refused the camera.
  const [prompting, setPrompting] = useState<Slot | null>(null);
  const [denied, setDenied] = useState(false);

  const setPhoto = (slot: Slot, photo: Photo | null) =>
    setPhotos((current) => ({ ...current, [slot]: photo }));

  const launchCamera = async (slot: Slot) => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) setPhoto(slot, { uri: asset.uri, width: asset.width, height: asset.height });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // The OS dialog only ever follows the styled pre-prompt card below.
  const takePhoto = async (slot: Slot) => {
    setError(null);
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) {
      setDenied(false);
      await launchCamera(slot);
    } else if (!current.canAskAgain) {
      setPrompting(null);
      setDenied(true);
    } else {
      setPrompting(slot);
    }
  };

  const continuePrompt = async () => {
    const slot = prompting;
    setPrompting(null);
    if (!slot) return;
    const asked = await ImagePicker.requestCameraPermissionsAsync();
    if (!asked.granted) {
      setDenied(true);
      return;
    }
    setDenied(false);
    await launchCamera(slot);
  };

  const chooseFromGallery = async (slot: Slot) => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) setPhoto(slot, { uri: asset.uri, width: asset.width, height: asset.height });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openManual = () => {
    setError(null);
    setDraft(EMPTY_DRAFT);
    setStep("form");
  };

  const read = async () => {
    const labelPhoto = photos.label;
    if (!labelPhoto) return;
    setError(null);
    setStep("reading");
    try {
      const [label, front] = await Promise.all([
        encodeLabelPhoto(labelPhoto.uri, labelPhoto.width, labelPhoto.height),
        photos.front
          ? encodeLabelPhoto(photos.front.uri, photos.front.width, photos.front.height)
          : Promise.resolve(null),
      ]);
      if (!label || (photos.front && !front)) {
        setError(t("common:state.genericError"));
        setStep("capture");
        return;
      }
      const response = await client.barcode.readLabel({
        code,
        label,
        ...(front ? { front } : {}),
      });
      setDraft(response.draft);
      setStep("form");
    } catch (e) {
      setError(errorMessage(e));
      setStep("capture");
    }
  };

  if (step === "reading") {
    return (
      <View style={styles.readingBlock} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.caption}>{t("label.capture.reading")}</Text>
      </View>
    );
  }

  if (step === "form") {
    return (
      <LabelForm
        code={code}
        draft={draft}
        initial={initial}
        onBack={() => setStep("capture")}
        onSaved={onSaved}
      />
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.block}>
        <Text style={styles.title}>{t("label.title")}</Text>
        <Text style={styles.caption}>{t("label.intro")}</Text>
        <Text style={styles.caption}>{t("label.privacy")}</Text>
      </View>

      {prompting ? (
        <Card style={styles.promptCard}>
          <View style={[styles.promptIcon, { backgroundColor: theme.colors.muted }]}>
            <Ionicons name="camera-outline" size={26} color={theme.colors.foreground} />
          </View>
          <Text style={styles.promptTitle}>{t("label.permission.title")}</Text>
          <Text style={styles.captionCenter}>{t("label.permission.body")}</Text>
          <Button
            label={t("label.permission.continue")}
            onPress={() => void continuePrompt()}
            style={styles.fullWidth}
          />
        </Card>
      ) : null}
      {denied ? <Text style={styles.warningText}>{t("label.permission.denied")}</Text> : null}

      <PhotoSlot
        title={t("label.capture.label")}
        what={t("label.capture.labelWhat")}
        hint={t("label.capture.labelHint")}
        photo={photos.label}
        onTake={() => void takePhoto("label")}
        onChoose={() => void chooseFromGallery("label")}
        onRemove={() => setPhoto("label", null)}
      />
      <PhotoSlot
        title={t("label.capture.front")}
        what={t("label.capture.frontWhat")}
        hint={t("label.capture.frontHint")}
        photo={photos.front}
        onTake={() => void takePhoto("front")}
        onChoose={() => void chooseFromGallery("front")}
        onRemove={() => setPhoto("front", null)}
      />

      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {photos.label ? null : <Text style={styles.caption}>{t("label.capture.needLabel")}</Text>}
      <Button
        label={t("label.capture.read")}
        icon="scan-outline"
        onPress={() => void read()}
        disabled={!photos.label}
      />
      <Button variant="secondary" label={t("label.capture.manual")} onPress={openManual} />
      <Button variant="ghost" label={t("common:actions.cancel")} onPress={onCancel} />
    </View>
  );
}

/** One photo slot: empty (take / choose) or a thumbnail (retake / choose another / remove). */
function PhotoSlot({
  title,
  what,
  hint,
  photo,
  onTake,
  onChoose,
  onRemove,
}: {
  title: string;
  what: string;
  hint: string;
  photo: Photo | null;
  onTake: () => void;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("barcode");
  const { theme } = useUnistyles();
  return (
    <Card style={styles.slotCard}>
      <View style={styles.slotHead}>
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            style={styles.thumb}
            accessibilityLabel={t("label.capture.photoAlt", { what })}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="image-outline" size={26} color={theme.colors.mutedForeground} />
          </View>
        )}
        <View style={styles.flexOne}>
          <Text style={styles.slotTitle}>{title}</Text>
          <Text style={styles.caption}>{hint}</Text>
        </View>
      </View>
      <View style={styles.slotActions}>
        <Button
          size="sm"
          variant="secondary"
          icon="camera-outline"
          label={photo ? t("label.capture.retake") : t("label.capture.take")}
          onPress={onTake}
        />
        <Button
          size="sm"
          variant="secondary"
          icon="images-outline"
          label={t("label.capture.choose")}
          onPress={onChoose}
        />
        {photo ? (
          <Button
            size="sm"
            variant="ghost"
            icon="trash-outline"
            label={t("label.capture.remove")}
            onPress={onRemove}
          />
        ) : null}
      </View>
    </Card>
  );
}

const asText = (n: number | null): string => (n === null ? "" : String(n));

type NumberField = "kcal" | "protein" | "carbs" | "fat" | "fiber" | "sugar";
const NUMBER_FIELDS: NumberField[] = ["kcal", "protein", "carbs", "fat", "fiber", "sugar"];

/** A typed number: empty is null, junk or negative is invalid. */
function readNumber(text: string): { value: number | null; valid: boolean } {
  if (text.trim() === "") return { value: null, valid: true };
  const value = parseNum(text);
  return value === null || value < 0 ? { value: null, valid: false } : { value, valid: true };
}

/** Editable draft: name, serving, basis and the six nutrients, with a live per-100 preview. */
function LabelForm({
  code,
  draft,
  initial,
  onBack,
  onSaved,
}: {
  code: string;
  draft: LabelDraft;
  initial?: LabelInitial;
  onBack: () => void;
  onSaved: (response: LabelResponse) => void;
}) {
  const { t } = useTranslation(["barcode", "common"]);
  const [name, setName] = useState(draft.name ?? initial?.name ?? "");
  const [brand, setBrand] = useState(draft.brand ?? initial?.brand ?? "");
  const [quantity, setQuantity] = useState(draft.quantity ?? initial?.quantity ?? "");
  const [serving, setServing] = useState(asText(draft.servingSize));
  const [unit, setUnit] = useState<LabelUnit>(draft.unit);
  const [basis, setBasis] = useState<LabelBasis>(draft.basis);
  const [values, setValues] = useState<Record<NumberField, string>>({
    kcal: asText(draft.nutrients.kcal),
    protein: asText(draft.nutrients.protein),
    carbs: asText(draft.nutrients.carbs),
    fat: asText(draft.nutrients.fat),
    fiber: asText(draft.nutrients.fiber),
    sugar: asText(draft.nutrients.sugar),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedReason, setFailedReason] = useState<string | null>(null);

  const setValue = (field: NumberField) => (text: string) =>
    setValues((current) => ({ ...current, [field]: text }));

  const parsed = Object.fromEntries(
    NUMBER_FIELDS.map((field) => [field, readNumber(values[field])]),
  ) as Record<NumberField, { value: number | null; valid: boolean }>;
  const servingParsed = readNumber(serving);
  const servingSize = servingParsed.value !== null && servingParsed.value > 0 ? servingParsed.value : null;
  const nutrients: LabelNutrients = {
    kcal: parsed.kcal.value,
    protein: parsed.protein.value,
    carbs: parsed.carbs.value,
    fat: parsed.fat.value,
    fiber: parsed.fiber.value,
    sugar: parsed.sugar.value,
  };
  const per100 = toPer100(basis, servingSize, nutrients);
  const live = per100 ? checkPer100(per100) : null;
  // implausible / energy_mismatch are recomputed from what is typed; the rest stay from the draft.
  const warnings: LabelWarning[] = draft.warnings.filter(
    (warning) => warning !== "implausible" && warning !== "energy_mismatch",
  );
  if (live) warnings.push(live);

  const submit = async (confirmEnergyMismatch: boolean) => {
    const trimmed = name.trim();
    if (trimmed === "") return setError(t("label.form.nameRequired"));
    if (nutrients.kcal === null) {
      return setError(
        values.kcal.trim() === "" ? t("label.form.kcalRequired") : t("label.form.numberInvalid"),
      );
    }
    const allValid = parsed.kcal.valid && NUMBER_FIELDS.every((field) => parsed[field].valid);
    if (!allValid || !servingParsed.valid) return setError(t("label.form.numberInvalid"));
    if (basis === "serving" && servingSize === null) return setError(t("label.form.servingRequired"));

    setError(null);
    setFailedReason(null);
    setSaving(true);
    try {
      const response = await client.barcode.contribute({
        code,
        name: trimmed,
        ...(brand.trim() ? { brand: brand.trim() } : {}),
        ...(quantity.trim() ? { quantity: quantity.trim() } : {}),
        ...(servingSize !== null ? { servingSize } : {}),
        unit,
        basis,
        kcal: nutrients.kcal,
        ...(nutrients.protein !== null ? { protein: nutrients.protein } : {}),
        ...(nutrients.carbs !== null ? { carbs: nutrients.carbs } : {}),
        ...(nutrients.fat !== null ? { fat: nutrients.fat } : {}),
        ...(nutrients.fiber !== null ? { fiber: nutrients.fiber } : {}),
        ...(nutrients.sugar !== null ? { sugar: nutrients.sugar } : {}),
        ...(confirmEnergyMismatch ? { confirmEnergyMismatch: true } : {}),
      });
      cacheLookup(code, response.lookup);
      onSaved(response);
    } catch (e) {
      setError(errorMessage(e));
      setFailedReason(reasonOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.block}>
      <View style={styles.block}>
        <Text style={styles.title}>{t("label.form.title")}</Text>
        <Text style={styles.caption}>{t("label.form.hint")}</Text>
      </View>

      <Field label={t("label.form.name")}>
        <Input
          value={name}
          onChangeText={setName}
          placeholder={t("label.form.namePlaceholder")}
          maxLength={120}
          accessibilityLabel={t("label.form.name")}
        />
      </Field>
      <Field label={t("label.form.brand")}>
        <Input
          value={brand}
          onChangeText={setBrand}
          maxLength={80}
          accessibilityLabel={t("label.form.brand")}
        />
      </Field>
      <Field label={t("label.form.quantity")}>
        <Input
          value={quantity}
          onChangeText={setQuantity}
          maxLength={60}
          accessibilityLabel={t("label.form.quantity")}
        />
      </Field>

      <Field label={t("label.form.unit")}>
        <Segmented<LabelUnit>
          options={[
            { value: "g", label: "g" },
            { value: "ml", label: "ml" },
          ]}
          value={unit}
          onChange={setUnit}
        />
      </Field>
      <Field label={t("label.form.serving", { unit })}>
        <Input
          value={serving}
          onChangeText={setServing}
          keyboardType="decimal-pad"
          accessibilityLabel={t("label.form.serving", { unit })}
        />
      </Field>

      <Field label={t("label.form.basis")}>
        <Segmented<LabelBasis>
          options={[
            { value: "serving", label: t("label.form.basisServing") },
            { value: "per100", label: t("label.form.basisPer100", { unit }) },
          ]}
          value={basis}
          onChange={setBasis}
        />
      </Field>

      {NUMBER_FIELDS.map((field) => (
        <Field key={field} label={t(`label.form.${field}`)}>
          <Input
            value={values[field]}
            onChangeText={setValue(field)}
            keyboardType="decimal-pad"
            accessibilityLabel={t(`label.form.${field}`)}
          />
        </Field>
      ))}

      {per100 ? (
        <Text style={styles.previewText} accessibilityLiveRegion="polite">
          {t("label.form.preview", { kcal: fmtInt(Math.round(per100.kcal100)), unit })}
        </Text>
      ) : null}
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warningText}>
          {t(`label.warning.${warning}`)}
        </Text>
      ))}

      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        label={saving ? t("label.form.saving") : t("label.form.save")}
        onPress={() => void submit(false)}
        loading={saving}
      />
      {failedReason === "energy_mismatch" ? (
        <Button
          variant="secondary"
          label={t("label.form.unusual")}
          onPress={() => void submit(true)}
          disabled={saving}
        />
      ) : null}
      <Button variant="ghost" label={t("common:actions.back")} onPress={onBack} disabled={saving} />
    </View>
  );
}

/** Thank-you card shown above the product the user just saved or confirmed. */
export function LabelThanks({
  outcome,
  contributors,
  onContinue,
}: {
  outcome: ContributeOutcome;
  contributors: number;
  onContinue: () => void;
}) {
  const { t } = useTranslation("barcode");
  const { theme } = useUnistyles();
  return (
    <Card style={styles.thanksCard}>
      <View style={[styles.thanksIcon, { backgroundColor: theme.colors.makanSoft }]}>
        <Ionicons name="checkmark" size={28} color={theme.colors.makanText} />
      </View>
      <Text style={styles.promptTitle}>{t("label.thanks.title")}</Text>
      <Text style={styles.captionCenter}>
        {outcome === "saved"
          ? t("label.thanks.saved")
          : outcome === "confirmed"
            ? t("label.thanks.confirmed", { count: contributors })
            : t("label.thanks.outvoted")}
      </Text>
      <Button
        variant="secondary"
        label={t("label.thanks.continue")}
        icon="arrow-down"
        onPress={onContinue}
        style={styles.fullWidth}
      />
    </Card>
  );
}

/**
 * Found community product the user has not vouched for: "Cocok" confirms it,
 * "Ada yang beda" opens the label flow. Rendered only while `mine` is not true.
 */
export function CommunityCheckCard({
  code,
  onWrong,
}: {
  code: string;
  onWrong: () => void;
}) {
  const { t } = useTranslation("barcode");
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const response = await client.barcode.confirm({ code });
      cacheLookup(code, response.lookup);
      if (response.outcome === "outvoted") toast.info(t("result.community.outvoted"));
      else toast.success(t("result.community.confirmed", { count: response.contributors }));
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Card style={styles.communityCard}>
      <Text style={styles.caption}>{t("result.community.prompt")}</Text>
      <View style={styles.slotActions}>
        <Button
          size="sm"
          icon="checkmark"
          label={saving ? t("result.community.confirming") : t("result.community.confirm")}
          onPress={() => void confirm()}
          loading={saving}
        />
        <Button
          size="sm"
          variant="secondary"
          label={t("result.community.wrong")}
          onPress={onWrong}
          disabled={saving}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    gap: theme.spacing.md,
  },
  readingBlock: {
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xxl,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  captionCenter: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
    textAlign: "center",
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  warningText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    lineHeight: 20,
  },
  previewText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  flexOne: {
    flex: 1,
    gap: 2,
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  promptCard: {
    alignItems: "center",
    gap: theme.spacing.md,
  },
  promptIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  promptTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  slotCard: {
    gap: theme.spacing.md,
  },
  slotHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  slotTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  slotActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  thanksCard: {
    alignItems: "center",
    gap: theme.spacing.md,
  },
  thanksIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  communityCard: {
    gap: theme.spacing.md,
  },
}));
