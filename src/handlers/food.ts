import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { callVision, callText } from '../services/claude.js';
import { supabase } from '../services/supabase.js';
import { PROMPTS } from '../config/prompts.js';
import { addMessage, setPendingQuestion } from '../utils/context.js';
import { logger } from '../services/logger.js';
import type { NutritionData } from '../types/index.js';

function parseNutrition(raw: string): NutritionData | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function formatNutrition(data: NutritionData): string {
  return `${data.description}: ~${data.calories} ккал, Б:${data.protein} Ж:${data.fat} У:${data.carbs}`;
}

const mealKeyboard = new InlineKeyboard()
  .text('🌅 Завтрак', 'meal:breakfast')
  .text('🌞 Обед', 'meal:lunch')
  .text('🌙 Ужин', 'meal:dinner')
  .text('🍎 Перекус', 'meal:snack');

export async function handleFoodPhoto(ctx: Context, imageBase64: string): Promise<void> {
  const raw = await callVision(PROMPTS.analyzeFoodPhoto, imageBase64);
  const data = parseNutrition(raw);

  if (!data) {
    await logger.log({ level: 'warn', event: 'parse_failed', handler: 'food_photo', meta: { raw_preview: raw.slice(0, 200) } });
    await ctx.reply('Не удалось распознать еду. Попробуй описать текстом.');
    return;
  }

  const chatId = ctx.chat!.id;
  await logger.log({ event: 'food_parsed', handler: 'food_photo', chat_id: chatId, result: data as unknown as Record<string, unknown> });

  const { data: inserted } = await supabase
    .from('nutrition_log')
    .insert({
      date: new Date().toISOString().split('T')[0],
      description: data.description,
      calories: data.calories,
      protein: data.protein,
      fat: data.fat,
      carbs: data.carbs,
      confidence: data.confidence,
    })
    .select('id')
    .single();

  await setPendingQuestion(chatId, {
    type: 'meal_type',
    context: { nutrition_log_id: inserted?.id },
  });

  await addMessage(chatId, {
    role: 'user', type: 'food_photo', has_photo: true,
    timestamp: new Date().toISOString(),
  });

  const replyText = formatNutrition(data);
  await ctx.reply(replyText, { reply_markup: mealKeyboard });
  await logger.log({
    event: 'food_saved',
    direction: 'out',
    handler: 'food_photo',
    chat_id: chatId,
    message_text: replyText,
    result: { nutrition_log_id: inserted?.id, ...data as unknown as Record<string, unknown> },
  });
}

export async function handleFoodText(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? '';
  const raw = await callText(PROMPTS.analyzeFoodText, text);
  const data = parseNutrition(raw);

  if (!data) {
    await logger.log({ level: 'warn', event: 'parse_failed', handler: 'food_text', meta: { raw_preview: raw.slice(0, 200) } });
    await ctx.reply('Не удалось рассчитать КБЖУ. Попробуй описать подробнее.');
    return;
  }

  const chatId = ctx.chat!.id;
  await logger.log({ event: 'food_parsed', handler: 'food_text', chat_id: chatId, result: data as unknown as Record<string, unknown> });

  const { data: inserted } = await supabase
    .from('nutrition_log')
    .insert({
      date: new Date().toISOString().split('T')[0],
      description: data.description,
      calories: data.calories,
      protein: data.protein,
      fat: data.fat,
      carbs: data.carbs,
      confidence: data.confidence,
    })
    .select('id')
    .single();

  await setPendingQuestion(chatId, {
    type: 'meal_type',
    context: { nutrition_log_id: inserted?.id },
  });

  await addMessage(chatId, {
    role: 'user', type: 'food_text', text,
    timestamp: new Date().toISOString(),
  });

  const replyText = formatNutrition(data);
  await ctx.reply(replyText, { reply_markup: mealKeyboard });
  await logger.log({
    event: 'food_saved',
    direction: 'out',
    handler: 'food_text',
    chat_id: chatId,
    message_text: replyText,
    result: { nutrition_log_id: inserted?.id, input: text, ...data as unknown as Record<string, unknown> },
  });
}

export async function handleMealTypeCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('meal:')) return;

  const mealType = data.split(':')[1];
  const chatId = ctx.chat!.id;
  const pending = await import('../utils/context.js').then(m => m.getPendingQuestion(chatId));

  if (pending?.type === 'meal_type' && pending.context.nutrition_log_id) {
    await supabase
      .from('nutrition_log')
      .update({ meal_type: mealType })
      .eq('id', pending.context.nutrition_log_id);
  }

  await setPendingQuestion(chatId, null);

  const labels: Record<string, string> = {
    breakfast: '🌅 Завтрак',
    lunch: '🌞 Обед',
    dinner: '🌙 Ужин',
    snack: '🍎 Перекус',
  };

  await ctx.answerCallbackQuery(`${labels[mealType] ?? mealType} записан`);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await logger.log({
    event: 'meal_type_set',
    handler: 'meal_callback',
    chat_id: chatId,
    action_type: mealType,
    result: { nutrition_log_id: pending?.context.nutrition_log_id, meal_type: mealType },
  });
}
