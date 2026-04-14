import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { webhookCallback } from 'grammy';
import { createBot } from './bot/telegram.js';
import { env } from './config/env.js';
import { supabase } from './services/supabase.js';
import { getAuthUrl, handleCallback } from './services/google.js';
import { startScheduler } from './cron/scheduler.js';

const app = new Hono();
const bot = createBot();

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/webhook/telegram', async (c) => {
  const handler = webhookCallback(bot, 'hono');
  return handler(c);
});

// --- Log feed API ---
app.get('/api/logs', async (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  const before = c.req.query('before'); // cursor: created_at ISO string
  const level = c.req.query('level');

  let query = supabase
    .from('bot_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);
  if (level) query = query.eq('level', level);

  const { data, error } = await query;
  return c.json({ data: data ?? [], error: error?.message });
});

// --- Google OAuth ---
app.get('/auth/google/personal', (c) => {
  try {
    return c.redirect(getAuthUrl('personal'));
  } catch {
    return c.text('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 500);
  }
});

app.get('/auth/google/work', (c) => {
  try {
    return c.redirect(getAuthUrl('work'));
  } catch {
    return c.text('Google OAuth not configured.', 500);
  }
});

app.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? 'personal';
  if (!code) return c.text('Missing code', 400);

  try {
    await handleCallback(code, state);
    return c.html(`<h2>Google ${state} account connected!</h2><p>You can close this tab.</p>`);
  } catch (err) {
    return c.text(`OAuth error: ${err}`, 500);
  }
});

// --- Log feed frontend ---
app.get('/logs', (c) => {
  return c.html(LOG_VIEWER_HTML);
});

const isDev = process.env.NODE_ENV !== 'production';

// Start cron scheduler
const chatId = env.ALLOWED_CHAT_IDS[0];
const sendMessage = async (cid: number, text: string, options?: unknown) => {
  await bot.api.sendMessage(cid, text, options as Parameters<typeof bot.api.sendMessage>[2]);
};
startScheduler(sendMessage, chatId);

if (isDev) {
  console.log('Starting pillar-bot in polling mode...');
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`Log viewer: http://localhost:${env.PORT}/logs`);
    console.log(`OAuth personal: http://localhost:${env.PORT}/auth/google/personal`);
    console.log(`OAuth work: http://localhost:${env.PORT}/auth/google/work`);
  });
  bot.start({
    onStart: () => console.log('pillar-bot polling started'),
  });
} else {
  console.log(`Starting pillar-bot webhook on port ${env.PORT}...`);
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`pillar-bot running on http://localhost:${env.PORT}`);
  });
}

