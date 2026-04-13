import type { Context } from 'grammy';
import { supabase } from '../services/supabase.js';
import { logger } from '../services/logger.js';
import { addMessage } from '../utils/context.js';
import type { JournalEntryType } from '../types/index.js';

export async function handleJournal(ctx: Context, entryType: JournalEntryType): Promise<void> {
  const text = ctx.message?.text ?? '';
  const chatId = ctx.chat!.id;

  const { data: inserted, error } = await supabase
    .from('journal_entry')
    .insert({ entry_type: entryType, content: text })
    .select('id')
    .single();

  if (error) {
    await logger.log({ level: 'error', event: 'db_insert_failed', handler: 'journal', chat_id: chatId, error: error.message });
    await ctx.reply('Ошибка при сохранении.');
    return;
  }

  await logger.log({
    event: 'journal_saved',
    handler: 'journal',
    chat_id: chatId,
    action_type: entryType,
    message_text: text.slice(0, 200),
    result: { id: inserted.id, entry_type: entryType, content_length: text.length },
  });

  await addMessage(chatId, {
    role: 'user',
    type: entryType === 'therapy' ? 'journal_therapy' : 'journal_free',
    text: text.slice(0, 50),
    timestamp: new Date().toISOString(),
  });

  const reply = entryType === 'therapy' ? 'Записал сессию 🧠' : 'Записал 💭';
  await ctx.reply(reply);
  await logger.botReply(chatId, reply);
}

export async function handleJournalList(ctx: Context): Promise<void> {
  const { data: entries } = await supabase
    .from('journal_entry')
    .select('id, created_at, entry_type, content')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!entries || entries.length === 0) {
    await ctx.reply('Записей пока нет.');
    return;
  }

  await logger.log({
    event: 'journal_list',
    handler: 'journal',
    chat_id: ctx.chat!.id,
    result: { count: entries.length, types: entries.map(e => e.entry_type) },
  });

  const lines = entries.map(e => {
    const date = new Date(e.created_at).toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const icon = e.entry_type === 'therapy' ? '🧠' : '💭';
    const preview = e.content.slice(0, 100) + (e.content.length > 100 ? '...' : '');
    return `${icon} ${date}\n${preview}`;
  });

  await ctx.reply(lines.join('\n\n'));
}
