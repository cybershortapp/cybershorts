import { useWindowDimensions } from 'react-native';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Sizes that adapt to any screen: small phones, large phones, foldables and tablets.
 * Everything is worked out from the real screen width and the height left for the card.
 */
export function useCardLayout(pageHeight: number) {
  const { width } = useWindowDimensions();

  const isTablet = width >= 600;
  const cardWidth = Math.min(width - (isTablet ? 48 : 24), 760);

  // text grows on bigger screens and shrinks a little on short ones
  const scale = clamp(Math.min(width / 390, pageHeight / 740), 0.8, isTablet ? 1.6 : 1.12);

  // image takes a bigger share on tall/large screens, but always leaves room for the text
  const imageShare = isTablet ? 0.42 : pageHeight > 720 ? 0.34 : pageHeight > 600 ? 0.28 : 0.22;
  const imageHeight = Math.round(clamp(pageHeight * imageShare, 110, cardWidth * 0.62));

  return {
    isTablet,
    cardWidth,
    imageHeight,
    headlineSize: Math.round(20 * scale),
    headlineLine: Math.round(26 * scale),
    bodySize: Math.round(15.5 * scale),
    bodyLine: Math.round(23 * scale),
    metaSize: Math.round(12.5 * Math.min(scale, isTablet ? 1.45 : 1.2)),
    pad: Math.round(16 * Math.min(scale, 1.3)),
    iconSize: Math.round(60 * scale),
    buttonIcon: Math.round(22 * Math.min(scale, isTablet ? 1.4 : 1.2)),
  };
}
