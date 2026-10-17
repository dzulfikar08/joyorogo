import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { FeedingType } from "@joyorogo/api/lib/maternal";

import { Calendar } from "@/components/calendar";
import { useToast } from "@/components/toast";
import { Button, Field, Segmented, Sheet, Text } from "@/components/ui";
import { errorMessage, fmtDateMedium } from "@/utils/format";
import { client, queryClient } from "@/utils/orpc";

import { InfoNote } from "./flag-notes";

type Next = "breastfeeding" | "none";

/**
 * "Sudah melahirkan": birth date, then Menyusui (exclusive or partial) or back
 * to the plain plan, ending with the postpartum note.
 */
export function EndPregnancySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation(["maternal", "settings"]);
  const toast = useToast();
  const today = jakartaToday();
  const [birthDate, setBirthDate] = useState(today);
  const [next, setNext] = useState<Next>("breastfeeding");
  const [feeding, setFeeding] = useState<FeedingType>("exclusive");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible) {
      setBirthDate(jakartaToday());
      setNext("breastfeeding");
      setFeeding("exclusive");
      setDone(false);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = useMutation({
    mutationFn: () =>
      client.profile.endPregnancy({
        next,
        birthDate,
        ...(next === "breastfeeding" ? { feeding } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success(t("maternal:end.done"));
      setDone(true);
    },
  });

  if (done) {
    return (
      <Sheet
        visible={visible}
        onClose={onClose}
        title={t("maternal:end.postpartum.title")}
        footer={<Button label={t("maternal:form.continue")} onPress={onClose} />}
      >
        <Text style={styles.body}>{t("maternal:end.postpartum.body")}</Text>
        <InfoNote body={t("maternal:end.postpartum.check")} />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("maternal:end.title")}
      footer={
        <Button
          label={t("maternal:end.confirm")}
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      }
    >
      <Text style={styles.body}>{t("maternal:end.body")}</Text>

      <Field label={t("maternal:end.birthDate")}>
        <Calendar
          value={birthDate}
          onChange={setBirthDate}
          minDate={shiftDate(today, -180)}
          maxDate={today}
          prevLabel={t("settings:plan.targetDate.prevMonth")}
          nextLabel={t("settings:plan.targetDate.nextMonth")}
        />
      </Field>
      <Text style={styles.picked}>{fmtDateMedium(birthDate)}</Text>

      <Segmented<Next>
        options={[
          { value: "breastfeeding", label: t("maternal:end.breastfeeding") },
          { value: "none", label: t("maternal:end.none") },
        ]}
        value={next}
        onChange={setNext}
      />
      <Text style={styles.body}>
        {next === "breastfeeding" ? t("maternal:end.breastfeedingHint") : t("maternal:end.noneHint")}
      </Text>

      {next === "breastfeeding" ? (
        <Field label={t("maternal:form.feeding.label")}>
          <View style={styles.gap}>
            <Segmented<FeedingType>
              options={[
                { value: "exclusive", label: t("maternal:form.feeding.exclusive") },
                { value: "partial", label: t("maternal:form.feeding.partial") },
              ]}
              value={feeding}
              onChange={setFeeding}
            />
            <Text style={styles.body}>
              {feeding === "exclusive"
                ? t("maternal:form.feeding.exclusiveHint")
                : t("maternal:form.feeding.partialHint")}
            </Text>
          </View>
        </Field>
      ) : null}

      {save.isError ? <Text style={styles.error}>{errorMessage(save.error)}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  picked: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  gap: {
    gap: theme.spacing.sm,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
