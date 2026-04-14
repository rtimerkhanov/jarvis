import { getCalendarEvents, getTokens } from '../../services/google.js';
import { supabase } from '../../services/supabase.js';
import { logger } from '../../services/logger.js';

const PROFILES = [
  { service: 'google_personal', category: 'personal', source: 'google_calendar_personal' },
  { service: 'google_work', category: 'work', source: 'google_calendar_work' },
];

export async function syncCalendars() {
  const today = new Date().toISOString().split('T')[0];
  let totalSynced = 0;

  for (const profile of PROFILES) {
    const tokens = await getTokens(profile.service);
    if (!tokens) continue;

    try {
      const events = await getCalendarEvents(profile.service, today);

      for (const event of events) {
        if (!event.start?.dateTime || !event.id) continue;

        const startTime = event.start.dateTime;
        const endTime = event.end?.dateTime ?? null;
        const durationMin = endTime
          ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000)
          : null;

        const externalId = `gcal_${event.id}`;

        const { error } = await supabase
          .from('time_log')
          .upsert({
            date: today,
            start_time: startTime,
            end_time: endTime,
            duration_min: durationMin,
            title: event.summary ?? 'Без названия',
            category: profile.category,
            source: profile.source,
            details: event.description ?? null,
            external_id: externalId,
          }, { onConflict: 'external_id' });

        if (!error) totalSynced++;
      }

      await logger.log({
        event: 'calendar_synced',
        handler: 'sync-calendar',
        meta: { profile: profile.service, events_count: events.length, date: today },
      });
    } catch (err) {
      await logger.log({
        level: 'error',
        event: 'calendar_sync_error',
        handler: 'sync-calendar',
        error: err instanceof Error ? err.message : String(err),
        meta: { profile: profile.service },
      });
    }
  }

  return totalSynced;
}
