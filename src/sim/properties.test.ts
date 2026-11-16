/**
 * Property tests: the rules that must hold for every campus, rumor, route,
 * and dial setting, checked across many generated scenarios. A smaller,
 * permanent version of the stress test used during the audit.
 */

import { describe, expect, it } from 'vitest';
import { generateCampus, type Campus } from './campus';
import { findBridges, mostBelievablePath, reachFromEach, withCuts } from './network';
import { mulberry32 } from './rng';
import { CUSTOM_EXAMPLE, PRESETS, parseCustomRumor } from './rumor';
import { tippingCurve } from './rerun';
import {
  ALGORITHMS,
  chainTo,
  hopProfile,
  simulate,
  summarize,
  type FactChecker,
  type SpreadParams,
  type Trace,
} from './spread';

const templates = [...PRESETS, parseCustomRumor(CUSTOM_EXAMPLE)];

/** Every friend list, from both ends, as a set of "a-b" keys. */
const neighbours = (campus: Campus, a: number, b: number) => campus.friends[a].some((friend) => friend.id === b);

function checkTrace(campus: Campus, trace: Trace, params: SpreadParams) {
  const heard: number[] = [];
  trace.ticks.forEach((tick, i) => {
    expect(tick.index).toBe(i);
    if (tick.kind === 'tell') {
      const speaker = trace.hearings[tick.speaker]!;
      expect(speaker.repeats).toBe(true);
      expect(speaker.tick).toBeLessThan(i);
      expect(speaker.truth).toBe(tick.truth);
      for (const id of tick.listeners) {
        const hearing = trace.hearings[id]!;
        expect(hearing.tick).toBe(i);
        expect(hearing.from).toBe(tick.speaker);
        expect(hearing.truth).toBe(tick.truth);
        expect(neighbours(campus, tick.speaker, id)).toBe(true); // never along a cut friendship
        heard.push(id);
      }
    } else {
      expect(trace.algorithm).toBe('dfs');
      for (let k = 0; k < tick.path.length - 1; k++) expect(trace.hearings[tick.path[k]]!.from).toBe(tick.path[k + 1]);
    }
  });
  // Nobody hears twice, and the two starting students are never told anything.
  expect(new Set(heard).size).toBe(heard.length);
  expect(heard).not.toContain(trace.source);
  if (trace.checker !== null) expect(heard).not.toContain(trace.checker);

  for (const hearing of trace.hearings) {
    if (!hearing) continue;
    expect(hearing.credibility).toBeGreaterThan(0);
    expect(hearing.credibility).toBeLessThanOrEqual(1);
    if (hearing.truth) {
      // The truth never bends.
      expect(hearing.bends).toBe(0);
      expect(hearing.bent).toBe(false);
    }
    if (hearing.from !== null) {
      const teller = trace.hearings[hearing.from]!;
      expect(teller.truth).toBe(hearing.truth);
      expect(hearing.credibility).toBeLessThanOrEqual(teller.credibility);
      expect(hearing.repeats).toBe(hearing.credibility >= params.cutoff);
      const chain = chainTo(trace, hearing.student);
      expect(chain[0].student).toBe(hearing.truth ? trace.checker : trace.source);
      expect(chain).toHaveLength(hearing.hop + 1);
    }
  }

  const summary = summarize(trace);
  expect(summary.heard + summary.corrected).toBe(heard.length + 1 + (trace.checker === null ? 0 : 1));
  expect(hopProfile(trace).reduce((sum, bucket) => sum + bucket.count, 0)).toBe(summary.heard - 1);

  // Whoever never heard anything has no friend still repeating either side.
  trace.hearings.forEach((hearing, id) => {
    if (hearing) return;
    for (const friend of campus.friends[id]) {
      const other = trace.hearings[friend.id];
      expect(other === null || !other.repeats).toBe(true);
    }
  });
}

