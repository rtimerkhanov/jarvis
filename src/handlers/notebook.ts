import type { Context } from 'grammy';
import { callVision } from '../services/claude.js';
import { supabase } from '../services/supabase.js';
import { PROMPTS } from '../config/prompts.js';
import { addMessage } from '../utils/context.js';
import { logger } from '../services/logger.js';
import type { NotebookData } from '../types/index.js';

function parseNotebook(raw: string): NotebookData | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function formatMorning(data: NotebookData): string {
  const metrics = data.metrics;
  const checkboxes = data.checkboxes;
  const completed = Object.values(checkboxes).filter(Boolean).length;
  const total = Object.keys(checkboxes).length;

  const parts: string[] = ['Утро ✅'];
  if (metrics.sleep_hours) parts.push(`Сон: ${metrics.sleep_hours}ч (${metrics.sleep_quality ?? '?'}/10)`);
  if (metrics.body_state) parts.push(`Тело: ${metrics.body_state}`);
  if (total > 0) parts.push(`Привычки: ${completed}/${total}`);

  return parts.join('. ') + '.';
}

function formatEvening(data: NotebookData): string {
  const metrics = data.metrics;
  const checkboxes = data.checkboxes;
  const completed = Object.values(checkboxes).filter(Boolean).length;
  const total = Object.keys(checkboxes).length;

  const parts: string[] = ['Вечер ✅'];
  if (metrics.day_rating) parts.push(`День: ${metrics.day_rating}/10`);
  if (metrics.mood) parts.push(`Настроение: ${metrics.mood}`);
  if (total > 0) parts.push(`Привычки: ${completed}/${total}`);

  return parts.join('. ') + '.';
}

export async function handleNotebook(
  ctx: Context,
  imageBase64: string,
  section: 'morning' | 'evening',
): Promise<void> {
  const prompt = section === 'morning'
    ? PROMPTS.parseNotebookMorning
    : PROMPTS.parseNotebookEvening;

  const raw = await callVision(prompt, imageBase64);
  const data = parseNotebook(raw);

  if (!data) {
    await logger.log({ level: 'warn', event: 'parse_failed', handler: `notebook_${section}`, meta: { raw_preview: raw.slice(0, 200) } });
    await ctx.reply('Не удалось распознать блокнот. Попробуй переснять чётче.');
    return;
  }

  const chatId = ctx.chat!.id;
  await logger.log({
    event: 'notebook_parsed',
    handler: `notebook_${section}`,
    chat_id: chatId,
    result: {
      checkboxes_count: Object.keys(data.checkboxes).length,
      metrics: data.metrics,
      substances_count: data.substances?.length ?? 0,
    },
  });

  const today = new Date().toISOString().split('T')[0];

  // Save notebook entry
  await supabase.from('notebook_entry').insert({
    date: today,
    section,
    checkboxes: data.checkboxes,
    metrics: data.metrics,
    text_fields: data.text_fields,
    raw_parsed: data,
  });

  // Save substances if any
  if (data.substances && data.substances.length > 0) {
    const substanceRows = data.substances.map(s => ({
      date: today,
      substance: s.substance,
      time_taken: s.time_taken ?? null,
      dose: s.dose ?? null,
      reason: s.reason ?? null,
    }));
    await supabase.from('substance_log').insert(substanceRows);
  }

  await addMessage(chatId, {
    role: 'user',
    type: section === 'morning' ? 'notebook_morning' : 'notebook_evening',
    has_photo: true,
    timestamp: new Date().toISOString(),
  });

  const reply = section === 'morning' ? formatMorning(data) : formatEvening(data);
  await ctx.reply(reply);
  await logger.log({
    event: 'notebook_saved',
    direction: 'out',
    handler: `notebook_${section}`,
    chat_id: chatId,
    message_text: reply,
    result: {
      date: today,
      section,
      checkboxes: data.checkboxes,
      metrics: data.metrics,
      substances: data.substances,
      text_fields_keys: Object.keys(data.text_fields ?? {}),
    },
  });
}
