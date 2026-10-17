import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { MaternalInfo, MaternalInput } from "@joyorogo/api/lib/maternal";

import { useToast } from "@/components/toast";
import { Button, ListGroup, ListRow, Sheet, Text } from "@/components/ui";
import { errorMessage, fmtDateMedium } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

import { MaternalDisclaimer, MaternalPrivacyNote } from "./disclaimer";
import { MaternalFlagNotes } from "./flag-notes";
import {
  draftFromProfile,
  draftToInput,
  emptyDraft,
  MaternalForm,
  type MaternalDraft,
} from "./maternal-form";
import { useMaternal, useStageText } from "./use-maternal";

/** Settings > Profile "Hamil dan menyusui": apply new answers, or turn the mode off. */
export function useSetMaternal(onDone?: () => void) {
  const { t } = useTranslation("maternal");
  const toast = useToast();
  return useMutation({
    mutationFn: (input: MaternalInput) => client.profile.setMaternal(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries();
      toast.success(input.mode === "none" ? t("settings.turnedOff") : t("settings.saved"));
      onDone?.();
    },
  });
}

function SummaryRows({ info }: { info: MaternalInfo }) {
  const { t } = useTranslation("maternal");
  const stage = useStageText(info);
  const g = info.gestation;
  return (
    <ListGroup>
      <ListRow icon="heart-outline" iconTint="makan" title={stage.line} subtitle={stage.detail || undefined} />
      {info.mode === "pregnant" && g ? (
        <ListRow
          icon="calendar-outline"
          iconTint="muted"
          title={t("summary.due", { date: fmtDateMedium(g.dueDate) })}
          subtitle={
            g.daysToDue >= 0
              ? t("summary.daysToDue", { days: g.daysToDue })
              : t("summary.pastDue", { days: -g.daysToDue })
          }
        />
      ) : null}
      {info.mode === "pregnant" && info.twins ? (
        <ListRow icon="people-outline" iconTint="muted" title={t("summary.twins")} />
      ) : null}
    </ListGroup>
  );
}

/** Summary + actions; the setup/edit form, the birth sheet and the confirm are siblings opened by the screen. */
export function MaternalSettingsSheet({
  visible,
  onClose,
  onEdit,
  onEnd,
  onTurnOff,
}: {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onEnd: () => void;
  onTurnOff: () => void;
}) {
  const { t } = useTranslation("maternal");
  const { mode, info } = useMaternal();
  const active = mode !== "none" && info !== null;
  return (
    <Sheet visible={visible} onClose={onClose} title={t("settings.title")}>
      {active ? (
        <>
          <SummaryRows info={info} />
          <MaternalFlagNotes info={info} />
          <View style={styles.actions}>
            <Button variant="secondary" icon="create-outline" label={t("settings.edit")} onPress={onEdit} />
            {mode === "pregnant" ? (
              <Button variant="secondary" icon="happy-outline" label={t("end.button")} onPress={onEnd} />
            ) : null}
            <Button variant="ghost" destructive label={t("settings.turnOff")} onPress={onTurnOff} />
          </View>
          <Text style={styles.note}>{t("settings.hiddenNote")}</Text>
          <Text style={styles.note}>{t("settings.ramadanNote")}</Text>
        </>
      ) : (
        <>
          <Text style={styles.intro}>{t("settings.intro")}</Text>
          <Button label={t("settings.enable")} onPress={onEdit} />
        </>
      )}
      <MaternalDisclaimer />
      <MaternalPrivacyNote />
    </Sheet>
  );
}

/** Setup (mode off) or edit of the Hamil / Menyusui answers. */
export function MaternalEditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation(["maternal", "common"]);
  const { mode } = useMaternal();
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: visible });
  const row = profile.data?.profile ?? null;
  const [draft, setDraft] = useState<MaternalDraft>(() => emptyDraft("pregnant"));
  const [error, setError] = useState<string | null>(null);
  const save = useSetMaternal(onClose);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    save.reset();
    setDraft(row && mode !== "none" ? draftFromProfile(row) : emptyDraft("pregnant"));
    // Only when the sheet opens; later profile refetches must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    const result = draftToInput(draft);
    if (!result.ok) {
      setError(t(`maternal:${result.error}`));
      return;
    }
    setError(null);
    save.mutate(result.input);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("maternal:settings.title")}
      footer={<Button label={t("maternal:form.save")} onPress={submit} loading={save.isPending} />}
    >
      <MaternalForm
        draft={draft}
        onChange={setDraft}
        showModePicker
        error={error ?? (save.isError ? errorMessage(save.error) : null)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    gap: theme.spacing.sm,
  },
  intro: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
}));