describe('spread properties', () => {
  it('hold on every route, with and without a fact-checker and cut friendships', () => {
    const rng = mulberry32(2024);
    let runs = 0;
    for (const size of [24, 40, 60, 80, 96]) {
      for (let seed = 1; seed <= 8; seed++) {
        const base = generateCampus(seed * 13 + size, size);
        const cuts = rng() < 0.5 ? base.ties.filter(() => rng() < 0.08).map((tie) => tie.id) : [];
        const campus = withCuts(base, cuts);
        const template = templates[Math.floor(rng() * templates.length)];
        const params: SpreadParams = {
          decay: rng() * 0.4,
          distortion: rng() * 0.9,
          cutoff: 0.05 + rng() * 0.5,
          seed,
        };
        const source = Math.floor(rng() * size);
        const checker: FactChecker | null =
          rng() < 0.6
            ? { student: (source + 1 + Math.floor(rng() * (size - 1))) % size, lead: Math.floor(rng() * 6) }
            : null;

        for (const algorithm of ALGORITHMS) {
          const trace = simulate(campus, template, source, algorithm, params, checker);
          checkTrace(campus, trace, params);
          expect(simulate(campus, template, source, algorithm, params, checker)).toEqual(trace);
          runs += 1;
        }
      }
    }
    expect(runs).toBe(5 * 8 * 3);
  });

  it('trusted first always lets the most credible waiting student speak next', () => {
    const campus = generateCampus(77, 56);
    const params = { decay: 0.2, distortion: 0.3, cutoff: 0.2, seed: 3 };
    const trace = simulate(campus, PRESETS[1], campus.defaultSource, 'best', params);
    let previous: number[] = [campus.defaultSource];
    for (const tick of trace.ticks) {
      if (tick.kind !== 'tell') continue;
      const speaker = trace.hearings[tick.speaker]!;
      // Of the students who were waiting before this tick and are still waiting after it,
      // nobody held a more credible version than the one who spoke. (Students with nobody
      // left to tell leave the queue without a visible tick, so they are not compared.)
      const stillWaiting = new Set(tick.frontier);
      for (const id of previous) {
        if (id === tick.speaker || !stillWaiting.has(id)) continue;
        expect(trace.hearings[id]!.credibility).toBeLessThanOrEqual(speaker.credibility);
      }
      expect(tick.frontier.map((id) => trace.hearings[id]!.credibility)).toEqual(
        tick.frontier.map((id) => trace.hearings[id]!.credibility).sort((a, b) => b - a),
      );
      previous = tick.frontier;
    }
  });

  it('the fact-checker reaches people, and the truth is never bent', () => {
    const campus = generateCampus(12, 56);
    const params = { decay: 0.12, distortion: 0.6, cutoff: 0.2, seed: 5 };
    const far = campus.groups[campus.groups.length - 1].members[0];
    for (const algorithm of ALGORITHMS) {
      const trace = simulate(campus, PRESETS[0], campus.defaultSource, algorithm, params, { student: far, lead: 0 });
      const summary = summarize(trace);
      expect(trace.checker).toBe(far);
      expect(summary.corrected).toBeGreaterThan(1);
      expect(trace.hearings[far]!.truth).toBe(true);
    }
  });

  it('a fact-checker who is also the source is ignored', () => {
    const campus = generateCampus(12, 40);
    const params = { decay: 0.12, distortion: 0.3, cutoff: 0.2, seed: 5 };
    const trace = simulate(campus, PRESETS[0], 3, 'bfs', params, { student: 3, lead: 0 });
    expect(trace.checker).toBeNull();
    expect(trace).toEqual(simulate(campus, PRESETS[0], 3, 'bfs', params));
  });
});

