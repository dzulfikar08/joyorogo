// Ported from JoyoFit (watch-fit) src/features/ai/ui/SetupScreen.tsx, adapted for JoyoRogo.
import "@/unistyles";

import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  hostOf,
  isInsecureRemote,
  normalizeBaseUrl,
  PROVIDER_ORDER,
  PROVIDERS,
} from "@joyorogo/api/lib/joyo-ai/providers";
import { modelFor } from "@joyorogo/api/lib/joyo-ai/settings";
import type { ModelInfo, ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

import { AiErrorNotice } from "@/components/joyo/ai-error-notice";
import { ConsentCard } from "@/components/joyo/consent-card";
import { ModelPicker } from "@/components/joyo/model-picker";
import { Notice } from "@/components/joyo/notice";
import { SwitchRow } from "@/components/joyo/switch-row";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  Chip,
  Field,
  Input,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
} from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { connectProvider, testProvider, type TestResult } from "@/src/lib/joyo-ai/engine";
import { viewAiError, type AiErrorView } from "@/src/lib/joyo-ai/error-view";
import { useJoyoState } from "@/src/lib/joyo-ai/hooks";
import { cleanPastedKey, maskKey } from "@/src/lib/joyo-ai/key-vault";
import { joyoVault } from "@/src/lib/joyo-ai/stores";

/** How long the saved confirmation shows before the screen closes. */
const SAVED_MS = 900;

type TestOk = Extract<TestResult, { ok: true }>;

