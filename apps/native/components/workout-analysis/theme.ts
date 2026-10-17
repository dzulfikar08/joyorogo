/**
 * Colours and fonts the analysis components draw with. The host maps its own theme onto this, so nothing in this
 * folder imports a theme.
 */

export type AnalysisMapTheme = 'light' | 'dark';

export interface AnalysisFonts {
  regular?: string;
  /** Used for bold text; without it bold text uses fontWeight 700 on the regular family. */
  bold?: string;
}

export interface AnalysisPalette {
  isDark: boolean;
  /** Screen background; the cards sit on it. */
  background: string;
  /** Card fill. */
  surface: string;
  /** Tracks, bar backgrounds, chips inside a card. */
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  /** Chart gridlines. */
  grid: string;
  accent: string;
  hr: string;
  pace: string;
  elevation: string;
  cadence: string;
  power: string;
  /** Good news: fastest split, faster than before. */
  positive: string;
  negative: string;
  /** Heart-rate / pace zones 1 to 5, easy to hard. */
  zones: [string, string, string, string, string];
  mapRoute: string;
  mapRouteCasing: string;
  fonts?: AnalysisFonts;
}

export function defaultPalette(isDark: boolean): AnalysisPalette {
  if (isDark) {
    return {
      isDark,
      background: '#0E1413',
      surface: '#18201F',
      surfaceAlt: '#232D2C',
      text: '#F0F5F4',
      textMuted: '#9AABA8',
      border: '#2A3534',
      grid: 'rgba(240,245,244,0.12)',
      accent: '#3DD6C0',
      hr: '#FF6B6F',
      pace: '#5AA2FF',
      elevation: '#B7A57F',
      cadence: '#B58CFF',
      power: '#FFB03B',
      positive: '#4CD98A',
      negative: '#FF6B62',
      zones: ['#7DA9D6', '#4FC3A1', '#F0C14B', '#F59A4A', '#F0584C'],
      mapRoute: '#FF7A45',
      mapRouteCasing: '#101615',
    };
  }
  return {
    isDark,
    background: '#F3F6F5',
    surface: '#FFFFFF',
    surfaceAlt: '#EBF0EF',
    text: '#14201F',
    textMuted: '#5B6B69',
    border: '#DCE4E2',
    grid: 'rgba(20,32,31,0.10)',
    accent: '#0B8F80',
    hr: '#E0363F',
    pace: '#2468D6',
    elevation: '#7C6F57',
    cadence: '#7A4DC9',
    power: '#D97706',
    positive: '#17874D',
    negative: '#C93A32',
    zones: ['#6F9BC9', '#3AA586', '#D9A81F', '#E37B26', '#D63D31'],
    mapRoute: '#F0501A',
    mapRouteCasing: '#FFFFFF',
  };
}
