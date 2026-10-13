import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

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
        <PageHeader title="Grup" />
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
      setFormError("Tempel kode atau tautan undangannya dulu, ya.");
      return;
    }
    setFormError(null);
    join.mutate({ code: invite });
  };

  const groups = listQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Grup" }} />
      <Screen>
      <PageHeader
        title="Grup"
        caption="Semangat bareng teman — colek yang kemakan terus"
      />

      {listQuery.isError ? (
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      ) : listQuery.isPending ? (
        <Skeleton width="100%" height={180} radius={24} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="Belum ada grup"
          description="Buat grup sendiri atau gabung pakai kode undangan teman biar semangatnya bareng."
        />
      ) : (
        <ListGroup>
          {groups.map((group) => (
            <ListRow
              key={group.id}
              icon="people"
              iconTint="makan"
              title={group.name}
              subtitle={`${group.memberCount} anggota${group.role === "owner" ? " • kamu pemilik" : ""}`}
              chevron
              onPress={() => router.push(`/grup/${group.id}`)}
            />
          ))}
        </ListGroup>
      )}

      <View style={styles.actions}>
        <Button
          label="Buat Grup"
          icon="add"
          onPress={() => {
            setFormError(null);
            setCreateOpen(true);
          }}
        />
        <Button
          variant="secondary"
          label="Gabung dengan Kode"
          icon="keypad"
          onPress={() => {
            setFormError(null);
            setJoinOpen(true);
          }}
        />
      </View>

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat Grup"
        footer={
          <Button
            label="Buat Grup"
            disabled={name.trim().length === 0}
            loading={create.isPending}
            onPress={() => create.mutate({ name: name.trim() })}
          />
        }
      >
        <Field label="Nama grup" hint="1–40 huruf, bebas kreasinya.">
          <Input
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholder="mis. Tim Sehat Kampus"
          />
        </Field>
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      </Sheet>

      <Sheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Gabung Grup"
        footer={
          <Button label="Gabung" loading={join.isPending} onPress={submitJoin} />
        }
      >
        <Field label="Kode undangan" hint="Tempel kode atau tautan undangannya di sini.">
          <Input
            value={code}
            onChangeText={(text) => {
              setCode(text);
              setFormError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="mis. ABC123 atau tautan undangan"
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
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  formError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
