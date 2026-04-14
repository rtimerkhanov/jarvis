import type { Context } from 'grammy';
import { supabase } from '../services/supabase.js';
import { callText } from '../services/claude.js';
import { logger } from '../services/logger.js';

const PARSE_TIME_PROMPT = `Извлеки из текста временной интервал и активность. Верни JSON:
{
  "start_hour": число (0-23),
  "start_min": число (0-59),
  "end_hour": число (0-23),
  "end_min": число (0-59),
  "description": "описание активности",
  "category": "work" | "personal" | "rest" | "food" | "walk" | "sleep" | "sport" | "commute" | "social" | "entertainment" | "education" | "unknown"
}

Если время указано без AM/PM, предполагай 24-часовой формат.
"С 15 до 17 работал" → start: 15:00, end: 17:00
"9-10 встреча" → start: 9:00, end: 10:00`;

export async function handleTimeEntry(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? '';
  const chatId = ctx.chat!.id;

  const raw = await callText(PARSE_TIME_PROMPT, text);
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    await logger.log({ level: 'warn', event: 'time_parse_failed', handler: 'time', chat_id: chatId, meta: { raw: raw.slice(0, 200) } });
    await ctx.reply('Не удалось распознать время. Формат: "с 15 до 17 работал над проектом"');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const startTime = `${today}T${String(parsed.start_hour).padStart(2, '0')}:${String(parsed.start_min).padStart(2, '0')}:00+08:00`;
  const endTime = `${today}T${String(parsed.end_hour).padStart(2, '0')}:${String(parsed.end_min).padStart(2, '0')}:00+08:00`;
  const durationMin = (parsed.end_hour * 60 + parsed.end_min) - (parsed.start_hour * 60 + parsed.start_min);

  const { error } = await supabase.from('time_log').insert({
    date: today,
    start_time: startTime,
    end_time: endTime,
    duration_min: durationMin,
    title: parsed.description,
    category: parsed.category,
    source: 'manual',
  });

  if (error) {
    await logger.log({ level: 'error', event: 'db_insert_failed', handler: 'time', error: error.message });
    await ctx.reply('Ошибка записи.');
    return;
  }

  const startStr = `${String(parsed.start_hour).padStart(2, '0')}:${String(parsed.start_min).padStart(2, '0')}`;
  const endStr = `${String(parsed.end_hour).padStart(2, '0')}:${String(parsed.end_min).padStart(2, '0')}`;
  const reply = `Записал: ${startStr}–${endStr} ${parsed.description} (${parsed.category})`;

  await ctx.reply(reply);
  await logger.log({
    event: 'time_entry_saved',
    direction: 'out',
    handler: 'time',
    chat_id: chatId,
    message_text: reply,
    result: { start: startStr, end: endStr, description: parsed.description, category: parsed.category, duration_min: durationMin },
  });
}

export async function handleGapCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('gap:')) return;

  const parts = data.split(':');
  const category = parts[1];
  const from = parts[2];
  const to = parts[3];

  if (category === 'custom') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply(`Напиши, чем занимался с ${formatTimeShort(from)} до ${formatTimeShort(to)}:`);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const categoryLabels: Record<string, string> = {
    rest: 'Отдых', work: 'Работа', walk: 'Прогулка',
    food: 'Еда', sleep: 'Сон',
  };

  const durationMin = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);

  await supabase.from('time_log').insert({
    date: today,
    start_time: from,
    end_time: to,
    duration_min: durationMin,
    title: categoryLabels[category] ?? category,
    category,
    source: 'bot_question',
  });

  await ctx.answerCallbackQuery(`${categoryLabels[category] ?? category} записано`);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });

  await logger.log({
    event: 'gap_filled',
    handler: 'blind-spots',
    chat_id: ctx.chat!.id,
    result: { category, from: formatTimeShort(from), to: formatTimeShort(to), duration_min: durationMin },
  });
}

export async function handleDayTimeline(ctx: Context): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const { data: entries } = await supabase
    .from('time_log')
    .select('start_time, end_time, title, category, duration_min, source')
    .eq('date', today)
    .order('start_time');

  if (!entries || entries.length === 0) {
    await ctx.reply('Пока нет записей за сегодня.');
    return;
  }

  const categoryIcons: Record<string, string> = {
    work: '💻', personal: '📌', rest: '🏠', food: '🍽',
    walk: '🚶', sleep: '😴', sport: '🏋️', commute: '🚗',
    social: '👥', entertainment: '🎬', education: '📚', other: '·', unknown: '❓',
  };

  const lines = entries.map(e => {
    const start = formatTimeShort(e.start_time);
    const end = e.end_time ? formatTimeShort(e.end_time) : '...';
    const icon = categoryIcons[e.category] ?? '·';
    const dur = e.duration_min ? ` (${e.duration_min}м)` : '';
    return `${start}–${end} ${icon} ${e.title}${dur}`;
  });

  // Category breakdown
  const breakdown: Record<string, number> = {};
  for (const e of entries) {
    if (e.duration_min) {
      breakdown[e.category] = (breakdown[e.category] ?? 0) + e.duration_min;
    }
  }

  const totalMin = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const breakdownLines = Object.entries(breakdown)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, min]) => {
      const icon = categoryIcons[cat] ?? '·';
      const pct = totalMin > 0 ? Math.round(min / totalMin * 100) : 0;
      const hours = (min / 60).toFixed(1);
      return `${icon} ${cat}: ${hours}ч (${pct}%)`;
    });

  const reply = `📅 Таймлайн ${today}\n\n${lines.join('\n')}\n\n📊 Итого:\n${breakdownLines.join('\n')}`;
  await ctx.reply(reply);

  await logger.log({
    event: 'day_timeline',
    handler: 'time',
    chat_id: ctx.chat!.id,
    result: { entries_count: entries.length, total_min: totalMin, breakdown },
  });
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}
