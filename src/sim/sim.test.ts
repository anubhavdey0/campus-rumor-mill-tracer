import { describe, expect, it } from 'vitest';
import { generateCampus, type Campus } from './campus';
import { layoutCampus } from './layout';
import {
  CUSTOM_EXAMPLE,
  PRESETS,
  cleanCustomText,
  driftOf,
  maxDrift,
  mutateVersion,
  originalVersion,
  parseCustomRumor,
  renderVersion,
} from './rumor';
import { chainTo, hopProfile, simulate, summarize, type SpreadParams } from './spread';

const template = PRESETS[0];
const lossless: SpreadParams = { decay: 0, distortion: 0, cutoff: 0, seed: 11 };
const lossy: SpreadParams = { decay: 0.2, distortion: 0.4, cutoff: 0.25, seed: 11 };

/** Plain BFS distances, written independently of the simulator. */
function distances(campus: Campus, source: number): number[] {
  const dist = campus.students.map(() => -1);
  dist[source] = 0;
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    for (const friend of campus.friends[queue[head]]) {
      if (dist[friend.id] === -1) {
        dist[friend.id] = dist[queue[head]] + 1;
        queue.push(friend.id);
      }
    }
  }
  return dist;
}

describe('campus', () => {
  it('is deterministic for a seed', () => {
    expect(generateCampus(42, 56)).toEqual(generateCampus(42, 56));
    expect(generateCampus(42, 56).ties).not.toEqual(generateCampus(43, 56).ties);
  });

  it('is one connected graph with unique names', () => {
    for (const size of [24, 56, 96]) {
      for (let seed = 1; seed <= 25; seed++) {
        const campus = generateCampus(seed, size);
        expect(campus.students).toHaveLength(size);
        expect(new Set(campus.students.map((s) => s.name)).size).toBe(size);
        expect(distances(campus, 0).every((d) => d >= 0)).toBe(true);
      }
    }
  });

  it('lists closest friends first', () => {
    const campus = generateCampus(7, 56);
    for (const list of campus.friends) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1].closeness).toBeGreaterThanOrEqual(list[i].closeness);
      }
    }
  });
});

describe('rumor', () => {
  it('renders the original wording at version zero', () => {
    expect(renderVersion(template, originalVersion(template))).toBe(
      'Prof. Rao might postpone Friday’s quiz because the projector is broken.',
    );
  });

  it('bends exactly one segment by one step', () => {
    const before = originalVersion(template);
    const result = mutateVersion(template, before, 0.5)!;
    const changed = result.version.filter((level, i) => level !== before[i]);
    expect(changed).toEqual([1]);
    expect(driftOf(template, result.version)).toBeCloseTo(1 / maxDrift(template));
  });

  it('stops bending once every segment is maxed out', () => {
    let version = originalVersion(template);
    for (let i = 0; i < maxDrift(template); i++) {
      version = mutateVersion(template, version, 0.3)!.version;
    }
    expect(driftOf(template, version)).toBe(1);
    expect(mutateVersion(template, version, 0.3)).toBeNull();
  });

  it('keeps every preset grammatical at the extremes', () => {
    for (const preset of PRESETS) {
      const wildest = preset.segments.map((segment) => segment.variants.length - 1);
      const text = renderVersion(preset, wildest);
      expect(text).toMatch(/^[A-Z].*\.$/);
      expect(text).not.toMatch(/\s{2,}/);
    }
  });

  it('parses free text into mutable segments without changing it', () => {
    const custom = parseCustomRumor(CUSTOM_EXAMPLE);
    expect(renderVersion(custom, originalVersion(custom))).toBe(cleanCustomText(CUSTOM_EXAMPLE));
    const mutable = custom.segments.filter((segment) => segment.variants.length > 1);
    expect(mutable.map((segment) => segment.variants[0])).toEqual([
      'Someone',
      'said',
      'might',
      'closed',
      'a week',
      'a few',
      'could',
      'fined',
      '',
    ]);
    expect(mutable[0].variants[1]).toBe('A group of people');
  });

  it('inflates numbers but leaves clock times and years alone', () => {
    const custom = parseCustomRumor('In 2026 the fee goes up by 20 rupees at 10 pm.');
    const mutable = custom.segments.filter((segment) => segment.variants.length > 1);
    expect(mutable[0].variants).toEqual(['20', '40', '100', '200']);
    expect(mutable).toHaveLength(2); // the number and the trailing embellishment
  });

  it('always leaves something to bend', () => {
    const custom = parseCustomRumor('Nothing here matches');
    expect(maxDrift(custom)).toBeGreaterThan(0);
    expect(renderVersion(custom, originalVersion(custom))).toBe('Nothing here matches');
  });
});

