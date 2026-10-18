/**
 * JoyoRogo design v2 tokens.
 *
 * Warm paper canvas + pure-white cards (visible without borders), leaf-green
 * primary, and three data colors (makan/bakar/tidur) that only exist to tell
 * the daily numbers apart. Soft tints back tiles and icon chips; the *Text
 * variants are the darker shades that pass AA on those tints.
 */
const sharedColors = {
  destructive: "#B42318",
  destructiveForeground: "#FFFFFF",
  warning: "#B45309",
  /** Eat ring from 90% of the budget (engine eatTone "near"); over uses destructive. */
  eatNear: "#E5A50A",
} as const;

export const lightTheme = {
  colors: {
    ...sharedColors,
    // Canvas + surfaces
    background: "#F9F6F1",
    card: "#FFFFFF",
    foreground: "#1D1A15",
    muted: "#F0ECE5",
    mutedForeground: "#66635C",
    hairline: "rgba(29,26,21,0.10)",
    overlay: "rgba(29,26,21,0.45)",
    // Destructive rows: soft tint behind the icon chip, readable red on it.
    destructiveSoft: "#FDE7E4",
    destructiveText: "#B42318",
    // Brand
    primary: "#137D41",
    primaryForeground: "#FFFFFF",
    // Data colors (makan = primary green)
    makan: "#137D41",
    makanSoft: "#E0F5E5",
    makanText: "#0D6332",
    bakar: "#DE602F",
    bakarSoft: "#FFE8E0",
    bakarText: "#953B17",
    tidur: "#5C69BC",
    tidurSoft: "#E8EDFF",
    tidurText: "#424B8E",
    // Weight (grams) and energy (kcal), distinct from the macro hues.
    gramText: "#2B6A9B",
    kcalText: "#8A5A00",
  },
  // Page padding 20, related cards 12 apart, sections 28 apart, card padding 20.
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 20,
    xl: 28,
    xxl: 40,
  },
  radius: {
    card: 24,
    tile: 18,
    input: 14,
    pill: 999,
  },
  fontSize: {
    xs: 12,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    title: 28,
    hero: 56,
    display: 64,
  },
  fonts: {
    regular: "PlusJakartaSans_500Medium",
    medium: "PlusJakartaSans_600SemiBold",
    bold: "PlusJakartaSans_700Bold",
    heavy: "PlusJakartaSans_800ExtraBold",
  },
} as const;

export const darkTheme = {
  colors: {
    ...sharedColors,
    background: "#110F0A",
    card: "#1E1B17",
    foreground: "#F1EEE9",
    muted: "#2C2922",
    mutedForeground: "#9C9890",
    hairline: "rgba(241,238,233,0.10)",
    overlay: "rgba(8,7,4,0.6)",
    destructiveSoft: "#41201E",
    destructiveText: "#FF8A80",
    primary: "#5EBC7B",
    primaryForeground: "#0A1F12",
    makan: "#5EBC7B",
    makanSoft: "#193521",
    makanText: "#5EBC7B",
    bakar: "#F18761",
    bakarSoft: "#43251A",
    bakarText: "#F18761",
    tidur: "#8592DC",
    tidurSoft: "#262C47",
    tidurText: "#8592DC",
    // Weight (grams) and energy (kcal), distinct from the macro hues.
    gramText: "#6DB3E0",
    kcalText: "#F2C14E",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 20,
    xl: 28,
    xxl: 40,
  },
  radius: {
    card: 24,
    tile: 18,
    input: 14,
    pill: 999,
  },
  fontSize: {
    xs: 12,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    title: 28,
    hero: 56,
    display: 64,
  },
  fonts: {
    regular: "PlusJakartaSans_500Medium",
    medium: "PlusJakartaSans_600SemiBold",
    bold: "PlusJakartaSans_700Bold",
    heavy: "PlusJakartaSans_800ExtraBold",
  },
} as const;
