import { supabase } from './supabase';
import type { ReportReason } from './types';

/** Sends an error report. The app can only add reports, it can never read them. */
export async function sendReport(storyId: string, reason: ReportReason): Promise<boolean> {
  const { error } = await supabase.from('reports').insert({ story_id: storyId, reason });
  return !error;
}
