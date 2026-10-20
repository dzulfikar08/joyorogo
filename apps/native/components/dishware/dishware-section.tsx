import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { DishwareForm, type Plate } from "@/components/dishware/dishware-form";
import { PlatePhoto } from "@/components/dishware/plate-photo";
import { useToast } from "@/components/toast";
import { Button, Card, SectionTitle, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** "Piring saya": registered plates and bowls. Renders nothing unless the feature is enabled. */
export function DishwareSection() {
  const { t } = useTranslation("settings");
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery(orpc.dishware.status.queryOptions());
  const [form, setForm] = useState<{ plate?: Plate } | null>(null);

  const remove = useMutation(
    orpc.dishware.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.dishware.key() });
        toast.success(t("dishware.removed"));
      },
      onError: (e) => toast.error(t("dishware.error.remove"), errorMessage(e)),
    }),
  );

  const data = status.data;
  if (!data?.enabled) return null;

  const confirmDelete = (plate: Plate) => {
    Alert.alert(t("dishware.deleteConfirm", { name: plate.name }), undefined, [
      { text: t("dishware.form.cancel"), style: "cancel" },
      { text: t("dishware.delete"), style: "destructive", onPress: () => remove.mutate({ id: plate.id }) },
    ]);
  };

  const full = data.plates.length >= data.max;

  return (
    <>
      <SectionTitle title={t("dishware.title")} />
      <Card style={styles.gap}>
        <Text style={styles.note}>{t("dishware.intro")}</Text>
        {data.plates.length === 0 ? <Text style={styles.note}>{t("dishware.empty")}</Text> : null}
        {data.plates.map((plate) => (
          <View key={plate.id} style={styles.plate}>
            <PlatePhoto photoUrl={plate.photoUrl} />
            <View style={styles.grow}>
              <Text style={styles.name} numberOfLines={1}>
                {plate.name}
              </Text>
              <Text style={styles.note}>
                {t(`dishware.kind.${plate.kind}`)} ·{" "}
                {plate.widthCm != null
                  ? t("dishware.sizeBox", { length: plate.diameterCm, width: plate.widthCm })
                  : t("dishware.size", { cm: plate.diameterCm })}
              </Text>
              {plate.diameterSource === "card" ? (
                <Text style={styles.badge}>{t("dishware.fromCard")}</Text>
              ) : null}
            </View>
            <View style={styles.actions}>
              <Button
                variant="ghost"
                size="sm"
                icon="create-outline"
                label={t("dishware.edit")}
                onPress={() => setForm({ plate })}
              />
              <Button
                variant="ghost"
                size="sm"
                icon="trash-outline"
                label={t("dishware.delete")}
                onPress={() => confirmDelete(plate)}
                loading={remove.isPending && remove.variables?.id === plate.id}
              />
            </View>
          </View>
        ))}
        <Text style={styles.note}>
          {full
            ? t("dishware.full", { max: data.max })
            : t("dishware.slots", { used: data.plates.length, max: data.max })}
        </Text>
        {form === null ? (
          <Button
            variant="secondary"
            icon="add"
            label={t("dishware.add")}
            onPress={() => setForm({})}
            disabled={full}
          />
        ) : null}
      </Card>
      {form !== null ? (
        <DishwareForm key={form.plate?.id ?? "new"} plate={form.plate} onDone={() => setForm(null)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  gap: { gap: theme.spacing.md },
  grow: { flex: 1, gap: 2 },
  plate: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  actions: { flexDirection: "row" },
  name: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  badge: { fontSize: theme.fontSize.xs, fontWeight: "600", color: theme.colors.primary },
}));
