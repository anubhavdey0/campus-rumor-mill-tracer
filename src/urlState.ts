/**
 * Keeps the scenario in the address bar, so any campus, rumor, and set of
 * dials can be shared as a link and will replay exactly the same way.
 * Only values that differ from the defaults are written.
 *
 * The parsing and writing are pure functions of the query string, so they
 * can be tested without a browser.
 */

import type { Settings } from './components/Controls';
import { MAX_STUDENTS, MIN_STUDENTS } from './sim/campus';
import { clamp } from './sim/rng';
import { PRESETS, cleanCustomText, isUsableRumor } from './sim/rumor';
import { ALGORITHMS, type Algorithm } from './sim/spread';

export interface Scenario {
  seed: number;
  settings: Settings;
  /** Null means "whoever the campus picks by default". */
  source: number | null;
  customText: string;
  /** The fact-checker, or null for none. */
  checker: number | null;
  /** The rumor's head start before the fact-checker starts talking. */
  lead: number;
  /** Ids of friendships the visitor has cut. */
  cuts: number[];
}

export const MAX_SEED = 999_999;
export const MAX_LEAD = 8;

function readNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Reads a scenario from a query string, falling back to the defaults for anything missing or invalid. */
export function parseScenario(search: string, defaults: Scenario): Scenario {
  const params = new URLSearchParams(search);
  const settings: Settings = { ...defaults.settings };

  const rumor = params.get('rumor');
  if (rumor === 'custom' || PRESETS.some((preset) => preset.id === rumor)) settings.rumorId = rumor!;

  const route = params.get('route');
  if (ALGORITHMS.includes(route as Algorithm)) settings.algorithm = route as Algorithm;

  const size = readNumber(params, 'students');
  if (size !== null) settings.size = clamp(Math.round(size / 4) * 4, MIN_STUDENTS, MAX_STUDENTS);

  const decay = readNumber(params, 'decay');
  if (decay !== null) settings.decay = clamp(Math.round(decay), 0, 40) / 100;

  const bend = readNumber(params, 'bend');
  if (bend !== null) settings.distortion = clamp(Math.round(bend / 5) * 5, 0, 90) / 100;

  const cutoff = readNumber(params, 'cutoff');
  if (cutoff !== null) settings.cutoff = clamp(Math.round(cutoff), 5, 60) / 100;

  const seedParam = readNumber(params, 'campus');
  const seed = seedParam !== null ? clamp(Math.round(seedParam), 1, MAX_SEED) : defaults.seed;

  const inCampus = (value: number | null) =>
    value !== null && value >= 0 && value < settings.size ? Math.round(value) : null;
  const source = inCampus(readNumber(params, 'from'));
  const checkerParam = inCampus(readNumber(params, 'checker'));
  const checker = checkerParam !== null && checkerParam !== source ? checkerParam : null;

  const leadParam = readNumber(params, 'lead');
  const lead = leadParam !== null ? clamp(Math.round(leadParam), 0, MAX_LEAD) : defaults.lead;

  const cuts = [
    ...new Set(
      (params.get('cut') ?? '')
        .split(',')
        .filter((part) => part.trim() !== '')
        .map((part) => Number(part))
        .filter((id) => Number.isInteger(id) && id >= 0 && id < 2000),
    ),
  ].sort((a, b) => a - b);

  const text = cleanCustomText(params.get('text') ?? '');
  const customText = isUsableRumor(text) ? text : defaults.customText;

  return { seed, settings, source, customText, checker, lead, cuts };
}

/** The query string for a scenario, without the leading "?". Empty when everything is a default. */
export function scenarioQuery(scenario: Scenario, defaults: Scenario): string {
  const params = new URLSearchParams();
  const { settings } = scenario;
  const base = defaults.settings;
  const percent = (value: number) => String(Math.round(value * 100));

  if (scenario.seed !== defaults.seed) params.set('campus', String(scenario.seed));
  if (settings.size !== base.size) params.set('students', String(settings.size));
  if (settings.rumorId !== base.rumorId) params.set('rumor', settings.rumorId);
  if (settings.rumorId === 'custom') params.set('text', cleanCustomText(scenario.customText));
  if (scenario.source !== null) params.set('from', String(scenario.source));
  if (settings.algorithm !== base.algorithm) params.set('route', settings.algorithm);
  if (settings.decay !== base.decay) params.set('decay', percent(settings.decay));
  if (settings.distortion !== base.distortion) params.set('bend', percent(settings.distortion));
  if (settings.cutoff !== base.cutoff) params.set('cutoff', percent(settings.cutoff));
  if (scenario.checker !== null) {
    params.set('checker', String(scenario.checker));
    if (scenario.lead !== defaults.lead) params.set('lead', String(scenario.lead));
  }
  if (scenario.cuts.length > 0) params.set('cut', scenario.cuts.join(','));
  return params.toString().replace(/%2C/g, ',');
}

export function readScenario(defaults: Scenario): Scenario {
  return parseScenario(window.location.search, defaults);
}

/** The address for a scenario, relative to the current page. */
export function scenarioUrl(scenario: Scenario, defaults: Scenario): string {
  const query = scenarioQuery(scenario, defaults);
  return window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
}

/**
 * Mirrors the scenario into the address bar. `push` adds a history entry, so
 * the Back button can return to it. Small tweaks replace the current entry.
 */
export function writeScenario(scenario: Scenario, defaults: Scenario, push = false): void {
  const url = scenarioUrl(scenario, defaults);
  if (push && url === window.location.pathname + window.location.search + window.location.hash) return;
  try {
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  } catch {
    // Some browsers rate-limit history updates. The page works without them.
  }
}