/** "Atur kunci sendiri": provider, key, model, the test, and the consent, then save. Under 18 there is nothing to set up. */
export default function JoyoSetupScreen() {
  const { t } = useTranslation("joyoAiApp");
  const { loaded, access } = useJoyoState();
  if (!loaded || access === null) {
    return (
      <Screen>
        <PageHeader title={t("setup.title")} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (!access.ok && access.reason === "minor") {
    return (
      <Screen>
        <PageHeader title={t("setup.title")} />
        <Card style={styles.stack}>
          <Text style={styles.cardTitle}>{t("gate.minor.title")}</Text>
          <Text style={styles.small}>{t("gate.minor.body")}</Text>
          <Button label={t("setup.back")} onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }
  return <SetupForm />;
}

function SetupForm() {
  const { t } = useTranslation("joyoAiApp");
  const { t: tj } = useTranslation("joyoAi");
  const { settings } = useJoyoState();
  const toast = useToast();

  const [provider, setProvider] = useState<ProviderId>(settings.provider ?? "openrouter");
  const [baseUrl, setBaseUrl] = useState(settings.customBaseUrl);
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [pasteEmpty, setPasteEmpty] = useState(false);
  const [stored, setStored] = useState<{ provider: ProviderId; mask: string | null } | null>(null);
  const [model, setModel] = useState(() => modelFor(settings, settings.provider ?? "openrouter"));
  const [models, setModels] = useState<readonly ModelInfo[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ snap: string; ok: TestOk } | null>(null);
  const [testError, setTestError] = useState<AiErrorView | null>(null);
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const preset = PROVIDERS[provider];
  const name = tj(`provider.${provider}`);
  const keySavedFlag = settings.keySaved[provider] === true;

  const mounted = useRef(true);
  const testCtl = useRef<AbortController | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      testCtl.current?.abort();
      clearTimeout(closeTimer.current);
    };
  }, []);

  // The saved key is shown masked, never in full: read it only to mask it.
  useEffect(() => {
    if (!keySavedFlag) return;
    let cancelled = false;
    joyoVault
      .get(provider)
      .then((value) => {
        if (!cancelled) setStored({ provider, mask: value ? maskKey(value) : null });
      })
      .catch(() => {
        if (!cancelled) setStored({ provider, mask: null });
      });
    return () => {
      cancelled = true;
    };
  }, [provider, keySavedFlag]);

  const savedMask = keySavedFlag && stored?.provider === provider ? stored.mask : null;
  const usingSaved = savedMask !== null && !replacing;
  const typedKey = cleanPastedKey(key);
  const keyReady = usingSaved || typedKey.length > 0;

  const endpoint = preset.customUrl ? normalizeBaseUrl(baseUrl) : preset.baseUrl;
  const urlError =
    !preset.customUrl || baseUrl.trim() === ""
      ? null
      : endpoint === null
        ? t("setup.url.invalid")
        : isInsecureRemote(endpoint)
          ? t("setup.url.insecure")
          : null;
  const urlReady = endpoint !== null && !isInsecureRemote(endpoint);
  const modelReady = model.trim().length > 0;

  const snapOf = (m: string) =>
    `${provider}|${endpoint ?? ""}|${usingSaved ? "saved" : typedKey}|${m.trim()}`;
  const testedNow = tested !== null && tested.snap === snapOf(model) ? tested.ok : null;

  const choose = (next: ProviderId) => {
    if (next === provider) return;
    testCtl.current?.abort();
    setProvider(next);
    setKey("");
    setReplacing(false);
    setPasteEmpty(false);
    setBaseUrl(PROVIDERS[next].customUrl ? settings.customBaseUrl : "");
    setModel(modelFor(settings, next));
    setModels(null);
    setTested(null);
    setTestError(null);
    setSaveFailed(false);
    setAgree(false);
  };

  const paste = async () => {
    const raw = await Clipboard.getStringAsync().catch(() => "");
    const clean = cleanPastedKey(raw);
    setPasteEmpty(clean.length === 0);
    if (clean.length > 0) setKey(clean);
  };

  const currentKey = async (): Promise<string | null> =>
    usingSaved ? joyoVault.get(provider) : typedKey || null;

  /** The connection test with the key on screen or the saved one: lists the models, sends one tiny message. Returns the result when it passed. */
  const runTest = async (): Promise<TestOk | null> => {
    const apiKey = await currentKey();
    if (!apiKey || endpoint === null) return null;
    testCtl.current?.abort();
    const ctl = new AbortController();
    testCtl.current = ctl;
    setTesting(true);
    setTestError(null);
    setSaveFailed(false);
    try {
      const result = await testProvider({
        provider,
        baseUrl: endpoint,
        apiKey,
        model: model.trim() || null,
        signal: ctl.signal,
      });
      if (ctl.signal.aborted || !mounted.current) return null;
      if (result.ok) {
        if (result.models.length > 0) setModels(result.models);
        setModel(result.model);
        setTested({ snap: snapOf(result.model), ok: result });
        return result;
      }
      setTested(null);
      setTestError(viewAiError(result.error, { provider, ceiling: settings.dailyCeiling }));
      return null;
    } catch {
      if (!ctl.signal.aborted && mounted.current) {
        setTested(null);
        setTestError(viewAiError(null, { provider, ceiling: settings.dailyCeiling }));
      }
      return null;
    } finally {
      if (testCtl.current === ctl) testCtl.current = null;
      if (mounted.current) setTesting(false);
    }
  };

  const busy = testing || saving;
  const canSubmit = keyReady && urlReady && modelReady && adult && agree && !busy && !saved;

  const submit = async () => {
    if (!canSubmit || endpoint === null) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = testedNow ?? (await runTest());
      if (!result || !mounted.current) return;
      const apiKey = await currentKey();
      if (!apiKey) return;
      await connectProvider({ provider, baseUrl: endpoint, apiKey, model: result.model });
      if (!mounted.current) return;
      setKey("");
      setSaved(true);
      toast.success(t("setup.saved"));
      closeTimer.current = setTimeout(() => router.back(), SAVED_MS);
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {saveFailed ? <Notice tone="danger">{t("setup.saveFailed")}</Notice> : null}
          {!canSubmit && !busy && !saved ? (
            <Text style={styles.small}>{t("setup.needs")}</Text>
          ) : null}
          <Button
            label={
              saved ? t("setup.savedLabel") : testedNow ? t("setup.save") : t("setup.testSave")
            }
            icon="checkmark"
            disabled={!canSubmit}
            loading={busy}
            onPress={() => void submit()}
          />
        </View>
      }
    >
      <PageHeader title={t("setup.title")} caption={t("setup.intro")} />

      <SectionTitle title={t("setup.step1")} />
      <Card style={styles.stack}>
        <View style={styles.chips}>
          {PROVIDER_ORDER.map((id) => (
            <Chip
              key={id}
              label={tj(`provider.${id}`)}
              selected={id === provider}
              onPress={() => choose(id)}
            />
          ))}
        </View>
        <Text style={styles.small}>{t(`setup.hint.${provider}`)}</Text>
        {preset.customUrl ? (
          <Field label={t("setup.url.label")} hint={urlError ?? t("setup.url.hint")}>
            <Input
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={t("setup.url.placeholder")}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("setup.url.label")}
            />
          </Field>
        ) : null}
        {urlError ? <Notice tone="danger">{urlError}</Notice> : null}
      </Card>

      <SectionTitle title={t("setup.step2")} />
      <Card style={styles.stack}>
        {usingSaved ? (
          <View style={styles.savedRow}>
            <Text style={styles.strong}>{t("setup.key.saved", { masked: savedMask })}</Text>
            <Button
              size="sm"
              variant="secondary"
              label={t("setup.key.replace")}
              onPress={() => setReplacing(true)}
            />
          </View>
        ) : (
          <View style={styles.keyRow}>
            <View style={styles.grow}>
              <Input
                value={key}
                onChangeText={(v) => {
                  setKey(v);
                  setPasteEmpty(false);
                }}
                placeholder={preset.keyPlaceholder}
                accessibilityLabel={t("setup.key.label")}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                spellCheck={false}
              />
            </View>
            <Button
              size="sm"
              variant="secondary"
              icon="clipboard-outline"
              label={t("setup.key.paste")}
              onPress={() => void paste()}
            />
          </View>
        )}
        {pasteEmpty ? (
          <Text style={[styles.small, styles.danger]}>{t("setup.key.pasteEmpty")}</Text>
        ) : null}
        {replacing && savedMask !== null ? (
          <Button
            label={t("setup.key.keepSaved")}
            variant="ghost"
            size="sm"
            onPress={() => {
              setReplacing(false);
              setKey("");
            }}
          />
        ) : null}
        {preset.keyUrl ? (
          <Button
            label={t("setup.key.open", { provider: name })}
            variant="ghost"
            size="sm"
            icon="open-outline"
            onPress={() => void Linking.openURL(preset.keyUrl!).catch(() => {})}
          />
        ) : null}
        <Text style={styles.small}>{t("setup.key.tip")}</Text>
        <Disclosure title={t("setup.key.revokeTitle")} plain>
          <Text style={styles.small}>{t("setup.key.revoke")}</Text>
        </Disclosure>

        <ModelPicker provider={provider} value={model} onChange={setModel} models={models} />

        <Button
          label={t("setup.test.run")}
          variant="secondary"
          icon="pulse-outline"
          loading={testing}
          disabled={!keyReady || !urlReady || !modelReady || saving}
          onPress={() => void runTest()}
        />
        {testedNow ? (
          <Text accessibilityLiveRegion="polite" style={styles.strong}>
            {t("setup.test.ok", { count: testedNow.calls })}
          </Text>
        ) : null}
        {testError ? <AiErrorNotice view={testError} provider={provider} /> : null}
        <Text style={styles.small}>{t("setup.test.hint")}</Text>
      </Card>

      <SectionTitle title={t("setup.step3")} />
      <Card style={styles.stack}>
        {preset.freeTierTrainsOnData ? (
          <Notice tone="danger" icon="warning-outline">
            {t("consent.gemini")}
          </Notice>
        ) : null}
        <ConsentCard
          recipient={t("consent.ownRecipient", {
            provider: name,
            host: endpoint ? hostOf(endpoint) : t("consent.noHost"),
          })}
          termsProvider={name}
          onSample={() => router.push("/joyo-data")}
        />
        <View>
          <SwitchRow label={t("consent.adult")} value={adult} onValueChange={setAdult} />
          <SwitchRow
            label={t("consent.agree", { provider: name })}
            value={agree}
            onValueChange={setAgree}
          />
        </View>
        <Text style={styles.small}>{t("consent.withdraw")}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing.md },
  cardTitle: { fontSize: theme.fontSize.lg, fontWeight: "700" },
  strong: { fontSize: theme.fontSize.base, fontWeight: "700" },
  small: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  danger: { color: theme.colors.destructive },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  keyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    justifyContent: "space-between",
  },
  grow: { flex: 1 },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
}));
