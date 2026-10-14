import { Link, Stack } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Container } from "@/components/container";
import { Mascot } from "@/components/mascot";
import { Text } from "@/components/ui";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Halaman tidak ditemukan" }} />
      <Container>
        <View style={styles.container}>
          <View style={styles.content}>
            <Mascot pose="peek" size="xl" style={styles.mascot} />
            <Text style={styles.title}>Halaman tidak ditemukan</Text>
            <Text style={styles.description}>
              Halaman yang kamu cari tidak ada atau sudah dipindah. Yuk kembali ke Beranda.
            </Text>
            <Link href="/" style={styles.button}>
              <Text style={styles.buttonText}>Ke Beranda</Text>
            </Link>
          </View>
        </View>
      </Container>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  content: {
    alignItems: "center",
  },
  mascot: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
    textAlign: "center",
  },
  description: {
    color: theme.colors.mutedForeground,
    textAlign: "center",
    marginBottom: theme.spacing.xl,
    maxWidth: 280,
    lineHeight: 22,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: theme.colors.primaryForeground,
    fontWeight: "600",
  },
}));
