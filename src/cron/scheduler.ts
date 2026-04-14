import cron from 'node-cron';
import { logger } from '../services/logger.js';
import { syncCalendars } from './jobs/sync-calendar.js';
import { syncYouTube } from './jobs/sync-youtube.js';
import { aggregateBrowsing } from './jobs/aggregate-browsing.js';
import { checkBlindSpots } from './jobs/blind-spots.js';

export function startScheduler(sendMessage: (chatId: number, text: string, options?: unknown) => Promise<void>, chatId: number) {
  // Calendar sync — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await syncCalendars();
    } catch (err) {
      await logger.log({ level: 'error', event: 'cron_failed', handler: 'sync-calendar', error: String(err) });
    }
  }, { timezone: 'Asia/Kuala_Lumpur' });

  // YouTube sync — every hour
  cron.schedule('15 * * * *', async () => {
    try {
      await syncYouTube();
    } catch (err) {
      await logger.log({ level: 'error', event: 'cron_failed', handler: 'sync-youtube', error: String(err) });
    }
  }, { timezone: 'Asia/Kuala_Lumpur' });

  // Aggregate browsing — every hour
  cron.schedule('30 * * * *', async () => {
    try {
      await aggregateBrowsing();
    } catch (err) {
      await logger.log({ level: 'error', event: 'cron_failed', handler: 'aggregate-browsing', error: String(err) });
    }
  }, { timezone: 'Asia/Kuala_Lumpur' });

  // Blind spots — 11:00, 16:00, 21:00
  cron.schedule('0 11,16,21 * * *', async () => {
    try {
      await checkBlindSpots(sendMessage, chatId);
    } catch (err) {
      await logger.log({ level: 'error', event: 'cron_failed', handler: 'blind-spots', error: String(err) });
    }
  }, { timezone: 'Asia/Kuala_Lumpur' });

  logger.log({ event: 'scheduler_started', handler: 'cron', meta: { jobs: ['sync-calendar', 'sync-youtube', 'aggregate-browsing', 'blind-spots'] } });
}
