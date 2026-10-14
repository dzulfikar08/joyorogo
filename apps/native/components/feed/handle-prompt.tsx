import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Chip, Input, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";

/**
 * Kartu sekali tampil untuk pengguna yang masih memakai handle sementara
 * (jr-xxxxxxxx). Cek ketersediaan langsung ke server; penutupan disimpan di
 * perangkat ini (SecureStore, per akun) supaya tidak muncul lagi.
 */
export function HandlePrompt() {
  const { theme } = useUnistyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const profile = useQuery(orpc.social.myProfile.queryOptions());
  const [dismissed, setDismissed] = useState(true);
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");

  const needsPrompt = profile.data?.handleIsPlaceholder === true;
  const storeKey = `joyorogo.handlePrompt.${userId}`;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    SecureStore.getItemAsync(storeKey)
      .then((stored) => {
        if (live) setDismissed(stored === "1");
      })
      .catch(() => {
        if (live) setDismissed(false);
      });
    return () => {
      live = false;
    };
  }, [userId, storeKey]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim().toLowerCase()), 350);
    return () => clearTimeout(timer);
  }, [value]);

  const suggestions = useQuery({
    ...orpc.social.handleSuggestions.queryOptions(),
    enabled: needsPrompt && !dismissed,
    staleTime: 5 * 60 * 1000,
  });
  const check = useQuery({
    ...orpc.social.handleCheck.queryOptions({ input: { handle: debounced } }),
    enabled: needsPrompt && !dismissed && debounced.length > 0,
  });

  const save = useMutation({
    mutationFn: (handle: string) => client.social.updateProfile({ handle }),
    onSuccess: async () => {
      toast.success("Nama pengguna tersimpan");
      await queryClient.invalidateQueries({ queryKey: orpc.social.key() });
    },
    onError: (error) => toast.error("Gagal menyimpan", errorMessage(error)),
  });

  if (!needsPrompt || dismissed) return null;

  const clean = value.trim().toLowerCase();
  const settled = clean.length > 0 && clean === debounced && !check.isFetching;
  const status = settled ? check.data : undefined;
  const canSave = status?.status === "free";

  const dismiss = () => {
    setDismissed(true);
    void SecureStore.setItemAsync(storeKey, "1").catch(() => undefined);
  };

  const statusText =
    clean.length === 0
      ? ""
      : !settled
        ? "Mengecek..."
        : status?.status === "free"
          ? "Tersedia"
          : status?.status === "own"
            ? "Ini sudah jadi namamu."
            : (status?.message ?? "");
  const statusColor =
    status?.status === "free"
      ? theme.colors.makanText
      : status
        ? theme.colors.destructive
        : theme.colors.mutedForeground;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Pilih nama pengguna</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tutup"
          hitSlop={10}
          onPress={dismiss}
        >
          <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
        </Pressable>
      </View>
      <Text style={styles.body}>
        Namamu di feed masih sementara ({profile.data?.handle}). Pilih yang kamu suka, ini jadi
        tautan profilmu.
      </Text>
      <Input
        value={value}
        onChangeText={(text) => setValue(text.toLowerCase())}
        maxLength={20}
        placeholder="mis. budi_olahraga"
        accessibilityLabel="Nama pengguna"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={[styles.status, { color: statusColor }]} accessibilityLiveRegion="polite">
        {statusText}
      </Text>
      {suggestions.data && suggestions.data.suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.data.suggestions.map((suggestion) => (
            <Chip
              key={suggestion}
              label={`@${suggestion}`}
              selected={clean === suggestion}
              onPress={() => setValue(suggestion)}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={save.isPending ? "Menyimpan..." : "Simpan"}
          onPress={() => save.mutate(clean)}
          disabled={!canSave}
          loading={save.isPending}
          style={styles.save}
        />
        <Button variant="ghost" label="Nanti saja" onPress={dismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  status: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    minHeight: 20,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  save: {
    flex: 1,
  },
}));
