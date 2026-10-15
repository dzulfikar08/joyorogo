import { Ionicons } from "@expo/vector-icons";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import type { LocationStatus } from "@/src/lib/location";

const HINT: Record<LocationStatus, string> = {
  off: "Mati secara bawaan. Cuma kamu yang bisa lihat, dan bisa kamu hapus kapan saja.",
  locating: "Mencari lokasimu...",
  ready: "Lokasi didapat. Disimpan sekitar 100 m saja, cuma kamu yang lihat.",
  denied: "Izin lokasi ditolak. Izinkan dulu lewat pengaturan aplikasi.",
  unavailable: "Lokasi belum bisa didapat. Piring tetap tersimpan tanpa lokasi.",
};

/** Opt-in switch under the place field; state comes from usePlaceLocation(). */
export function SaveLocationToggle({
  enabled,
  status,
  onChange,
}: {
  enabled: boolean;
  status: LocationStatus;
  onChange: (on: boolean) => void;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Ionicons name="location" size={18} color={theme.colors.makanText} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Simpan lokasi tempat makan</Text>
        <Text style={styles.hint}>{HINT[enabled ? status : "off"]}</Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
        thumbColor={theme.colors.background}
        accessibilityLabel="Simpan lokasi tempat makan"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
}));
