import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";
import React, { Fragment, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  Text as RNText,
  StyleSheet as RNStyleSheet,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { ComponentProps } from "react";
import { Circle, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { darkTheme, lightTheme } from "@/theme";

import { Container } from "@/components/container";

// JoyoRogo v2 kit. Paper canvas, borderless white cards, one leaf-green
// primary; the data colors (makan/bakar/tidur) only ever tell the three
// daily numbers apart. Shadows exist only on things that float (nav, FAB,
// sheets). Numbers are Plus Jakarta Sans tabular.

/** App theme contract, owned by theme.ts and registered in unistyles.ts. */
export type AppTheme = typeof lightTheme | typeof darkTheme;
type Fonts = AppTheme["fonts"];
export type Tint = "makan" | "bakar" | "tidur";
type IconName = ComponentProps<typeof Ionicons>["name"];

// --- Type ------------------------------------------------------------------

/** Maps a requested fontWeight onto the matching loaded Jakarta family. */
function familyForWeight(fonts: Fonts, weight: TextStyle["fontWeight"]): string {
  const w = weight == null ? "500" : String(weight);
  if (w === "600") return fonts.medium;
  if (w === "700" || w === "bold") return fonts.bold;
  if (w === "800") return fonts.heavy;
  return fonts.regular;
}

function fontTheme(theme: Fonts, style: TextProps["style"]): TextStyle {
  const flat = (RNStyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return flat;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: familyForWeight(theme, fontWeight) };
}

/** The default text: Plus Jakarta Sans, weight from `fontWeight` style. */
export function Text({ style, ...rest }: TextProps) {
  const { theme } = useUnistyles();
  return <RNText style={fontTheme(theme.fonts, style)} {...rest} />;
}

/** Numeric text: tabular figures so dials never jitter. Defaults to bold. */
export function Num({ style, ...rest }: TextProps) {
  const { theme } = useUnistyles();
  const base = fontTheme(theme.fonts, style);
  const styled: TextStyle = {
    ...base,
    fontVariant: base.fontVariant?.includes("tabular-nums")
      ? base.fontVariant
      : [...(base.fontVariant ?? []), "tabular-nums"],
  };
  return <RNText style={styled} {...rest} />;
}

// --- Layout ----------------------------------------------------------------

/** Scrollable page on paper: 20px gutters, 12px between related cards. */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <Container>
      <ScrollView
        contentContainerStyle={[styles.screenContent, style]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Container>
  );
}

/** Big 28px bold page title with an optional right-hand action. */
export function PageHeader({
  title,
  right,
  caption,
}: {
  title: string;
  right?: React.ReactNode;
  caption?: string;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <Text style={styles.pageTitle}>{title}</Text>
        {caption ? <Text style={styles.pageCaption}>{caption}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** 16px semibold section label with optional right action link. */
export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={8}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressedSoft]}
        >
          <Text style={styles.sectionActionLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Borderless white card, radius 24, padding 20. No shadow: it sits flat. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Initial-letter circle (Beranda greeting → /profil). */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const { theme } = useUnistyles();
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <View
      accessibilityLabel={`Avatar ${name}`}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text
        style={{
          color: theme.colors.makanText,
          fontSize: size * 0.42,
          fontWeight: "700",
          lineHeight: size * 0.5,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

// --- Ring ------------------------------------------------------------------

/** One-shot animated SVG progress ring; static under reduced motion. */
export function Ring({
  size,
  stroke = 12,
  value,
  max,
  color,
  track,
  children,
}: {
  size: number;
  stroke?: number;
  value: number;
  max: number;
  color: string;
  track: string;
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const progress = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = progress.addListener(({ value: v }) => setShown(v));
    return () => progress.removeListener(id);
  }, [progress]);

  useEffect(() => {
    if (reduceMotion) {
      progress.stopAnimation();
      setShown(ratio);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: ratio,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, ratio, reduceMotion]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const half = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={half}
          cy={half}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${half} ${half})`}
        />
      </Svg>
      {children ? (
        <View style={[StyleSheet.absoluteFill, styles.ringCenter]} pointerEvents="none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

// --- StatTile --------------------------------------------------------------

const TINT_COLORS = {
  makan: { soft: "makanSoft", text: "makanText", icon: "makan" },
  bakar: { soft: "bakarSoft", text: "bakarText", icon: "bakar" },
  tidur: { soft: "tidurSoft", text: "tidurText", icon: "tidur" },
} as const;

/** Soft-tinted tile for one daily number. Tappable → detail page. */
export function StatTile({
  icon,
  tint,
  label,
  value,
  sub,
  onPress,
}: {
  icon: IconName;
  tint: Tint;
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
}) {
  const { theme } = useUnistyles();
  const c = TINT_COLORS[tint];
  const body = (
    <>
      <View style={styles.tileChip}>
        <Ionicons name={icon} size={15} color={theme.colors[c.icon]} />
      </View>
      <Text style={[styles.tileLabel, { color: theme.colors[c.text] }]}>{label}</Text>
      <Num style={[styles.tileValue, { color: theme.colors[c.text] }]}>{value}</Num>
      {sub ? <Text style={[styles.tileSub, { color: theme.colors[c.text] }]}>{sub}</Text> : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.statTile, { backgroundColor: theme.colors[c.soft] }]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statTile,
        { backgroundColor: theme.colors[c.soft] },
        pressed && styles.pressedSoft,
      ]}
    >
      {body}
    </Pressable>
  );
}

// --- Lists -----------------------------------------------------------------

/** iOS-settings-style grouped rows inside one card, hairline separators. */
export function ListGroup({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.listGroup, style]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {child}
          {i < items.length - 1 ? <View style={styles.listSeparator} /> : null}
        </Fragment>
      ))}
    </View>
  );
}

/** 52px-min grouped row: icon chip, title/subtitle, value, chevron. */
export function ListRow({
  icon,
  iconTint,
  thumb,
  title,
  subtitle,
  value,
  chevron,
  destructive,
  onPress,
  right,
}: {
  icon?: IconName;
  iconTint?: Tint | "muted";
  thumb?: React.ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  const tintColors = iconTint && iconTint !== "muted" ? TINT_COLORS[iconTint] : null;
  const content = (
    <>
      {thumb ? (
        thumb
      ) : icon ? (
        <View
          style={[
            styles.rowChip,
            { backgroundColor: tintColors ? theme.colors[tintColors.soft] : theme.colors.muted },
          ]}
        >
          <Ionicons
            name={icon}
            size={16}
            color={tintColors ? theme.colors[tintColors.icon] : theme.colors.mutedForeground}
          />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, destructive && { color: theme.colors.destructive }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Num style={styles.rowValue}>{value}</Num> : null}
      {right}
      {chevron ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
      ) : null}
    </>
  );
  if (!onPress) {
    return <View style={styles.listRow}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressedSoft]}
    >
      {content}
    </Pressable>
  );
}

// --- Sheet -----------------------------------------------------------------

/** Bottom sheet (RN Modal, slide) hosting every add/edit form. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityLabel="Tutup"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.sheetBackdrop} />
        </Pressable>
        <View style={[styles.sheetPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tutup"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressedSoft]}
            >
              <Ionicons name="close" size={22} color={theme.colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

// --- Segmented -------------------------------------------------------------

/** Pill segmented control for meal slot / theme / range choices. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segmented, disabled && styles.disabled]} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segmentOption,
              active && styles.segmentOptionActive,
              pressed && !active && styles.pressedSoft,
            ]}
          >
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Buttons ---------------------------------------------------------------

export function Button({
  variant = "primary",
  label,
  onPress,
  disabled,
  loading,
  destructive,
  size = "lg",
  icon,
  style,
}: {
  variant?: "primary" | "secondary" | "ghost";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
  size?: "lg" | "sm";
  icon?: IconName;
  style?: ViewStyle;
}) {
  const { theme } = useUnistyles();
  const inactive = disabled || loading;
  const bg =
    variant === "primary"
      ? destructive
        ? theme.colors.destructive
        : theme.colors.primary
      : variant === "secondary"
        ? theme.colors.muted
        : "transparent";
  const fg =
    variant === "primary"
      ? theme.colors.primaryForeground
      : destructive
        ? theme.colors.destructive
        : variant === "secondary"
          ? theme.colors.foreground
          : theme.colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "lg" ? styles.buttonLg : styles.buttonSm,
        { backgroundColor: bg },
        variant === "ghost" && { backgroundColor: "transparent" },
        pressed && !inactive && styles.buttonPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === "lg" ? 18 : 15} color={fg} /> : null}
          <Text
            style={[size === "lg" ? styles.buttonLabelLg : styles.buttonLabelSm, { color: fg }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// --- Chip ------------------------------------------------------------------

/** Pill chip for quick-add, ideas, and filters. */
export function Chip({
  label,
  onPress,
  selected,
  disabled,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.colors.foreground : theme.colors.muted },
        (pressed || disabled) && styles.pressedSoft,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: selected ? theme.colors.background : theme.colors.foreground },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// --- Form ------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** 48px borderless input on the muted fill; focus ring in primary. */
export function Input(props: ComponentProps<typeof TextInput>) {
  const { theme } = useUnistyles();
  return (
    <TextInput
      placeholderTextColor={theme.colors.mutedForeground}
      {...props}
      style={[
        styles.input,
        { fontFamily: theme.fonts.regular, color: theme.colors.foreground },
        props.style,
      ]}
    />
  );
}

// --- Loading / states ------------------------------------------------------

/** Shimmer block shaped like the content it stands in for. */
export function Skeleton({
  width,
  height = 14,
  radius,
  circle,
  style,
}: {
  width: number | `${number}%`;
  height?: number;
  radius?: number;
  circle?: boolean;
  style?: ViewStyle;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius: circle ? height / 2 : (radius ?? 8) },
        style,
      ]}
    />
  );
}

/** Minimal boot spinner while the session restores. */
export function BootLoader() {
  const { theme } = useUnistyles();
  return (
    <View style={styles.boot}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.stateBox}>
      <View style={styles.stateIcon}>
        <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.mutedForeground} />
      </View>
      <Text style={styles.stateTitle}>Gagal memuat</Text>
      <Text style={styles.stateText}>{message}</Text>
      <Button variant="secondary" size="sm" label="Coba lagi" onPress={onRetry} />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.stateBox}>
      {icon ? (
        <View style={styles.stateIcon}>
          <Ionicons name={icon} size={22} color={theme.colors.mutedForeground} />
        </View>
      ) : null}
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{description}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screenContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 120,
    gap: theme.spacing.md,
    "@md": {
      maxWidth: 640,
      alignSelf: "center",
      width: "100%",
    },
  },
  pressedSoft: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },

  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  pageHeaderText: {
    flex: 1,
    gap: 2,
  },
  pageTitle: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
  },
  pageCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sectionAction: {
    minHeight: 44,
    justifyContent: "center",
  },
  sectionActionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.primary,
  },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  avatar: {
    backgroundColor: theme.colors.makanSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  ringCenter: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },

  statTile: {
    borderRadius: theme.radius.tile,
    padding: 16,
    gap: 6,
    flex: 1,
    minHeight: 96,
  },
  tileChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  tileValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: "700",
  },
  tileSub: {
    fontSize: theme.fontSize.xs,
  },

  listGroup: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    paddingVertical: theme.spacing.xs,
  },
  listSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.hairline,
    marginLeft: theme.spacing.lg,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
    minHeight: 52,
  },
  rowChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  rowSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
  },
  rowValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },

  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
  },
  sheetPanel: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    maxHeight: "90%",
    shadowColor: "#1D1A15",
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  sheetTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sheetClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -theme.spacing.sm,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetContent: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  sheetFooter: {
    paddingTop: theme.spacing.md,
  },

  segmented: {
    flexDirection: "row",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.pill,
    padding: 3,
    gap: 2,
  },
  segmentOption: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  segmentOptionActive: {
    backgroundColor: theme.colors.card,
    shadowColor: "#1D1A15",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  segmentLabelActive: {
    color: theme.colors.foreground,
  },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  buttonLg: {
    minHeight: 48,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonSm: {
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    alignSelf: "flex-start",
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonLabelLg: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  buttonLabelSm: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },

  chip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  chipLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },

  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  fieldHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 17,
  },
  input: {
    backgroundColor: theme.colors.muted,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: theme.radius.input,
    paddingHorizontal: 16,
    minHeight: 48,
    fontSize: theme.fontSize.base,
  },

  skeleton: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.input,
  },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  stateBox: {
    alignItems: "center",
    paddingVertical: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  stateIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.xs,
  },
  stateTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  stateText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
}));
