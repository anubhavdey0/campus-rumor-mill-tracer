import { useCallback, useEffect, useState } from 'react';
import type { Algorithm } from './sim/spread';

export type Mode = 'light' | 'dark';
export type Preference = Mode | 'system';

const STORAGE_KEY = 'rumor-mill-theme';

/**
 * The distortion scale: one hue, six steps, one per class of "details bent"
 * (0, 1, 2, 3-4, 5-7, 8 or more). Light mode runs pale to deep; dark mode
 * flips so the least bent version still recedes toward the surface. Both
 * ramps are checked for monotone lightness, visible step gaps, and contrast.
 */
export const BEND_RAMP: Record<Mode, readonly string[]> = {
  light: ['#ef8fb0', '#e4628f', '#cf366c', '#ad1f52', '#82143d', '#570a27'],
  dark: ['#8a2a50', '#ad3765', '#d2497c', '#ec6f9b', '#f7a1bf', '#ffd3e1'],
};

export const BEND_CLASSES = ['0', '1', '2', '3-4', '5-7', '8+'] as const;

/** Where each class starts, in details bent. Averages blend smoothly between classes. */
const BEND_STOPS = [0, 1, 2, 3, 5, 8];

/** The fact-checker's correction. Clearly apart from every step of the distortion scale, for every kind of color vision. */
export const TRUTH_COLOR: Record<Mode, string> = { light: '#2a78d6', dark: '#3987e5' };

/** "Reach if they started it", for the network view. One hue, low to high. */
export const HEAT_RAMP: Record<Mode, readonly string[]> = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'],
};

/** One color per route in charts. Validated as a set, every pair, in both modes. */
export const ROUTE_COLORS: Record<Mode, Record<Algorithm, string>> = {
  light: { bfs: '#2a78d6', dfs: '#eb6834', best: '#1baf7a' },
  dark: { bfs: '#3987e5', dfs: '#d95926', best: '#199e70' },
};

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function blend(ramp: readonly string[], position: number): string {
  const clamped = Math.min(ramp.length - 1, Math.max(0, position));
  const lower = Math.floor(clamped);
  const mix = clamped - lower;
  if (mix === 0) return ramp[lower];
  const a = hexToRgb(ramp[lower]);
  const b = hexToRgb(ramp[lower + 1]);
  const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Which class a number of bent details falls in, 0 to 5. */
export function bendClass(bends: number): number {
  let index = 0;
  while (index < BEND_STOPS.length - 1 && bends >= BEND_STOPS[index + 1]) index += 1;
  return index;
}

/**
 * Colour for a number of bent details. Whole numbers land exactly on their
 * class; averages blend between neighbouring classes.
 */
export function bendColor(mode: Mode, bends: number): string {
  const ramp = BEND_RAMP[mode];
  if (Number.isInteger(bends)) return ramp[bendClass(bends)];
  const index = bendClass(bends);
  if (index === BEND_STOPS.length - 1) return ramp[index];
  const span = BEND_STOPS[index + 1] - BEND_STOPS[index];
  return blend(ramp, index + (bends - BEND_STOPS[index]) / span);
}

/** Colour for a share of the maximum, 0 to 1, on the heat ramp. */
export function heatColor(mode: Mode, share: number): string {
  return blend(HEAT_RAMP[mode], share * (HEAT_RAMP[mode].length - 1));
}

/** Colours the canvas needs. Kept in step with the CSS tokens in index.css. */
export interface CanvasPalette {
  surface: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  idle: string;
  hull: string;
  truth: string;
}

export const CANVAS_PALETTE: Record<Mode, CanvasPalette> = {
  light: {
    surface: '#fbfbfc',
    ink: '#151821',
    inkSoft: '#4b5261',
    muted: '#7d8595',
    line: '#c8cdd8',
    idle: '#a3aab8',
    hull: 'rgba(21, 24, 33, 0.028)',
    truth: TRUTH_COLOR.light,
  },
  dark: {
    surface: '#151821',
    ink: '#eceef3',
    inkSoft: '#b5bbc8',
    muted: '#7f879a',
    line: '#343a4b',
    idle: '#59607a',
    hull: 'rgba(236, 238, 243, 0.035)',
    truth: TRUTH_COLOR.dark,
  },
};

function savedPreference(): Preference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  } catch {
    return 'system';
  }
}

const systemMode = (): Mode => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const NEXT: Record<Preference, Preference> = { system: 'light', light: 'dark', dark: 'system' };

/**
 * Light, dark, or follow the system. The toggle cycles through all three, so
 * the page can always go back to following the system after a manual choice.
 */
export function useTheme(): { mode: Mode; preference: Preference; cycle: () => void } {
  const [preference, setPreference] = useState<Preference>(savedPreference);
  const [system, setSystem] = useState<Mode>(systemMode);
  const mode = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    // Keep the browser chrome in step with the page background (--bg in index.css).
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', mode === 'dark' ? '#0e1016' : '#f3f4f7');
  }, [mode]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const cycle = useCallback(() => {
    const next = NEXT[preference];
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked. The toggle still works for this visit.
    }
    setPreference(next);
  }, [preference]);

  return { mode, preference, cycle };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
