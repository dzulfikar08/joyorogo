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
import { UNDO_TOAST_MS } from "@joyorogo/api/lib/optimistic";

type ToastKind = "success" | "error" | "info";

type ToastAction = { label: string; onPress: () => void };

type ToastState = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: ToastAction;
};

type ToastApi = {
  success: (title: string, message?: string, action?: ToastAction) => void;
  error: (title: string, message?: string, action?: ToastAction) => void;
  info: (title: string, message?: string, action?: ToastAction) => void;
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

  const show = useCallback((kind: ToastKind, title: string, message?: string, action?: ToastAction) => {
    clearTimeout(timer.current);
    Vibration.vibrate(8);
    setToast({ id: Date.now(), kind, title, message, action });
    // An undoable toast needs the whole undo window; plain ones stay snappy.
    timer.current = setTimeout(
      () => setToast(null),
      action ? UNDO_TOAST_MS : AUTO_DISMISS_MS,
    );
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, message, action) => show("success", title, message, action),
      error: (title, message, action) => show("error", title, message, action),
      info: (title, message, action) => show("info", title, message, action),
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
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              onPress={() => {
                onDismiss();
                toast.action?.onPress();
              }}
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            >
              <Text style={styles.actionLabel}>{toast.action.label}</Text>
            </Pressable>
          ) : null}
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
  actionButton: {
    backgroundColor: theme.colors.makanSoft,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
  },
  actionLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
}));
