// Ported from JoyoFit (watch-fit) src/features/ai/ui/AiSettingsScreen.tsx, adapted for JoyoRogo.
import "@/unistyles";

import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  MAX_CEILING,
  MIN_CEILING,
  modelFor,
  parseFastFields,
  type AiSettings,
} from "@joyorogo/api/lib/joyo-ai/settings";
import { hostOf } from "@joyorogo/api/lib/joyo-ai/providers";
import type { ModelInfo, ProviderId } from "@joyorogo/api/lib/joyo-ai/types";
import { hostedConsentOk } from "@joyorogo/api/lib/joyo-ai/consent";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ModelPicker } from "@/components/joyo/model-picker";
import { SwitchRow } from "@/components/joyo/switch-row";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  Input,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { chooseModel, listProviderModels } from "@/src/lib/joyo-ai/engine";
import { useJoyoState } from "@/src/lib/joyo-ai/hooks";
import {
  joyoSettings,
  joyoUsage,
  deleteAllChats,
  deleteAllJoyoData,
  removeOwnProvider,
  withdrawHosted,
} from "@/src/lib/joyo-ai/stores";
import { fmtInt } from "@/utils/format";

const CEILING_CHOICES = [20, 40, 100] as const;

type Confirm = "chats" | "key" | "hostedConsent" | "all";

