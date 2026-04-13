import type { Context } from 'grammy';
import { callVision, callText } from '../services/claude.js';
import { PROMPTS } from '../config/prompts.js';
import { matchesFood } from '../utils/patterns.js';
import { getPendingQuestion } from '../utils/context.js';
import type { ActionType } from '../types/index.js';

export async function classifyPhoto(
  imageBase64: string,
  caption?: string,
): Promise<ActionType> {
  // Quick caption hints — skip Vision call if obvious
  if (caption) {
    const lower = caption.toLowerCase();
    if (lower.includes('утро')) return 'notebook_morning';
    if (lower.includes('вечер')) return 'notebook_evening';
    if (matchesFood(caption)) return 'food_photo';
  }

  const result = await callVision(PROMPTS.classifyPhoto, imageBase64);
  try {
    const parsed = JSON.parse(result);
    const typeMap: Record<string, ActionType> = {
      food: 'food_photo',
      notebook_morning: 'notebook_morning',
      notebook_evening: 'notebook_evening',
    };
    return typeMap[parsed.type] ?? 'ask_clarification';
  } catch {
    return 'ask_clarification';
  }
}

export async function classifyText(
  text: string,
  chatId: number,
): Promise<ActionType> {
  // Check pending questions first (no AI needed)
  const pending = await getPendingQuestion(chatId);
  if (pending) return 'pending_answer';

  // Route through Haiku
  const result = await callText(PROMPTS.classifyText, text);
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 'ask_clarification';
    const parsed = JSON.parse(jsonMatch[0]);

    const validTypes: ActionType[] = [
      'food_text', 'journal_therapy', 'journal_free',
      'supplement', 'recipe_query',
    ];

    if (validTypes.includes(parsed.type)) return parsed.type;
    return 'ask_clarification';
  } catch {
    return 'ask_clarification';
  }
}

export async function getPhotoBase64(ctx: Context): Promise<string | null> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return null;

  const largest = photos[photos.length - 1];
  const file = await ctx.api.getFile(largest.file_id);
  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
