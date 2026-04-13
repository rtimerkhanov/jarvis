import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  return _client;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await logger.log({ level: 'warn', event: 'api_retry', handler: label, meta: { attempt } });
      }
      return await fn();
    } catch (error: unknown) {
      const isRetryable =
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError;
      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        await logger.log({
          level: 'error',
          event: 'api_failed',
          handler: label,
          error: error instanceof Error ? error.message : String(error),
          meta: { attempt },
        });
        throw error;
      }
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  throw new Error('Unreachable');
}

export async function callVision(
  prompt: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg',
): Promise<string> {
  const startMs = Date.now();
  await logger.apiCall('claude_vision', { model: 'claude-sonnet-4-6', prompt_len: prompt.length });

  const result = await withRetry('claude_vision', async () => {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  });

  await logger.log({
    event: 'api_response',
    handler: 'claude_vision',
    duration_ms: Date.now() - startMs,
    meta: { response_len: result.length, response_preview: result.slice(0, 200) },
  });

  return result;
}

export async function callText(prompt: string, userMessage: string): Promise<string> {
  const startMs = Date.now();
  await logger.apiCall('claude_text', { model: 'claude-haiku-4-5', prompt_len: prompt.length, message_len: userMessage.length });

  const result = await withRetry('claude_text', async () => {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  });

  await logger.log({
    event: 'api_response',
    handler: 'claude_text',
    duration_ms: Date.now() - startMs,
    meta: { response_len: result.length, response_preview: result.slice(0, 200) },
  });

  return result;
}
