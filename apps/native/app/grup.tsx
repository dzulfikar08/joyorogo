import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Disclosure } from "@/components/disclosure";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { extractInviteCode } from "@/src/lib/group";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** Grup list screen: my groups + create / join by invite code. */
export default function GrupList() {
  const { t } = useTranslation("grup");
  const gate = useSessionGate();
  const listQuery = useQuery(orpc.group.list.queryOptions());

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation(
    orpc.group.create.mutationOptions({
      onSuccess: async (group) => {
        setCreateOpen(false);
        setName("");
        await queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        if (group) router.push(`/grup/${group.id}`);
      },
      onError: (e) => setFormError(errorMessage(e)),
    }),
  );

  const join = useMutation(
    orpc.group.join.mutationOptions({
      onSuccess: async (res) => {
        setJoinOpen(false);
        setCode("");
        await queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        router.push(`/grup/${res.groupId}`);
      },
      onError: (e) => setFormError(errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("list.title")} />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={180} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const submitJoin = () => {
    const invite = extractInviteCode(code);
    if (invite === "") {
      setFormError(t("join.pasteFirst"));
      return;
    }
    setFormError(null);
    join.mutate({ code: invite });
  };

  const groups = listQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("list.title") }} />
      <Screen>
      <PageHeader
        title={t("list.title")}
        caption={t("list.subtitle")}
      />

      {listQuery.isError ? (
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      ) : listQuery.isPending ? (
        <Skeleton width="100%" height={180} radius={24} />
      ) : groups.length === 0 ? (
        <EmptyState
          pose="cheer"
          title={t("list.empty.title")}
          description={t("list.empty.body")}
        />
      ) : (
        <ListGroup>
          {groups.map((group) => (
            <ListRow
              key={group.id}
              icon="people"
              iconTint="makan"
              title={group.name}
              subtitle={group.role === "owner" ? t("list.row.owner", { count: group.memberCount }) : t("members", { count: group.memberCount })}
              chevron
              onPress={() => router.push(`/grup/${group.id}`)}
            />
          ))}
        </ListGroup>
      )}

      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={t("list.create")}
            icon="add"
            onPress={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
          />
        </View>
        <View style={styles.action}>
          <Button
            variant="secondary"
            label={t("list.join")}
            icon="keypad"
            onPress={() => {
              setFormError(null);
              setJoinOpen(true);
            }}
          />
        </View>
      </View>

      <Disclosure title={t("how.title")}>
        <Text style={styles.how}>{t("how.body")}</Text>
      </Disclosure>

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("create.title")}
        footer={
          <Button
            label={t("create.title")}
            disabled={name.trim().length === 0}
            loading={create.isPending}
            onPress={() => create.mutate({ name: name.trim() })}
          />
        }
      >
        <Field label={t("create.nameLabel")} hint={t("create.nameHint")}>
          <Input
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholder={t("create.namePlaceholder")}
          />
        </Field>
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      </Sheet>

      <Sheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        title={t("join.title")}
        footer={
          <Button label={t("join.submit")} loading={join.isPending} onPress={submitJoin} />
        }
      >
        <Field label={t("join.codeLabel")} hint={t("join.codeHint")}>
          <Input
            value={code}
            onChangeText={(text) => {
              setCode(text);
              setFormError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("join.linkPlaceholder")}
          />
        </Field>
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      </Sheet>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  action: {
    flex: 1,
  },
  how: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  formError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