/** Joyo AI settings: which engine answers, the own key and model, the daily limit, what is kept on this phone and how to delete it. */
export default function JoyoAiSettingsScreen() {
  const { t } = useTranslation("joyoAiApp");
  const { t: tj } = useTranslation("joyoAi");
  const params = useLocalSearchParams<{ model?: string }>();
  const toast = useToast();
  const { settings, loaded, access, hosted } = useJoyoState();
  const [usage, setUsage] = useState<{ tokens: number; calls: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [models, setModels] = useState<readonly ModelInfo[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  const provider = settings.provider;
  const ownReady = access?.ok === true;
  const providerName = provider
    ? provider === "custom"
      ? hostOf(settings.customBaseUrl)
      : tj(`provider.${provider}`)
    : "";

  useEffect(() => {
    void joyoUsage
      .today()
      .then((u) => setUsage({ tokens: u.inputTokens + u.outputTokens, calls: u.calls }));
  }, []);

  const loadModels = async (p: ProviderId) => {
    setModelLoading(true);
    setModelError(null);
    try {
      const list = await listProviderModels(p);
      setModels(list);
    } catch {
      setModels(null);
      setModelError(t("model.loadFailed"));
    } finally {
      setModelLoading(false);
    }
  };
  const openPicker = () => {
    if (!provider) return;
    setPicking(true);
    void loadModels(provider);
  };
  // The chat's "choose model" shortcut lands here with the picker open.
  useEffect(() => {
    if (params.model === "1" && loaded && provider && ownReady) openPicker();
    // Opened once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.model, loaded, provider, ownReady]);

  const run = async (job: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await job();
      toast.success(done);
    } catch {
      toast.error(t("data.deleteFailed"));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!loaded) {
    return (
      <Screen>
        <PageHeader title={t("settings.title")} />
        <Skeleton width="100%" height={200} radius={24} />
      </Screen>
    );
  }

  const hostedLine =
    hosted.state === "ready"
      ? hosted.used !== null && hosted.cap !== null
        ? t("engine.hostedUsed", { used: fmtInt(hosted.used), cap: fmtInt(hosted.cap) })
        : t("engine.hostedReady")
      : hosted.state === "locked"
        ? t("engine.hostedLocked")
        : hosted.state === "minor"
          ? t("gate.minor.title")
          : hosted.state === "unavailable"
            ? t("engine.hostedUnavailable")
            : t("engine.hostedChecking");
  const ownLine = provider
    ? access?.ok
      ? t("engine.ownLine", {
          provider: providerName,
          model: modelFor(settings, provider).split("/").pop(),
        })
      : access
        ? t("engine.ownBlocked", {
            provider: providerName,
            reason: t(`engine.block.${access.reason}`),
          })
        : providerName
    : t("engine.ownNone");
  const fastBad =
    settings.fastFields.trim() !== "" && parseFastFields(settings.fastFields) === null;
  const confirmText: Record<
    Confirm,
    { title: string; message: string; button: string; run: () => Promise<void>; done: string }
  > = {
    chats: {
      title: t("data.deleteChatsTitle"),
      message: t("data.deleteChatsMessage"),
      button: t("data.deleteChatsConfirm"),
      run: deleteAllChats,
      done: t("data.chatsDeleted"),
    },
    key: {
      title: t("data.deleteKeyTitle", { provider: providerName }),
      message: t("data.deleteKeyMessage", { provider: providerName }),
      button: t("data.deleteKeyConfirm"),
      run: () => (provider ? removeOwnProvider(provider) : Promise.resolve()),
      done: t("data.keyDeleted"),
    },
    hostedConsent: {
      title: t("data.withdrawTitle"),
      message: t("data.withdrawMessage"),
      button: t("data.withdrawConfirm"),
      run: withdrawHosted,
      done: t("data.withdrawn"),
    },
    all: {
      title: t("data.deleteAllTitle"),
      message: t("data.deleteAllMessage"),
      button: t("data.deleteAllConfirm"),
      run: deleteAllJoyoData,
      done: t("data.allDeleted"),
    },
  };
  const active = confirm ? confirmText[confirm] : null;
  const set = (patch: Partial<AiSettings>) => void joyoSettings.update(patch);

  return (
    <Screen>
      <PageHeader title={t("settings.title")} />

      <SectionTitle title={t("engine.title")} />
      <Segmented
        options={[
          { value: "hosted", label: t("engine.hostedName") },
          { value: "byok", label: t("engine.ownName") },
        ]}
        value={settings.engine}
        onChange={(engine) => set({ engine })}
      />
      <ListGroup>
        <ListRow title={t("engine.hostedName")} subtitle={hostedLine} wrapTitle />
        <ListRow
          title={t("engine.ownName")}
          subtitle={ownLine}
          wrapTitle
          chevron
          onPress={() => router.push("/joyo-setup")}
        />
        {provider && ownReady ? (
          <ListRow
            title={t("engine.pickModel")}
            subtitle={modelFor(settings, provider)}
            chevron
            onPress={openPicker}
          />
        ) : null}
      </ListGroup>
      <Text style={styles.small}>{t("engine.free")}</Text>

      {provider && settings.keySaved[provider] ? (
        <>
          <SectionTitle title={t("limits.title")} />
          <Card style={styles.stack}>
            <Text style={styles.strong}>{t("limits.ceiling")}</Text>
            <Segmented
              options={CEILING_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
              value={String(
                CEILING_CHOICES.includes(settings.dailyCeiling as 20)
                  ? settings.dailyCeiling
                  : "40",
              )}
              onChange={(value) =>
                set({ dailyCeiling: Math.min(MAX_CEILING, Math.max(MIN_CEILING, Number(value))) })
              }
            />
            <Text style={styles.small}>{t("limits.ceilingHint")}</Text>
            <SwitchRow
              label={t("limits.fast")}
              value={settings.fastMode}
              onValueChange={(fastMode) => set({ fastMode })}
            />
            <Text style={styles.small}>{t("limits.fastHint")}</Text>
            <Disclosure title={t("limits.fastFields")} plain>
              <View style={styles.stack}>
                <Input
                  value={settings.fastFields}
                  onChangeText={(fastFields) => set({ fastFields })}
                  placeholder='{"thinking":{"type":"disabled"}}'
                  accessibilityLabel={t("limits.fastFields")}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={[styles.small, fastBad && styles.danger]}>
                  {fastBad ? t("limits.fastFieldsBad") : t("limits.fastFieldsHint")}
                </Text>
              </View>
            </Disclosure>
          </Card>
        </>
      ) : null}

      <SectionTitle title={t("data.title")} />
      <ListGroup>
        <ListRow
          title={t("data.sent")}
          subtitle={t("data.sentHint")}
          chevron
          onPress={() => router.push("/joyo-data")}
        />
        <ListRow
          title={t("chats.title")}
          subtitle={t("data.chatsHint")}
          chevron
          onPress={() => router.push("/joyo-chats")}
        />
        {usage ? (
          <ListRow
            title={t("data.usage", { tokens: fmtInt(usage.tokens), calls: fmtInt(usage.calls) })}
            subtitle={t("data.usageHint")}
            wrapTitle
          />
        ) : null}
      </ListGroup>
      <ListGroup>
        <ListRow
          icon="trash-outline"
          destructive
          title={t("data.deleteChats")}
          onPress={() => setConfirm("chats")}
        />
        {provider && settings.keySaved[provider] ? (
          <ListRow
            icon="key-outline"
            destructive
            title={t("data.deleteKey", { provider: providerName })}
            onPress={() => setConfirm("key")}
          />
        ) : null}
        {hostedConsentOk(settings) ? (
          <ListRow
            icon="shield-outline"
            destructive
            title={t("data.withdraw")}
            onPress={() => setConfirm("hostedConsent")}
          />
        ) : null}
        <ListRow
          icon="trash-outline"
          destructive
          title={t("data.deleteAll")}
          onPress={() => setConfirm("all")}
        />
      </ListGroup>

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={t("engine.pickModel")}
        footer={<Button label={t("model.done")} onPress={() => setPicking(false)} />}
      >
        {provider ? (
          <View style={styles.sheetBody}>
            <ModelPicker
              provider={provider}
              value={modelFor(settings, provider)}
              onChange={(model) => {
                void chooseModel(provider, model);
                toast.info(t("model.saved", { model: model.split("/").pop() }));
              }}
              models={models}
              loading={modelLoading}
              error={modelError}
            />
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={active !== null}
        onClose={() => setConfirm(null)}
        title={active?.title ?? ""}
        message={active?.message ?? ""}
        confirmLabel={active?.button ?? ""}
        cancelLabel={t("chats.cancel")}
        loading={busy}
        onConfirm={() => active && void run(active.run, active.done)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing.md },
  sheetBody: { paddingBottom: theme.spacing.md },
  strong: { fontSize: theme.fontSize.base, fontWeight: "700" },
  small: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  danger: { color: theme.colors.destructive },
}));
