import { getYouTubeActivities, getTokens } from '../../services/google.js';
import { supabase } from '../../services/supabase.js';
import { logger } from '../../services/logger.js';

const PROFILES = [
  { service: 'google_personal', source: 'youtube_personal' },
  { service: 'google_work', source: 'youtube_work' },
];

export async function syncYouTube() {
  const today = new Date().toISOString().split('T')[0];

  for (const profile of PROFILES) {
    const tokens = await getTokens(profile.service);
    if (!tokens) continue;

    try {
      const activities = await getYouTubeActivities(profile.service);

      for (const activity of activities) {
        const publishedAt = activity.snippet?.publishedAt;
        const videoId = activity.contentDetails?.upload?.videoId
          ?? activity.contentDetails?.playlistItem?.resourceId?.videoId;
        if (!publishedAt) continue;

        // Only today's watches
        if (!publishedAt.startsWith(today)) continue;

        const externalId = `yt_${videoId ?? publishedAt}`;
        const title = activity.snippet?.title ?? 'YouTube видео';

        await supabase
          .from('time_log')
          .upsert({
            date: today,
            start_time: publishedAt,
            end_time: null,
            duration_min: null,
            title: `YouTube: ${title}`,
            category: 'entertainment',
            source: profile.source,
            external_id: externalId,
          }, { onConflict: 'external_id' });
      }

      await logger.log({
        event: 'youtube_synced',
        handler: 'sync-youtube',
        meta: { profile: profile.service, watches_count: activities.length },
      });
    } catch (err) {
      await logger.log({
        level: 'error',
        event: 'youtube_sync_error',
        handler: 'sync-youtube',
        error: err instanceof Error ? err.message : String(err),
        meta: { profile: profile.service },
      });
    }
  }
}
