import { google } from 'googleapis';
import { env } from '../config/env.js';
import { supabase } from './supabase.js';
import { logger } from './logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

function createOAuth2Client() {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');
  return new google.auth.OAuth2(clientId, clientSecret, `${getBaseUrl()}/auth/google/callback`);
}

function getBaseUrl(): string {
  return process.env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT}`;
}

// --- Token storage ---

export async function getTokens(service: string): Promise<{ access_token: string; refresh_token: string; expires_at: string } | null> {
  const { data } = await supabase
    .from('auth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('service', service)
    .single();
  return data;
}

async function saveTokens(service: string, tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }) {
  const row = {
    service,
    access_token: tokens.access_token ?? '',
    refresh_token: tokens.refresh_token ?? '',
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  await supabase
    .from('auth_tokens')
    .upsert(row, { onConflict: 'service' });
}

// --- OAuth flow ---

export function getAuthUrl(profile: 'personal' | 'work'): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: profile,
  });
}

export async function handleCallback(code: string, profile: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  await saveTokens(`google_${profile}`, tokens);
  await logger.log({ event: 'google_oauth_success', handler: 'google', meta: { profile } });
}

// --- Authenticated client ---

export async function getAuthenticatedClient(service: string) {
  const tokens = await getTokens(service);
  if (!tokens) throw new Error(`No tokens for ${service}`);

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });

  // Auto-refresh if expired
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at) : null;
  if (!expiresAt || expiresAt.getTime() < Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    await saveTokens(service, credentials);
    client.setCredentials(credentials);
    await logger.log({ event: 'google_token_refreshed', handler: 'google', meta: { service } });
  }

  return client;
}

// --- Calendar ---

export async function getCalendarEvents(service: string, date: string) {
  const auth = await getAuthenticatedClient(service);
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = `${date}T00:00:00+08:00`;
  const timeMax = `${date}T23:59:59+08:00`;

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return res.data.items ?? [];
}

// --- YouTube ---

export async function getYouTubeActivities(service: string) {
  const auth = await getAuthenticatedClient(service);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.activities.list({
    part: ['snippet', 'contentDetails'],
    mine: true,
    maxResults: 50,
  });

  return (res.data.items ?? []).filter(item => item.snippet?.type === 'watch');
}
