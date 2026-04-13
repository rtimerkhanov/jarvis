const FOOD_MARKERS = [
  /съел/i, /поел/i, /на завтрак/i, /на обед/i, /на ужин/i,
  /перекус/i, /выпил/i, /приготовил/i, /еда:/i,
  /\d+\s*г\b/i, /\d+\s*мл\b/i, /порци[яю]/i,
  /калори[йи]/i, /ккал/i,
];

const THERAPY_MARKERS = [
  /психолог/i, /терапи[яю]/i, /сессия/i, /с психолога/i,
  /терапевт/i, /психотерап/i,
];

const SUPPLEMENT_MARKERS = [
  /добавк/i, /витамин/i, /принял таблетк/i, /бад/i,
  /supplement/i, /omega/i, /омега/i,
];

const RECIPE_MARKERS = [
  /что приготовить/i, /рецепт/i, /на обед что/i,
  /что поесть/i, /что сготовить/i, /что можно приготовить/i,
];

const JOURNAL_MARKERS = [
  /грустн/i, /радостн/i, /устал/i, /тревожн/i, /злюсь/i,
  /настроение/i, /чувству/i, /переживаю/i, /думаю о/i,
  /сегодня был/i, /день был/i, /хорошо поработал/i,
  /не могу/i, /получилось/i, /не получилось/i,
  /заметил/i, /понял что/i, /осознал/i, /решил что/i,
  /благодар/i, /счастлив/i, /спокойн/i, /нервнич/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

export function matchesFood(text: string): boolean {
  return matchesAny(text, FOOD_MARKERS);
}

export function matchesTherapy(text: string): boolean {
  return matchesAny(text, THERAPY_MARKERS);
}

export function matchesSupplements(text: string): boolean {
  return matchesAny(text, SUPPLEMENT_MARKERS);
}

export function matchesRecipe(text: string): boolean {
  return matchesAny(text, RECIPE_MARKERS);
}

export function matchesJournal(text: string): boolean {
  return matchesAny(text, JOURNAL_MARKERS);
}
