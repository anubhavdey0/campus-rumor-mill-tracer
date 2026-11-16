/**
 * "Was this run typical?" The map shows one roll of the dice. This reruns the
 * same rumor on the same campus with many different rolls, for every route.
 *
 * Who hears the rumor never depends on the dice: credibility comes from trust
 * and friendships alone, so reach is identical in every rerun. The dice decide
 * how the story bends, so that is what the reruns measure.
 */

import type { Campus } from './campus';
import { hashInts } from './rng';
import type { RumorTemplate } from './rumor';
import { ALGORITHMS, simulate, summarize, type Algorithm, type FactChecker, type SpreadParams } from './spread';

export const RERUNS = 200;

export interface RouteRuns {
  /** Mean details bent per student, one value per rerun. */
  bends: number[];
  /** Students who kept the original wording, one value per rerun. */
  verbatim: number[];
}

export interface RerunResult {
  runs: number;
  students: number;
  routes: Record<Algorithm, RouteRuns>;
  /** Reruns in which each route bent the story strictly less than the other two. */
  straightest: Record<Algorithm, number>;
  /** Reruns with no single straightest route. */
  level: number;
}

export function rerun(
  campus: Campus,
  template: RumorTemplate,
  source: number,
  params: SpreadParams,
  runs: number = RERUNS,
  checker: FactChecker | null = null,
): RerunResult {
  const routes = Object.fromEntries(ALGORITHMS.map((a) => [a, { bends: [], verbatim: [] }])) as unknown as Record<
    Algorithm,
    RouteRuns
  >;
  const straightest = Object.fromEntries(ALGORITHMS.map((a) => [a, 0])) as Record<Algorithm, number>;
  let level = 0;

  for (let i = 0; i < runs; i++) {
    // Every route in a rerun shares the same dice, so they are compared like for like.
    const dice = { ...params, seed: hashInts(params.seed, i + 1, 0x51ed) };
    const bends = ALGORITHMS.map((algorithm) => {
      const summary = summarize(simulate(campus, template, source, algorithm, dice, checker));
      routes[algorithm].bends.push(summary.bends);
      routes[algorithm].verbatim.push(summary.verbatim);
      return summary.bends;
    });
    const least = Math.min(...bends);
    const winners = ALGORITHMS.filter((_, k) => Math.abs(bends[k] - least) < 1e-9);
    if (winners.length === 1) straightest[winners[0]] += 1;
    else level += 1;
  }

  return { runs, students: campus.students.length, routes, straightest, level };
}

/** The value below which `share` of the sorted values fall (nearest rank). */
export function quantile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index];
}

export interface Distribution {
  min: number;
  max: number;
  median: number;
  lowerQuartile: number;
  upperQuartile: number;
  /** Share of values strictly below `value`. */
  below: (value: number) => number;
  /** Share of values at or below `value`. */
  atOrBelow: (value: number) => number;
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = values.slice().sort((a, b) => a - b);
  const share = (test: (v: number) => boolean) =>
    sorted.length === 0 ? 0 : sorted.filter(test).length / sorted.length;
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median: quantile(sorted, 0.5),
    lowerQuartile: quantile(sorted, 0.25),
    upperQuartile: quantile(sorted, 0.75),
    below: (value) => share((v) => v < value - 1e-9),
    atOrBelow: (value) => share((v) => v <= value + 1e-9),
  };
}

/** Where one run sits among its reruns: high, low, typical, or every rerun the same. */
export type Standing = 'same' | 'high' | 'low' | 'typical';

export function standingOf(values: readonly number[], actual: number): Standing {
  const stats = distribution(values);
  if (stats.max - stats.min < 1e-9) return 'same';
  if (stats.below(actual) >= 0.75) return 'high';
  if (stats.atOrBelow(actual) <= 0.25) return 'low';
  return 'typical';
}

export interface TippingPoint {
  decay: number;
  reach: Record<Algorithm, number>;
}

/**
 * Reach for every route as the trust lost per hop rises, with the other dials
 * as set. Reach does not depend on the dice, so one run per point is exact.
 */
export function tippingCurve(
  campus: Campus,
  template: RumorTemplate,
  source: number,
  params: SpreadParams,
  checker: FactChecker | null = null,
  steps = 40,
  maxDecay = 0.4,
): TippingPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const decay = (maxDecay * i) / steps;
    const reach = Object.fromEntries(
      ALGORITHMS.map((algorithm) => [
        algorithm,
        summarize(simulate(campus, template, source, algorithm, { ...params, decay }, checker)).heard,
      ]),
    ) as Record<Algorithm, number>;
    return { decay, reach };
  });
}
