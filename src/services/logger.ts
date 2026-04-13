import { supabase } from './supabase.js';

export interface LogEntry {
  level?: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  direction?: 'in' | 'out';
  chat_id?: number;
  message_text?: string;
  photo?: boolean;
  action_type?: string;
  handler?: string;
  result?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
  meta?: Record<string, unknown>;
}

class Logger {
  private queue: LogEntry[] = [];
  private flushing = false;

  async log(entry: LogEntry): Promise<void> {
    const row = { level: 'info' as const, ...entry };
    this.queue.push(row);

    // Console output for dev
    const icon = row.direction === 'in' ? '→' : row.direction === 'out' ? '←' : '·';
    const levelTag = row.level === 'error' ? '❌' : row.level === 'warn' ? '⚠️' : '';
    console.log(`${levelTag} ${icon} [${row.event}]`, row.action_type ?? '', row.message_text?.slice(0, 80) ?? '');

    if (!this.flushing) this.flush();
  }

  private async flush(): Promise<void> {
    this.flushing = true;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 20);
      const { error } = await supabase.from('bot_log').insert(batch);
      if (error) console.error('Logger flush error:', error.message);
    }
    this.flushing = false;
  }

  async incoming(chatId: number, text?: string, hasPhoto?: boolean): Promise<number> {
    await this.log({
      event: 'message_received',
      direction: 'in',
      chat_id: chatId,
      message_text: text,
      photo: hasPhoto ?? false,
    });
    return Date.now();
  }

  async classified(chatId: number, actionType: string, startMs: number): Promise<void> {
    await this.log({
      event: 'classified',
      chat_id: chatId,
      action_type: actionType,
      duration_ms: Date.now() - startMs,
    });
  }

  async handled(chatId: number, handler: string, result: Record<string, unknown>, startMs: number): Promise<void> {
    await this.log({
      event: 'handled',
      direction: 'out',
      chat_id: chatId,
      handler,
      result,
      duration_ms: Date.now() - startMs,
    });
  }

  async handlerError(chatId: number, handler: string, err: unknown, startMs: number): Promise<void> {
    await this.log({
      level: 'error',
      event: 'handler_error',
      chat_id: chatId,
      handler,
      error: err instanceof Error ? err.message : String(err),
      meta: err instanceof Error ? { stack: err.stack } : undefined,
      duration_ms: Date.now() - startMs,
    });
  }

  async botReply(chatId: number, text: string): Promise<void> {
    await this.log({
      event: 'bot_reply',
      direction: 'out',
      chat_id: chatId,
      message_text: text,
    });
  }

  async apiCall(service: string, meta?: Record<string, unknown>): Promise<void> {
    await this.log({
      event: 'api_call',
      handler: service,
      meta,
    });
  }
}

export const logger = new Logger();
