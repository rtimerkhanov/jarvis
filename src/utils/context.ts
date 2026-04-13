import { supabase } from '../services/supabase.js';
import type { ConversationMessage, PendingQuestion } from '../types/index.js';

const MAX_CONTEXT_MESSAGES = 3;

export async function getContext(chatId: number): Promise<ConversationMessage[]> {
  const { data } = await supabase
    .from('conversation_context')
    .select('messages')
    .eq('chat_id', chatId)
    .single();
  return data?.messages ?? [];
}

export async function addMessage(chatId: number, message: ConversationMessage): Promise<void> {
  const existing = await getContext(chatId);
  const updated = [...existing, message].slice(-MAX_CONTEXT_MESSAGES);

  await supabase
    .from('conversation_context')
    .upsert({ chat_id: chatId, messages: updated, updated_at: new Date().toISOString() });
}

export async function getPendingQuestion(chatId: number): Promise<PendingQuestion | null> {
  const { data } = await supabase
    .from('conversation_context')
    .select('pending_question')
    .eq('chat_id', chatId)
    .single();
  return data?.pending_question ?? null;
}

export async function setPendingQuestion(chatId: number, question: PendingQuestion | null): Promise<void> {
  await supabase
    .from('conversation_context')
    .upsert({ chat_id: chatId, pending_question: question, updated_at: new Date().toISOString() });
}

export async function getLastMessageType(chatId: number): Promise<string | null> {
  const messages = await getContext(chatId);
  if (messages.length === 0) return null;
  return messages[messages.length - 1].type;
}
