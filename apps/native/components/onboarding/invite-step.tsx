import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Share, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Card, Field, Input, Text } from "@/components/ui";
import { Mascot } from "@/components/mascot";
import { useToast } from "@/components/toast";
import { inviteMessage } from "@/src/lib/group";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type CreatedGroup = { id: string; name: string; inviteCode: string };

/**
 * Optional step after the plan-ready screen: start a group and send its
 * invite, or share one the person already belongs to. Reuses group.create,
 * the group list and the same invite message as the group screen. Never
 * gates anything; "Lewati" goes straight on.
 */
export function InviteFriendsStep({
  defaultName,
  onSkip,
  onOpenGroup,
}: {
  defaultName: string;
  /** Leaves the step; the caller continues to the app. */
  onSkip: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [created, setCreated] = useState<CreatedGroup | null>(null);
  const groups = useQuery(orpc.group.list.queryOptions());

  const create = useMutation(
    orpc.group.create.mutationOptions({
      onSuccess: (group) => {
        if (!group) return;
        void queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        setCreated({ id: group.id, name: group.name, inviteCode: group.inviteCode });
      },
      onError: (error) => toast.error("Gagal membuat grup", errorMessage(error)),
    }),
  );

  const share = (group: { name: string; inviteCode: string }) => {
    Share.share({ message: inviteMessage(group.name, group.inviteCode) }).catch(() => {
      // Dismissing the share sheet is not an error.
    });
  };

  const trimmed = name.trim();
  const existing = groups.data ?? [];

  return (
    <>
      <Mascot pose="cheer" size="md" style={styles.mascot} />
      <Text style={styles.title}>{created ? "Grupmu sudah jadi" : "Ajak teman"}</Text>
      <Text style={styles.caption}>
        {created
          ? "Kirim undangannya sekarang, teman yang gabung langsung kelihatan di grup."
          : "Catat kalori lebih gampang kalau ada yang ngecek. Bikin grup kecil, kirim tautannya, dan saling colek kalau ada yang lupa."}
      </Text>

      {created ? (
        <>
          <Card>
            <Text style={styles.groupName}>{created.name}</Text>
            <Text style={styles.caption}>Kode {created.inviteCode}</Text>
          </Card>
          <Button label="Bagikan undangan" icon="share-outline" onPress={() => share(created)} />
          <Button
            variant="secondary"
            label="Buka grup"
            onPress={() => onOpenGroup(created.id)}
          />
          <Button variant="ghost" label="Nanti saja, ke Beranda" onPress={onSkip} />
        </>
      ) : (
        <>
          <Field label="Nama grup">
            <Input value={name} onChangeText={setName} maxLength={40} />
          </Field>
          <Button
            label="Buat grup"
            disabled={trimmed.length === 0}
            loading={create.isPending}
            onPress={() => create.mutate({ name: trimmed })}
          />
          {existing.length > 0 ? (
            <View style={styles.existing}>
              <Text style={styles.caption}>Atau bagikan grup yang sudah kamu ikuti</Text>
              {existing.slice(0, 3).map((group) => (
                <View key={group.id} style={styles.existingRow}>
                  <Text style={styles.existingName} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Bagikan"
                    onPress={() => share(group)}
                  />
                </View>
              ))}
            </View>
          ) : null}
          <Button variant="ghost" label="Lewati, ke Beranda" onPress={onSkip} />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  mascot: {
    alignSelf: "center",
  },
  title: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  groupName: {
    fontSize: theme.fontSize.base,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  existing: {
    gap: theme.spacing.sm,
  },
  existingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  existingName: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
}));
