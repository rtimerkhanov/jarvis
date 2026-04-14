// Load saved config
chrome.storage.local.get(['jarvisConfig'], (result) => {
  const config = result.jarvisConfig || {};
  document.getElementById('url').value = config.supabaseUrl || '';
  document.getElementById('key').value = config.supabaseKey || '';
  document.getElementById('profile').value = config.profile || 'personal';
  document.getElementById('enabled').checked = config.enabled !== false;
  updateStatus(config);
});

document.getElementById('save').addEventListener('click', async () => {
  const config = {
    supabaseUrl: document.getElementById('url').value.trim().replace(/\/$/, ''),
    supabaseKey: document.getElementById('key').value.trim(),
    profile: document.getElementById('profile').value,
    enabled: document.getElementById('enabled').checked,
  };

  chrome.storage.local.set({ jarvisConfig: config }, () => {
    updateStatus(config);
  });
});

function updateStatus(config) {
  const el = document.getElementById('status');
  if (config.enabled && config.supabaseUrl && config.supabaseKey) {
    el.className = 'status ok';
    el.textContent = `Tracking ${config.profile} profile`;
  } else if (!config.enabled) {
    el.className = 'status off';
    el.textContent = 'Tracking paused';
  } else {
    el.className = 'status off';
    el.textContent = 'Configure Supabase URL and key';
  }
}
