function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  get TELEGRAM_BOT_TOKEN() { return required('TELEGRAM_BOT_TOKEN'); },
  get ALLOWED_CHAT_IDS() { return required('ALLOWED_CHAT_IDS').split(',').map(Number); },
  get SUPABASE_URL() { return required('SUPABASE_URL'); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get CLAUDE_API_KEY() { return required('CLAUDE_API_KEY'); },
  get PORT() { return Number(process.env.PORT || '3000'); },
  get GOOGLE_CLIENT_ID() { return optional('GOOGLE_CLIENT_ID'); },
  get GOOGLE_CLIENT_SECRET() { return optional('GOOGLE_CLIENT_SECRET'); },
} as const;
