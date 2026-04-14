// Jarvis History Tracker — background service worker
// Batches browser visits and sends to Supabase every 60 seconds

let visitQueue = [];
let config = {
  supabaseUrl: '',
  supabaseKey: '',
  profile: 'personal', // 'personal' or 'work'
  enabled: true,
};

// Load config from storage on startup
chrome.storage.local.get(['jarvisConfig'], (result) => {
  if (result.jarvisConfig) {
    config = { ...config, ...result.jarvisConfig };
  }
});

// Listen for config changes from popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.jarvisConfig) {
    config = { ...config, ...changes.jarvisConfig.newValue };
  }
});

// Track tab activation times for duration calculation
const tabStartTimes = new Map();

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Record end time for previous tab
  const now = Date.now();
  for (const [tabId, startTime] of tabStartTimes) {
    if (tabId !== activeInfo.tabId) {
      tabStartTimes.delete(tabId);
    }
  }
  tabStartTimes.set(activeInfo.tabId, now);
});

// Listen for page visits
chrome.history.onVisited.addListener(async (result) => {
  if (!config.enabled || !config.supabaseUrl) return;

  const url = result.url;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    return;
  }

  // Calculate duration from tab tracking
  let durationSec = null;
  const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab[0]) {
    const startTime = tabStartTimes.get(activeTab[0].id);
    if (startTime) {
      durationSec = Math.round((Date.now() - startTime) / 1000);
      if (durationSec < 1) durationSec = null;
      if (durationSec > 3600) durationSec = 3600; // Cap at 1 hour
    }
  }

  visitQueue.push({
    url: url.slice(0, 2000), // Truncate long URLs
    title: (result.title || '').slice(0, 500),
    domain,
    visited_at: new Date(result.lastVisitTime || Date.now()).toISOString(),
    duration_sec: durationSec,
    profile: config.profile,
  });
});

// Flush queue every 60 seconds
chrome.alarms.create('flush', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flush') {
    await flushQueue();
  }
});

async function flushQueue() {
  if (visitQueue.length === 0 || !config.supabaseUrl || !config.supabaseKey) return;

  const batch = visitQueue.splice(0, visitQueue.length);

  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/browser_history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      // Put items back in queue on failure
      visitQueue.unshift(...batch);
      console.error('Jarvis: flush failed', response.status, await response.text());
    } else {
      console.log(`Jarvis: flushed ${batch.length} visits`);
    }
  } catch (err) {
    visitQueue.unshift(...batch);
    console.error('Jarvis: flush error', err);
  }
}