describe('spread', () => {
  const campus = generateCampus(42, 56);
  const source = campus.defaultSource;

  it('is deterministic', () => {
    expect(simulate(campus, template, source, 'bfs', lossy)).toEqual(simulate(campus, template, source, 'bfs', lossy));
    expect(simulate(campus, template, source, 'dfs', lossy)).toEqual(simulate(campus, template, source, 'dfs', lossy));
  });

  it('broadcast reaches everyone by the shortest path when nothing decays', () => {
    const trace = simulate(campus, template, source, 'bfs', lossless);
    const dist = distances(campus, source);
    trace.hearings.forEach((hearing, id) => {
      expect(hearing).not.toBeNull();
      expect(hearing!.hop).toBe(dist[id]);
    });
  });

  it('whisper chain reaches everyone too, by paths at least as long', () => {
    const trace = simulate(campus, template, source, 'dfs', lossless);
    const dist = distances(campus, source);
    trace.hearings.forEach((hearing, id) => {
      expect(hearing).not.toBeNull();
      expect(hearing!.hop).toBeGreaterThanOrEqual(dist[id]);
    });
    expect(summarize(trace).deepestHop).toBeGreaterThan(Math.max(...dist));
  });

  it('whisper chain always tells the closest friend who has not heard it', () => {
    const trace = simulate(campus, template, source, 'dfs', lossless);
    const heard = new Set([source]);
    for (const tick of trace.ticks) {
      if (tick.kind !== 'tell') continue;
      const expected = campus.friends[tick.speaker].find((friend) => !heard.has(friend.id))!;
      expect(tick.listeners).toEqual([expected.id]);
      heard.add(expected.id);
    }
  });

  it('nobody hears the rumor twice', () => {
    for (const algorithm of ['bfs', 'dfs'] as const) {
      const trace = simulate(campus, template, source, algorithm, lossy);
      const listeners = trace.ticks.flatMap((tick) => (tick.kind === 'tell' ? tick.listeners : []));
      expect(new Set(listeners).size).toBe(listeners.length);
      expect(listeners).not.toContain(source);
    }
  });

  it('credibility only falls along a chain, and dead ends never speak', () => {
    for (const algorithm of ['bfs', 'dfs'] as const) {
      const trace = simulate(campus, template, source, algorithm, lossy);
      for (const hearing of trace.hearings) {
        if (!hearing || hearing.from === null) continue;
        const teller = trace.hearings[hearing.from]!;
        expect(hearing.credibility).toBeLessThan(teller.credibility);
        expect(hearing.hop).toBe(teller.hop + 1);
        expect(teller.repeats).toBe(true);
        expect(hearing.repeats).toBe(hearing.credibility >= lossy.cutoff);
      }
    }
  });

  it('drift never shrinks along a chain', () => {
    const trace = simulate(campus, template, source, 'dfs', lossy);
    for (const hearing of trace.hearings) {
      if (!hearing || hearing.from === null) continue;
      expect(hearing.drift).toBeGreaterThanOrEqual(trace.hearings[hearing.from]!.drift);
    }
  });

  it('stays verbatim when distortion is zero', () => {
    const trace = simulate(campus, template, source, 'dfs', { ...lossy, distortion: 0 });
    expect(summarize(trace).fidelity).toBe(1);
  });

  it('more decay never reaches more students by broadcast', () => {
    const mild = summarize(simulate(campus, template, source, 'bfs', { ...lossy, decay: 0.1 }));
    const harsh = summarize(simulate(campus, template, source, 'bfs', { ...lossy, decay: 0.35 }));
    expect(harsh.repeating).toBeLessThanOrEqual(mild.repeating);
  });

  it('summaries, hop profiles, and chains agree with each other', () => {
    const trace = simulate(campus, template, source, 'bfs', lossy);
    const summary = summarize(trace);
    const profile = hopProfile(trace);
    expect(profile.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(summary.heard - 1);
    expect(profile).toHaveLength(summary.deepestHop);
    expect(summarize(trace, 0).heard).toBe(1);

    const last = trace.hearings.find((hearing) => hearing && hearing.hop === summary.deepestHop)!;
    const chain = chainTo(trace, last.student);
    expect(chain[0].student).toBe(source);
    expect(chain).toHaveLength(summary.deepestHop + 1);
  });
});

describe('layout', () => {
  it('places every student inside the unit square', () => {
    const campus = generateCampus(42, 72);
    const points = layoutCampus(campus, 1.5);
    expect(points).toHaveLength(72);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});
