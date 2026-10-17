import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useAnalysisContext } from './context';

/** Smallest touch target, in dp. */
export const MIN_HIT = 44;

interface TxtProps {
  children: ReactNode;
  size?: number;
  bold?: boolean;
  muted?: boolean;
  color?: string;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  fit?: boolean;
  style?: StyleProp<TextStyle>;
}

/** Themed text: palette colour, injected fonts, tabular numbers. */
export function Txt({ children, size = 13, bold = false, muted = false, color, align, numberOfLines, fit, style }: TxtProps) {
  const { palette } = useAnalysisContext();
  const fonts = palette.fonts;
  const family = bold ? (fonts?.bold ?? fonts?.regular) : fonts?.regular;
  return (
    <Text
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.7 : undefined}
      style={[
        {
          fontSize: size,
          lineHeight: Math.round(size * 1.3),
          color: color ?? (muted ? palette.textMuted : palette.text),
          fontFamily: family,
          fontWeight: bold && !fonts?.bold ? '700' : undefined,
          fontVariant: ['tabular-nums'],
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

interface CardProps {
  title?: string;
  /** Right-aligned text in the title row. */
  aside?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** No inner padding, for edge-to-edge content such as the map. */
  flush?: boolean;
  a11yLabel?: string;
}

/** A rounded `surface` card. */
export function Card({ title, aside, children, style, flush = false, a11yLabel }: CardProps) {
  const { palette } = useAnalysisContext();
  return (
    <View
      accessibilityLabel={a11yLabel}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        flush ? null : styles.cardPad,
        style,
      ]}
    >
      {title ? (
        <View style={styles.titleRow}>
          <Txt size={15} bold style={styles.titleText}>
            {title}
          </Txt>
          {aside ? (
            <Txt size={12} muted>
              {aside}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

interface BarProps {
  /** 0..1 */
  fraction: number;
  color: string;
  height?: number;
}

/** A horizontal bar on a `surfaceAlt` track. */
export function Bar({ fraction, color, height = 8 }: BarProps) {
  const { palette } = useAnalysisContext();
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: palette.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${f * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

interface ChipProps {
  label: string;
  color: string;
  /** Filled chip with contrasting label, otherwise outlined. */
  filled?: boolean;
  labelColor?: string;
}

export function Chip({ label, color, filled = false, labelColor }: ChipProps) {
  const { palette } = useAnalysisContext();
  return (
    <View
      style={[
        styles.chip,
        filled ? { backgroundColor: color } : { borderColor: color, borderWidth: 1 },
      ]}
    >
      <Txt size={11} bold color={labelColor ?? (filled ? palette.surface : color)}>
        {label}
      </Txt>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <Txt size={12} muted style={styles.note}>
      {children}
    </Txt>
  );
}

export function Divider() {
  const { palette } = useAnalysisContext();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardPad: { padding: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8 },
  titleText: { flexShrink: 1 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  note: { marginTop: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
});
