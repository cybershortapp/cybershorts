import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F4F2',
  card: '#FFFFFF',
  text: '#16161A',
  muted: '#5F5E5A',
  faint: '#8A8983',
  border: '#E3E2DC',
  accent: '#185FA5',
  invertBg: '#16161A',
  invertText: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#0E0E10',
  card: '#1A1A1D',
  text: '#F2F2F0',
  muted: '#B4B2A9',
  faint: '#888780',
  border: '#2C2C30',
  accent: '#85B7EB',
  invertBg: '#F2F2F0',
  invertText: '#16161A',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

// [background, text] per category, readable in both modes
const CAT_LIGHT: Record<string, [string, string]> = {
  Breaches: ['#FCEBEB', '#A32D2D'],
  Scams: ['#FAEEDA', '#854F0B'],
  Vulnerabilities: ['#E6F1FB', '#185FA5'],
  Ransomware: ['#FBEAF0', '#993556'],
  Tools: ['#E1F5EE', '#0F6E56'],
  Policy: ['#EEEDFE', '#534AB7'],
  Other: ['#F1EFE8', '#5F5E5A'],
};

const CAT_DARK: Record<string, [string, string]> = {
  Breaches: ['#501313', '#F7C1C1'],
  Scams: ['#412402', '#FAC775'],
  Vulnerabilities: ['#042C53', '#B5D4F4'],
  Ransomware: ['#4B1528', '#F4C0D1'],
  Tools: ['#04342C', '#9FE1CB'],
  Policy: ['#26215C', '#CECBF6'],
  Other: ['#2C2C2A', '#D3D1C7'],
};

export function useCategoryColors(category: string): [string, string] {
  const map = useColorScheme() === 'dark' ? CAT_DARK : CAT_LIGHT;
  return map[category] ?? map.Other;
}
