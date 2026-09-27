/**
 * App switches, set in app/.env (and in eas.json for real builds)
 * EXPO_PUBLIC_SOURCE_IMAGES: shows each article's own preview photo, credited to the news site.
 * Set it to false to use our own artwork instead (no photo copyright question at all).
 */
export const SHOW_SOURCE_IMAGES = process.env.EXPO_PUBLIC_SOURCE_IMAGES !== 'false';
