import { supabase } from '../../services/supabase.js';
import { callText } from '../../services/claude.js';
import { logger } from '../../services/logger.js';

const CLASSIFY_PROMPT = `Классифицируй домены по категориям активности. Для каждого домена верни одну категорию.

Категории:
- work: рабочие инструменты (github, jira, confluence, slack, notion, google docs, figma и т.д.)
- entertainment: развлечения (youtube, twitch, reddit, tiktok, netflix и т.д.)
- social: соцсети и мессенджеры (telegram, whatsapp, instagram, twitter/x, facebook и т.д.)
- education: обучение (coursera, udemy, stackoverflow, medium, docs и т.д.)
- shopping: покупки (amazon, lazada, shopee и т.д.)
- other: всё остальное

Верни JSON: {"домен": "категория", ...}`;

// Cache domain classifications to avoid re-classifying
const domainCache = new Map<string, string>();

async function classifyDomains(domains: string[]): Promise<Record<string, string>> {
  const uncached = domains.filter(d => !domainCache.has(d));
  if (uncached.length === 0) {
    return Object.fromEntries(domains.map(d => [d, domainCache.get(d)!]));
  }

  try {
    const raw = await callText(CLASSIFY_PROMPT, uncached.join('\n'));
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
      for (const [domain, cat] of Object.entries(parsed)) {
        domainCache.set(domain, cat);
      }
    }
  } catch {
    // Fallback: mark all as 'other'
  }

  return Object.fromEntries(domains.map(d => [d, domainCache.get(d) ?? 'other']));
}

export async function aggregateBrowsing() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().split('T')[0];

  // Get uncategorized recent visits grouped by domain
  const { data: visits } = await supabase
    .from('browser_history')
    .select('domain, visited_at, duration_sec, profile, category')
    .gte('visited_at', oneHourAgo)
    .is('category', null)
    .order('visited_at');

  if (!visits || visits.length === 0) return;

  // Get unique domains and classify
  const domains = [...new Set(visits.map(v => v.domain).filter(Boolean))] as string[];
  const classifications = await classifyDomains(domains);

  // Update categories in browser_history
  for (const domain of domains) {
    const cat = classifications[domain];
    if (cat) {
      await supabase
        .from('browser_history')
        .update({ category: cat })
        .eq('domain', domain)
        .is('category', null);
    }
  }

  // Aggregate into time_log: group consecutive visits by category into blocks
  const grouped = new Map<string, { start: string; end: string; domains: Set<string>; profile: string }>();

  for (const visit of visits) {
    if (!visit.domain) continue;
    const cat = classifications[visit.domain] ?? 'other';
    const key = `${cat}_${visit.profile}`;
    const existing = grouped.get(key);
    const visitEnd = visit.duration_sec
      ? new Date(new Date(visit.visited_at).getTime() + visit.duration_sec * 1000).toISOString()
      : visit.visited_at;

    if (existing) {
      if (visit.visited_at < existing.start) existing.start = visit.visited_at;
      if (visitEnd > existing.end) existing.end = visitEnd;
      existing.domains.add(visit.domain);
    } else {
      grouped.set(key, {
        start: visit.visited_at,
        end: visitEnd,
        domains: new Set([visit.domain]),
        profile: visit.profile,
      });
    }
  }

  // Write aggregated blocks to time_log
  let written = 0;
  for (const [key, block] of grouped) {
    const category = key.split('_')[0];
    const durationMin = Math.round(
      (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000
    );
    if (durationMin < 1) continue;

    const externalId = `chrome_${today}_${key}_${block.start}`;
    const topDomains = [...block.domains].slice(0, 5).join(', ');

    await supabase
      .from('time_log')
      .upsert({
        date: today,
        start_time: block.start,
        end_time: block.end,
        duration_min: durationMin,
        title: `Browsing: ${topDomains}`,
        category,
        source: `chrome_${block.profile}`,
        external_id: externalId,
      }, { onConflict: 'external_id' });

    written++;
  }

  await logger.log({
    event: 'browsing_aggregated',
    handler: 'aggregate-browsing',
    meta: { visits_count: visits.length, domains_classified: domains.length, blocks_written: written },
  });
}