const LOG_VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pillar-bot logs</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0d1117; color: #c9d1d9; font-size: 13px; }
  .toolbar { position: sticky; top: 0; z-index: 10; background: #161b22; border-bottom: 1px solid #30363d; padding: 8px 16px; display: flex; gap: 8px; align-items: center; }
  .toolbar button, .toolbar select { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .toolbar button:hover { background: #30363d; }
  .toolbar .active { background: #1f6feb; border-color: #1f6feb; }
  .count { margin-left: auto; color: #8b949e; font-size: 12px; }
  #feed { padding: 8px; }
  .entry { border-bottom: 1px solid #21262d; padding: 6px 8px; display: grid; grid-template-columns: 140px 22px 60px 140px 1fr; gap: 8px; align-items: start; }
  .entry:hover { background: #161b22; }
  .ts { color: #8b949e; white-space: nowrap; }
  .dir { text-align: center; }
  .dir.in { color: #3fb950; }
  .dir.out { color: #58a6ff; }
  .level { font-weight: 600; text-transform: uppercase; font-size: 11px; }
  .level.error { color: #f85149; }
  .level.warn { color: #d29922; }
  .level.info { color: #8b949e; }
  .level.debug { color: #6e7681; }
  .event { color: #d2a8ff; }
  .body { color: #c9d1d9; word-break: break-word; }
  .body .text { color: #f0f6fc; }
  .body .meta { color: #8b949e; font-size: 12px; }
  .body .dur { color: #3fb950; margin-left: 6px; }
  .body .err { color: #f85149; }
  .loader { text-align: center; padding: 16px; color: #8b949e; }
  .auto-dot { animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: 0.3; } }
</style>
</head>
<body>
<div class="toolbar">
  <button id="btn-all" class="active" onclick="setLevel('')">All</button>
  <button id="btn-error" onclick="setLevel('error')">Errors</button>
  <button id="btn-warn" onclick="setLevel('warn')">Warns</button>
  <select onchange="setLevel(this.value)">
    <option value="">All levels</option>
    <option value="debug">debug</option>
    <option value="info">info</option>
    <option value="warn">warn</option>
    <option value="error">error</option>
  </select>
  <label style="color:#8b949e;font-size:12px"><input type="checkbox" id="auto" checked> Auto-refresh</label>
  <span class="count" id="count"></span>
</div>
<div id="feed"></div>
<div class="loader" id="loader">Loading...</div>

<script>
let level = '';
let entries = [];
let oldestTs = null;
let autoRefresh = true;
let newestTs = null;

function setLevel(l) {
  level = l;
  entries = [];
  oldestTs = null;
  newestTs = null;
  document.getElementById('feed').innerHTML = '';
  document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
  if (!l) document.getElementById('btn-all').classList.add('active');
  else if (l === 'error') document.getElementById('btn-error').classList.add('active');
  else if (l === 'warn') document.getElementById('btn-warn').classList.add('active');
  load();
}

function renderEntry(e) {
  const ts = new Date(e.created_at).toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit', second:'2-digit', day:'2-digit', month:'2-digit' });
  const dirIcon = e.direction === 'in' ? '→' : e.direction === 'out' ? '←' : '·';
  const dirClass = e.direction || '';

  let body = '';
  if (e.message_text) body += '<span class="text">' + esc(e.message_text.slice(0,200)) + '</span> ';
  if (e.action_type) body += '<span class="meta">[' + esc(e.action_type) + ']</span> ';
  if (e.handler) body += '<span class="meta">handler:' + esc(e.handler) + '</span> ';
  if (e.duration_ms != null) body += '<span class="dur">' + e.duration_ms + 'ms</span> ';
  if (e.error) body += '<br><span class="err">' + esc(e.error) + '</span> ';
  if (e.result) body += '<br><span class="meta">' + esc(JSON.stringify(e.result).slice(0,300)) + '</span>';
  if (e.meta) body += '<br><span class="meta">' + esc(JSON.stringify(e.meta).slice(0,300)) + '</span>';

  return '<div class="entry">'
    + '<span class="ts">' + ts + '</span>'
    + '<span class="dir ' + dirClass + '">' + dirIcon + '</span>'
    + '<span class="level ' + e.level + '">' + e.level + '</span>'
    + '<span class="event">' + esc(e.event) + '</span>'
    + '<span class="body">' + body + '</span>'
    + '</div>';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function load(before) {
  let url = '/api/logs?limit=100';
  if (before) url += '&before=' + encodeURIComponent(before);
  if (level) url += '&level=' + encodeURIComponent(level);
  const res = await fetch(url);
  const { data } = await res.json();
  if (!data.length) { document.getElementById('loader').textContent = 'No more entries'; return; }

  const feed = document.getElementById('feed');
  data.forEach(e => {
    entries.push(e);
    feed.innerHTML += renderEntry(e);
  });
  oldestTs = data[data.length - 1].created_at;
  if (!newestTs && data.length) newestTs = data[0].created_at;
  document.getElementById('count').textContent = entries.length + ' entries';
  document.getElementById('loader').textContent = 'Scroll down for more';
}

async function pollNew() {
  if (!autoRefresh || !newestTs) return;
  let url = '/api/logs?limit=50';
  if (level) url += '&level=' + encodeURIComponent(level);
  const res = await fetch(url);
  const { data } = await res.json();
  if (!data.length) return;

  const newEntries = data.filter(e => e.created_at > newestTs);
  if (!newEntries.length) return;

  const feed = document.getElementById('feed');
  newEntries.reverse().forEach(e => {
    entries.unshift(e);
    feed.insertAdjacentHTML('afterbegin', renderEntry(e));
  });
  newestTs = data[0].created_at;
  document.getElementById('count').textContent = entries.length + ' entries';
}

// Infinite scroll
window.addEventListener('scroll', () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
    load(oldestTs);
  }
});

document.getElementById('auto').addEventListener('change', (e) => { autoRefresh = e.target.checked; });

load();
setInterval(pollNew, 3000);
</script>
</body>
</html>`;
