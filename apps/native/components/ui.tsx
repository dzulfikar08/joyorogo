import { Ionicons } from "@expo/vector-icons";
import Reanimated, {
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { MACRO_META, MacroIcon, type MacroKey } from "@/utils/macro-icons";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  Text as RNText,
  StyleSheet as RNStyleSheet,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { ComponentProps } from "react";
import { Circle, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { darkTheme, lightTheme } from "@/theme";

import { ENV } from "@/src/env";
import { fmtInt } from "@/utils/format";

import { Container } from "@/components/container";
import { Mascot, type MascotPose } from "@/components/mascot";
import { EASE_OUT, PressableScale, useCountUp } from "@/components/motion";

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

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

/**
 * The default text: Plus Jakarta Sans, weight from `fontWeight` style, and the
 * theme foreground unless the style sets a color (RN's default is black, which
 * vanishes on dark cards).
 */
export function Text({ style, ...rest }: TextProps) {
  const { theme } = useUnistyles();
  return (
    <RNText style={[{ color: theme.colors.foreground }, fontTheme(theme.fonts, style)]} {...rest} />
  );
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
  return <RNText style={[{ color: theme.colors.foreground }, styled]} {...rest} />;
}

/**
 * Num that counts up to `value` (kcal, scores). Eases from what is on screen, so
 * a changed total animates the delta; snaps under reduced motion. The a11y label
 * always carries the final number.
 */
export function CountNum({
  value,
  format = fmtInt,
  style,
  ...rest
}: Omit<TextProps, "children"> & { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value);
  return (
    <Num style={style} accessibilityLabel={format(value)} {...rest}>
      {format(shown)}
    </Num>
  );
}

// --- Layout ----------------------------------------------------------------

/**
 * Scrollable page on paper: 20px gutters, 12px between related cards. Passing
 * `onRefresh` turns on pull-to-refresh.
 */
export function Screen({
  children,
  style,
  refreshing = false,
  onRefresh,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <Container>
      {/* Keyboard-aware on both platforms: the focused input always scrolls
          above the keyboard (Android edge-to-edge never resizes the window). */}
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.screenContent, style]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        {children}
      </KeyboardAwareScrollView>
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
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={8}
          scaleTo={1}
          dimTo={0.7}
          style={styles.sectionAction}
        >
          <Text style={styles.sectionActionLabel}>{action.label}</Text>
        </PressableScale>
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

/** Initial-letter circle (Beranda greeting → /profil), or the profile photo
 * when present — a custom upload (/avatar/... on the API origin) or an
 * absolute Google URL — falling back to the initial when missing or broken. */
export function Avatar({
  name,
  image,
  size = 44,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const [broken, setBroken] = useState(false);
  const uri = image
    ? image.startsWith("/")
      ? `${ENV.EXPO_PUBLIC_SERVER_URL}${image}`
      : image
    : null;
  useEffect(() => setBroken(false), [uri]);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  if (uri && !broken) {
    return (
      <Image
        accessibilityLabel={`Avatar ${name}`}
        source={{ uri }}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
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
  const progress = useSharedValue(0);

  // Runs on the UI thread. A changed value sweeps from the current arc to the
  // new one instead of replaying from empty.
  useEffect(() => {
    progress.value = reduceMotion ? ratio : withTiming(ratio, { duration: 500, easing: EASE_OUT });
  }, [progress, ratio, reduceMotion]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const half = size / 2;
  const arc = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.value) }), [c]);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={half}
          cy={half}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          animatedProps={arc}
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

// --- MacroBar --------------------------------------------------------------

/** Bar fill that slides to `pct` on the UI thread (full-width bar, translated inside the clipped track). */
function BarFill({ pct, color }: { pct: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const fraction = useSharedValue(0);
  useEffect(() => {
    fraction.value = reduceMotion
      ? pct / 100
      : withTiming(pct / 100, { duration: 400, easing: EASE_OUT });
  }, [fraction, pct, reduceMotion]);
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: `${(fraction.value - 1) * 100}%` }],
  }));
  return (
    <Reanimated.View style={[styles.macroFill, { width: "100%", backgroundColor: color }, slide]} />
  );
}

/**
 * One nutrient against its daily budget: label, thin track/fill, "eaten/budget g".
 * Over budget turns terracotta (bakar), mirroring the web MacroBar.
 */
