// The interface copy is English, so numbers are formatted for English too.
const PERCENT = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 0.537 -> "54%" */
export function percent(value: number): string {
  return PERCENT.format(value);
}

/** 1.64 -> "1.6" */
export function decimal(value: number): string {
  return ONE_DECIMAL.format(value);
}

/** 1 -> "1 detail", 2 -> "2 details" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** ["A", "B", "C"] -> "A, B and C" */
export function listNames(names: string[], limit = 3): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= limit) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}
