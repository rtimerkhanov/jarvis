import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../config/env.js';
import { classifyPhoto, classifyText, getPhotoBase64 } from './router.js';
import { handleFoodPhoto, handleFoodText, handleMealTypeCallback } from '../handlers/food.js';
import { handleNotebook } from '../handlers/notebook.js';
import { handleJournal, handleJournalList } from '../handlers/journal.js';
import { handleTimeEntry, handleGapCallback, handleDayTimeline } from '../handlers/time.js';
import { setPendingQuestion } from '../utils/context.js';
import { logger } from '../services/logger.js';

export function createBot(): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Auth middleware — only allowed chat IDs
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.ALLOWED_CHAT_IDS.includes(chatId)) {
      await logger.log({ level: 'warn', event: 'auth_rejected', chat_id: chatId ?? 0 });
      return;
    }
    await next();
  });

  // /start command
  bot.command('start', async (ctx) => {
    const startMs = await logger.incoming(ctx.chat.id, '/start');
    const reply =
      'pillar-bot запущен ✅\n\n' +
      'Отправляй:\n' +
      '📸 Фото еды → КБЖУ\n' +
      '📓 Фото блокнота → парсинг\n' +
      '💭 Текст → дневник\n' +
      '🍽 Описание еды → КБЖУ\n\n' +
      '/journal — записи дневника';
    await ctx.reply(reply);
    await logger.handled(ctx.chat.id, 'start', {}, startMs);
  });

  // /day command
  bot.command('day', async (ctx) => {
    const startMs = await logger.incoming(ctx.chat.id, '/day');
    try {
      await handleDayTimeline(ctx);
      await logger.handled(ctx.chat.id, 'day_timeline', {}, startMs);
    } catch (err) {
      await logger.handlerError(ctx.chat.id, 'day_timeline', err, startMs);
      await ctx.reply('Ошибка при загрузке таймлайна.');
    }
  });

  // /journal command
  bot.command('journal', async (ctx) => {
    const startMs = await logger.incoming(ctx.chat.id, '/journal');
    try {
      await handleJournalList(ctx);
      await logger.handled(ctx.chat.id, 'journal_list', {}, startMs);
    } catch (err) {
      await logger.handlerError(ctx.chat.id, 'journal_list', err, startMs);
      await ctx.reply('Ошибка при загрузке дневника.');
    }
  });

  // Callback queries (inline buttons)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat!.id;
    const startMs = await logger.incoming(chatId, `callback:${data}`);

    try {
      if (data.startsWith('meal:')) {
        await handleMealTypeCallback(ctx);
        await logger.handled(chatId, 'meal_type_callback', { meal: data }, startMs);
        return;
      }

      if (data.startsWith('gap:')) {
        await handleGapCallback(ctx);
        await logger.handled(chatId, 'gap_callback', { data }, startMs);
        return;
      }

      if (data.startsWith('clarify:')) {
        const type = data.split(':')[1];
        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });

        if (type === 'food') {
          await ctx.reply('Опиши что съел, я посчитаю КБЖУ.');
        } else if (type === 'notebook') {
          await ctx.reply('Отправь фото блокнота.');
        } else if (type === 'journal') {
          const originalText = ctx.callbackQuery.message?.text;
          if (originalText) {
            await handleJournal(ctx, 'free');
          }
        }
        await logger.handled(chatId, 'clarify_callback', { type }, startMs);
        return;
      }
    } catch (err) {
      await logger.handlerError(chatId, 'callback', err, startMs);
    }
  });

  // Photo messages
  bot.on('message:photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const caption = ctx.message.caption ?? undefined;
    const startMs = await logger.incoming(chatId, caption, true);

    try {
      const imageBase64 = await getPhotoBase64(ctx);
      if (!imageBase64) {
        await ctx.reply('Не удалось загрузить фото.');
        await logger.log({ level: 'error', event: 'photo_download_failed', chat_id: chatId });
        return;
      }

      await logger.apiCall('claude_vision_classify', { caption });
      const action = await classifyPhoto(imageBase64, caption);
      await logger.classified(chatId, action, startMs);

      switch (action) {
        case 'food_photo':
          await handleFoodPhoto(ctx, imageBase64);
          break;
        case 'notebook_morning':
          await handleNotebook(ctx, imageBase64, 'morning');
          break;
        case 'notebook_evening':
          await handleNotebook(ctx, imageBase64, 'evening');
          break;
        default:
          await ctx.reply('Не понял, что на фото. Выбери:', {
            reply_markup: new InlineKeyboard()
              .text('🍽 Еда', 'clarify:food')
              .text('📓 Блокнот', 'clarify:notebook')
              .text('💭 Дневник', 'clarify:journal'),
          });
          await logger.handled(chatId, 'ask_clarification_photo', { caption }, startMs);
      }
    } catch (err) {
      await logger.handlerError(chatId, 'photo', err, startMs);
      await ctx.reply('Произошла ошибка при обработке фото.');
    }
  });

  // Text messages
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const chatId = ctx.chat.id;
    const startMs = await logger.incoming(chatId, text);

    try {
      const action = await classifyText(text, chatId);
      await logger.classified(chatId, action, startMs);

      switch (action) {
        case 'food_text':
          await handleFoodText(ctx);
          break;
        case 'journal_therapy':
          await handleJournal(ctx, 'therapy');
          break;
        case 'journal_free':
          await handleJournal(ctx, 'free');
          break;
        case 'time_entry':
          await handleTimeEntry(ctx);
          break;
        case 'pending_answer':
          await setPendingQuestion(chatId, null);
          await ctx.reply('Ответ принят.');
          await logger.handled(chatId, 'pending_answer', { action: 'cleared_pending' }, startMs);
          break;
        case 'supplement':
          await ctx.reply('Добавки пока не поддерживаются в этой версии.');
          await logger.handled(chatId, 'supplement_stub', { text }, startMs);
          break;
        case 'recipe_query':
          await ctx.reply('Рецепты пока не поддерживаются в этой версии.');
          await logger.handled(chatId, 'recipe_stub', { text }, startMs);
          break;
        default:
          await ctx.reply('Не понял. Выбери:', {
            reply_markup: new InlineKeyboard()
              .text('🍽 Еда', 'clarify:food')
              .text('📓 Блокнот', 'clarify:notebook')
              .text('💭 Дневник', 'clarify:journal'),
          });
          await logger.handled(chatId, 'ask_clarification_text', { text, classified_as: action }, startMs);
      }
    } catch (err) {
      await logger.handlerError(chatId, 'text', err, startMs);
      await ctx.reply('Произошла ошибка при обработке сообщения.');
    }
  });

  bot.catch(async (err) => {
    await logger.log({ level: 'error', event: 'bot_unhandled_error', error: err.message });
  });

  return bot;
}