export function MacroBar({
  macro,
  label,
  eaten,
  budget,
  unit = "g",
}: {
  /** Shows the shared macro icon before the label. */
  macro?: MacroKey;
  label: string;
  eaten: number;
  /** null while the target is unknown (no profile yet): bar stays empty, shows "?". */
  budget: number | null;
  unit?: string;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("misc");
  const over = budget !== null && eaten > budget;
  const pct =
    budget !== null && budget > 0 ? Math.min(100, Math.max(0, (eaten / budget) * 100)) : 0;
  const budgetText = budget !== null ? fmtInt(budget) : "?";
  return (
    <View
      style={styles.macroRow}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("macro.progress", { label, eaten: fmtInt(eaten), budget: budgetText, unit })}
      accessibilityValue={{
        min: 0,
        max: Math.round(budget ?? 0),
        now: Math.round(Math.min(eaten, budget ?? eaten)),
      }}
    >
      <View style={styles.macroLabelWrap}>
        {macro ? <MacroIcon macro={macro} size={14} /> : null}
        <Text style={styles.macroLabel}>{label}</Text>
      </View>
      <View style={styles.macroTrack}>
        <BarFill pct={pct} color={over ? theme.colors.bakar : theme.colors.makan} />
      </View>
      <Num
        style={[styles.macroValue, over && { color: theme.colors.bakarText, fontWeight: "700" }]}
      >
        {fmtInt(eaten)}/{budgetText} {unit}
      </Num>
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
  macro,
  tint,
  label,
  value,
  count,
  countSuffix = "",
  sub,
  onPress,
}: {
  icon?: IconName;
  /** Shared macro icon; takes precedence over `icon`. */
  macro?: MacroKey;
  tint: Tint;
  label: string;
  /** Display text; also the fallback when `count` is absent. */
  value: string;
  /** Whole number that counts up instead of showing `value`. */
  count?: number;
  countSuffix?: string;
  sub?: string;
  onPress?: () => void;
}) {
  const { theme } = useUnistyles();
  const c = TINT_COLORS[tint];
  const body = (
    <>
      <View style={styles.tileChip}>
        {macro ? (
          <MacroIcon macro={macro} size={15} />
        ) : icon ? (
          <Ionicons name={icon} size={15} color={theme.colors[c.icon]} />
        ) : null}
      </View>
      <Text style={[styles.tileLabel, { color: theme.colors[c.text] }]}>{label}</Text>
      {count !== undefined ? (
        <CountNum
          value={count}
          format={(n) => `${fmtInt(n)}${countSuffix}`}
          style={[styles.tileValue, { color: theme.colors[c.text] }]}
        />
      ) : (
        <Num style={[styles.tileValue, { color: theme.colors[c.text] }]}>{value}</Num>
      )}
      {sub ? <Text style={[styles.tileSub, { color: theme.colors[c.text] }]}>{sub}</Text> : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.statTile, { backgroundColor: theme.colors[c.soft] }]}>{body}</View>;
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.statTile, { backgroundColor: theme.colors[c.soft] }]}
    >
      {body}
    </PressableScale>
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
  wrapTitle,
}: {
  icon?: IconName;
  iconTint?: Tint | "muted";
  thumb?: React.ReactNode;
  title: string;
  /** Wrap the title up to 2 lines instead of truncating to 1. */
  wrapTitle?: boolean;
  /** Plain text, or a node (e.g. MacroLine) styled like the subtitle. */
  subtitle?: string | React.ReactNode;
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
          numberOfLines={wrapTitle ? 2 : 1}
        >
          {title}
        </Text>
        {subtitle ? (
          typeof subtitle === "string" ? (
            <Text style={styles.rowSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : (
            <View style={styles.rowSubtitleBox}>{subtitle}</View>
          )
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      scaleTo={1}
      dimTo={0.7}
      style={styles.listRow}
    >
      {content}
    </PressableScale>
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
  const { t } = useTranslation("common");
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
          accessibilityLabel={t("actions.close")}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.sheetBackdrop} />
        </Pressable>
        {/* keyboard-controller's KAV pads on both platforms, including Android
            edge-to-edge and inside this Modal. box-none lets taps on the empty
            area above the panel reach the backdrop. */}
        <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.sheetAvoid}>
          <View style={[styles.sheetPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("actions.close")}
                onPress={onClose}
                hitSlop={8}
                scaleTo={0.9}
                style={styles.sheetClose}
              >
                <Ionicons name="close" size={22} color={theme.colors.mutedForeground} />
              </PressableScale>
            </View>
            <KeyboardAwareScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </KeyboardAwareScrollView>
            {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
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
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const active = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const slot = options.length > 0 ? (width - 6 - 2 * (options.length - 1)) / options.length : 0;
  const x = useSharedValue(0);
  const placed = useRef(false);

  // The active pill slides under the labels; first layout places it without motion.
  useEffect(() => {
    if (slot <= 0) return;
    const target = active * (slot + 2);
    x.value =
      placed.current && !reduceMotion
        ? withTiming(target, { duration: 200, easing: EASE_OUT })
        : target;
    placed.current = true;
  }, [active, slot, reduceMotion, x]);

  const pill = useAnimatedStyle(
    () => ({ width: slot, transform: [{ translateX: x.value }] }),
    [slot],
  );

  return (
    <View
      style={[styles.segmented, disabled && styles.disabled]}
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {slot > 0 ? (
        <Reanimated.View pointerEvents="none" style={[styles.segmentPill, pill]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={styles.segmentOption}
          >
            <Text
              style={[styles.segmentLabel, selected && styles.segmentLabelActive]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </PressableScale>
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.button,
        size === "lg" ? styles.buttonLg : styles.buttonSm,
        { backgroundColor: bg },
        variant === "ghost" && { backgroundColor: "transparent" },
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
    </PressableScale>
  );
}

// --- Chip ------------------------------------------------------------------

/** Pill chip for quick-add, ideas, and filters. */
export function Chip({
  label,
  onPress,
  selected,
  disabled,
  leading,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** Sticker thumb shown before the label. */
  leading?: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.96}
      style={[
        styles.chip,
        leading ? styles.chipWithLeading : null,
        { backgroundColor: selected ? theme.colors.foreground : theme.colors.muted },
        disabled && styles.pressedSoft,
      ]}
    >
      {leading}
      <Text
        style={[
          styles.chipLabel,
          { color: selected ? theme.colors.background : theme.colors.foreground },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

// --- Form ------------------------------------------------------------------

export function Field({
  label,
  hint,
  macro,
  children,
}: {
  label: string;
  hint?: string;
  /** Shows the shared macro icon and tone before the label (grams, kcal). */
  macro?: MacroKey;
  children: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.field}>
      {macro ? (
        <View style={styles.fieldLabelRow}>
          <MacroIcon macro={macro} size={14} />
          <Text style={[styles.fieldLabel, { color: theme.colors[MACRO_META[macro].color] }]}>
            {label}
          </Text>
        </View>
      ) : (
        <Text style={styles.fieldLabel}>{label}</Text>
      )}
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
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.55;
      return;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(0.55, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Reanimated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius: circle ? height / 2 : (radius ?? 8) },
        style,
        pulse,
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
  const { t } = useTranslation(["misc", "common"]);
  return (
    <View style={styles.stateBox}>
      <Mascot pose="surprised" size="sm" />
      <Text style={styles.stateTitle}>{t("misc:state.loadFailed")}</Text>
      <Text style={styles.stateText}>{message}</Text>
      <Button variant="secondary" size="sm" label={t("common:actions.retry")} onPress={onRetry} />
    </View>
  );
}

export function EmptyState({
  icon,
  pose,
  title,
  description,
  action,
}: {
  icon?: IconName;
  /** Mascot illustration; takes the place of `icon`. */
  pose?: MascotPose;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.stateBox}>
      {pose ? <Mascot pose={pose} size="md" /> : null}
      {!pose && icon ? (
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

  macroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  macroLabelWrap: {
    width: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  macroLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  macroTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  macroFill: {
    height: "100%",
    borderRadius: 3,
  },
  macroValue: {
    minWidth: 76,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
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
    overflow: "hidden",
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
  rowSubtitleBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 2,
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
  sheetAvoid: {
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
  segmentPill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: theme.radius.pill,
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
  chipWithLeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 6,
    minHeight: 44,
  },
  chipLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },

  field: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
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