describe('network', () => {
  it('cut friendships carry nothing in either direction', () => {
    const base = generateCampus(5, 48);
    const campus = withCuts(base, [0, 3, 9]);
    for (const id of [0, 3, 9]) {
      const tie = campus.ties[id];
      expect(tie.cut).toBe(true);
      expect(neighbours(campus, tie.a, tie.b)).toBe(false);
      expect(neighbours(campus, tie.b, tie.a)).toBe(false);
    }
    expect(withCuts(base, [])).toBe(base);
  });

  it('cutting a bridge leaves exactly the counted students out of reach', () => {
    const params = { decay: 0, distortion: 0, cutoff: 0, seed: 1 };
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const campus = generateCampus(seed, 56);
      for (const [tieId, isolated] of findBridges(campus)) {
        const tie = campus.ties[tieId];
        const reach = (from: number) =>
          summarize(simulate(withCuts(campus, [tieId]), PRESETS[0], from, 'bfs', params)).heard;
        const sides = [reach(tie.a), reach(tie.b)];
        expect(Math.min(...sides)).toBe(isolated);
        expect(sides[0] + sides[1]).toBe(56);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('finds every bridge in a simple chain', () => {
    const campus = generateCampus(1, 24);
    // Keep only a spanning chain 0-1-2-...: every remaining friendship is a bridge.
    const chain = withCuts(
      campus,
      campus.ties.filter((tie) => Math.abs(tie.a - tie.b) !== 1 || Math.min(tie.a, tie.b) > 22).map((tie) => tie.id),
    );
    const bridges = findBridges(chain);
    for (const [tieId, isolated] of bridges) {
      const tie = chain.ties[tieId];
      expect(tie.cut).toBeFalsy();
      expect(isolated).toBeGreaterThanOrEqual(1);
    }
  });

  it('the most believable route is at least as credible as the route any run took', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const campus = generateCampus(seed, 56);
      const params = { decay: 0.18, distortion: 0.3, cutoff: 0.2, seed };
      for (const algorithm of ALGORITHMS) {
        const trace = simulate(campus, PRESETS[0], campus.defaultSource, algorithm, params);
        for (const hearing of trace.hearings) {
          if (!hearing || hearing.from === null) continue;
          const best = mostBelievablePath(campus, campus.defaultSource, hearing.student, params.decay, params.cutoff);
          expect(best).not.toBeNull();
          expect(best!.path[0]).toBe(campus.defaultSource);
          expect(best!.path[best!.path.length - 1]).toBe(hearing.student);
          expect(best!.credibility[best!.credibility.length - 1]).toBeGreaterThanOrEqual(hearing.credibility - 1e-12);
          // Everyone before the target is credible enough to repeat it.
          for (const credibility of best!.credibility.slice(1, -1))
            expect(credibility).toBeGreaterThanOrEqual(params.cutoff);
        }
      }
    }
  });

  it('reach from each student matches running the spread from them', () => {
    const campus = generateCampus(9, 40);
    const params = { decay: 0.2, distortion: 0.3, cutoff: 0.25, seed: 2 };
    const reach = reachFromEach(campus, PRESETS[0], 'dfs', params);
    expect(reach).toHaveLength(40);
    for (const id of [0, 7, 19, 39]) {
      expect(reach[id]).toBe(summarize(simulate(campus, PRESETS[0], id, 'dfs', params)).heard);
    }
  });

  it('the tipping curve sweeps the dial and reach falls overall as trust drains', () => {
    // Not strictly downhill: when one student stops repeating, a friend may hear it
    // from a more trusted neighbour instead and carry it further. The trend still falls.
    const campus = generateCampus(31, 64);
    const curve = tippingCurve(campus, PRESETS[0], campus.defaultSource, {
      decay: 0,
      distortion: 0.3,
      cutoff: 0.25,
      seed: 4,
    });
    expect(curve).toHaveLength(41);
    expect(curve[0].decay).toBe(0);
    expect(curve[40].decay).toBeCloseTo(0.4);
    for (const point of curve) {
      for (const algorithm of ALGORITHMS) {
        expect(point.reach[algorithm]).toBeGreaterThanOrEqual(1);
        expect(point.reach[algorithm]).toBeLessThanOrEqual(64);
      }
    }
    for (const algorithm of ALGORITHMS) {
      expect(curve[40].reach[algorithm]).toBeLessThan(curve[0].reach[algorithm]);
    }
  });
});
