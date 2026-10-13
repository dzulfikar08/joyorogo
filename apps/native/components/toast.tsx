import { Ionicons } from "@expo/vector-icons";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  SlideInUp,
  SlideOutUp,
  useReducedMotion,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

type ToastKind = "success" | "error" | "info";

type ToastState = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
};

type ToastApi = {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 2600;

const KIND_ICONS = {
  success: "checkmark-circle",
  error: "warning",
  info: "information-circle",
} as const;

const KIND_TONES = {
  success: "makan",
  error: "bakar",
  info: "tidur",
} as const;

/**
 * In-app feedback toasts: slides in from the top, auto-dismisses, tap to
 * close. Replaces Alert.alert for non-destructive success/error feedback.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((kind: ToastKind, title: string, message?: string) => {
    clearTimeout(timer.current);
    Vibration.vibrate(8);
    setToast({ id: Date.now(), kind, title, message });
    timer.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, message) => show("success", title, message),
      error: (title, message) => show("error", title, message),
      info: (title, message) => show("info", title, message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastView toast={toast} topInset={insets.top} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Feedback handle: toast.success/error/info(title, message?). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast harus dipakai di dalam ToastProvider.");
  }
  return ctx;
}

function ToastView({
  toast,
  topInset,
  onDismiss,
}: {
  toast: ToastState | null;
  topInset: number;
  onDismiss: () => void;
}) {
  const { theme } = useUnistyles();
  const reduceMotion = useReducedMotion();
  if (toast === null) return null;
  const tone = KIND_TONES[toast.kind];

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: topInset + 8 }]}>
      <Animated.View
        key={toast.id}
        entering={reduceMotion ? undefined : SlideInUp.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutUp.duration(180)}
        style={[styles.card, { borderColor: theme.colors.hairline }]}
      >
        <Pressable
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${toast.title}${toast.message ? `. ${toast.message}` : ""}`}
          onPress={onDismiss}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View
            style={[styles.chip, { backgroundColor: theme.colors[`${tone}Soft`] }]}
          >
            <Ionicons
              name={KIND_ICONS[toast.kind]}
              size={18}
              color={theme.colors[`${tone}Text`]}
            />
          </View>
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1}>
              {toast.title}
            </Text>
            {toast.message ? (
              <Text style={styles.message} numberOfLines={2}>
                {toast.message}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    backgroundColor: theme.colors.card,
    shadowColor: "#1D1A15",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  chip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  message: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
