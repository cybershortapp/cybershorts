import type { Severity } from './lib/types';

/** CyberSid palette, taken from the logo (cyan > blue > purple on near-black). */
export const C = {
  bg: '#F5F7FC',
  card: '#F4F7FF',
  white: '#FFFFFF',
  imageBg: '#E4ECFF',
  border: '#DCE3F2',
  borderSoft: '#C6D5F6',
  chipBorder: '#D6DCE8',
  text: '#0A0F1F',
  body: '#3A4256',
  muted: '#7A8197',
  brand: '#2563F5',
  brandDark: '#1F55D8',
  brandText: '#1945B0',
  onBrand: '#FFFFFF',
  cyan: '#12B8FF',
  purple: '#7B48FE',
  night: '#05070F',
};

/** Logo-style fonts (Poppins). Body text stays on the system font for easy reading. */
export const F = {
  brand: 'Poppins_700Bold',
  head: 'Poppins_600SemiBold',
  label: 'Poppins_600SemiBold',
  medium: 'Poppins_500Medium',
};

export const SEVERITY: Record<Severity, { bg: string; fg: string; accent: string; rank: number }> = {
  Critical: { bg: '#C62F2E', fg: '#FFFFFF', accent: '#C62F2E', rank: 4 },
  High: { bg: '#FAEEDA', fg: '#854F0B', accent: '#C77A0E', rank: 3 },
  Medium: { bg: '#EEE8FF', fg: '#5B32C8', accent: '#6A3FE0', rank: 2 },
  Info: { bg: '#EEF1F6', fg: '#565D6E', accent: '#7A8197', rank: 1 },
};

export function severityOf(s: Severity | null | undefined) {
  return SEVERITY[s ?? 'Info'] ?? SEVERITY.Info;
}
