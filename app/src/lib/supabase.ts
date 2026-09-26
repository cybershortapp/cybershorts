import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const configMissing = !url || !key;

// Only the PUBLISHABLE key goes in the app. Never the secret key.
export const supabase = createClient(url ?? 'https://missing.supabase.co', key ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
