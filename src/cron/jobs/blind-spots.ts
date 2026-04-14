import { supabase } from '../../services/supabase.js';
import { logger } from '../../services/logger.js';

interface TimeBlock {
  start_time: string;
  end_time: string | null;
}

interface Gap {
  from: string;
  to: string;
  durationMin: number;
}

function findGaps(blocks: TimeBlock[], dayStart: string, now: string): Gap[] {
  const sorted = blocks
    .filter(b => b.end_time)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const gaps: Gap[] = [];
  let cursor = new Date(dayStart);
  const nowDate = new Date(now);

  // Start checking from 7:00 (waking hours)
  const wakeHour = 7;
  cursor.setHours(wakeHour, 0, 0, 0);
  if (cursor > nowDate) return [];

  for (const block of sorted) {
    const blockStart = new Date(block.start_time);
    const blockEnd = new Date(block.end_time!);

    if (blockStart > cursor) {
      const gapMin = Math.round((blockStart.getTime() - cursor.getTime()) / 60_000);
      if (gapMin >= 60) {
        gaps.push({
          from: cursor.toISOString(),
          to: blockStart.toISOString(),
          durationMin: gapMin,
        });
      }
    }

    if (blockEnd > cursor) cursor = blockEnd;
  }

  // Gap from last block to now
  if (nowDate > cursor) {
    const gapMin = Math.round((nowDate.getTime() - cursor.getTime()) / 60_000);
    if (gapMin >= 60) {
      gaps.push({
        from: cursor.toISOString(),
        to: nowDate.toISOString(),
        durationMin: gapMin,
      });
    }
  }

  return gaps;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

export async function checkBlindSpots(
  sendMessage: (chatId: number, text: string, options?: unknown) => Promise<void>,
  chatId: number,
) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const { data: blocks } = await supabase
    .from('time_log')
    .select('start_time, end_time')
    .eq('date', today)
    .order('start_time');

  if (!blocks) return;

  const dayStart = `${today}T00:00:00+08:00`;
  const gaps = findGaps(blocks, dayStart, now);

  if (gaps.length === 0) {
    await logger.log({ event: 'blind_spots_check', handler: 'blind-spots', meta: { gaps: 0 } });
    return;
  }

  for (const gap of gaps) {
    const text = `С ${formatTime(gap.from)} до ${formatTime(gap.to)} — нет записи (${gap.durationMin} мин). Чем занимался?`;

    const keyboard = {
      inline_keyboard: [[
        { text: '🏠 Дома/отдых', callback_data: `gap:rest:${gap.from}:${gap.to}` },
        { text: '💻 Работа', callback_data: `gap:work:${gap.from}:${gap.to}` },
      ], [
        { text: '🚶 Прогулка', callback_data: `gap:walk:${gap.from}:${gap.to}` },
        { text: '🍽 Еда', callback_data: `gap:food:${gap.from}:${gap.to}` },
      ], [
        { text: '😴 Сон', callback_data: `gap:sleep:${gap.from}:${gap.to}` },
        { text: '✏️ Своё', callback_data: `gap:custom:${gap.from}:${gap.to}` },
      ]],
    };

    await sendMessage(chatId, text, { reply_markup: keyboard });
  }

  await logger.log({
    event: 'blind_spots_asked',
    handler: 'blind-spots',
    chat_id: chatId,
    meta: { gaps: gaps.length, gap_details: gaps.map(g => `${formatTime(g.from)}-${formatTime(g.to)}`) },
  });
}
