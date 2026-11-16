import { describe, expect, it } from 'vitest';
import { generateCampus } from './campus';
import { layoutCampus, quickLayout } from './layout';
import { PRESETS, isUsableRumor, originalVersion, parseCustomRumor, renderVersion } from './rumor';
import { distribution, rerun, standingOf } from './rerun';
import { simulate, summarize, type SpreadParams } from './spread';
import { depthOf, versionTree } from './versions';

const template = PRESETS[0];
const params: SpreadParams = { decay: 0.16, distortion: 0.5, cutoff: 0.25, seed: 7 };

const quantities = (text: string) =>
  parseCustomRumor(text)
    .segments.filter((segment) => segment.variants.length > 1 && /^\d/.test(segment.variants[0]))
    .map((segment) => segment.variants[0]);

describe('custom rumor parsing', () => {
  it('inflates real quantities', () => {
    expect(quantities('20 people might fail and 2.5 hours were lost')).toEqual(['20', '2.5']);
  });

  it('leaves times, dates, labels, and codes alone', () => {
    expect(quantities('The exam is at 3:30 on Monday')).toEqual([]);
    expect(quantities('Quiz 1 is on 12.5.2026 for 2nd years')).toEqual([]);
    expect(quantities('Room 204 closes at 10 pm, gate 3 at 9')).toEqual([]);
    expect(quantities('Agent 007 owes 1,000 rupees')).toEqual([]);
    expect(quantities('Section B12 meets in hall no. 4')).toEqual([]);
  });

  it('keeps the original text intact', () => {
    const text = 'The exam is at 3:30 and Room 204 has 20 seats.';
    const parsed = parseCustomRumor(text);
    expect(renderVersion(parsed, originalVersion(parsed))).toBe(text);
  });

  it('matches all-caps words when it exaggerates them', () => {
    const parsed = parseCustomRumor('The QUIZ might be POSTPONED');
    const variants = parsed.segments.filter((s) => s.variants.length > 1).map((s) => s.variants[1]);
    expect(variants).toContain('TEST');
    expect(variants).toContain('CANCELLED');
  });

  it('only accepts real sentences', () => {
    expect(isUsableRumor('!!!!!!!!!!')).toBe(false);
    expect(isUsableRumor('12345678')).toBe(false);
    expect(isUsableRumor('aaaaaaaaaaaa')).toBe(false);
    expect(isUsableRumor('Gym closed')).toBe(true);
    expect(isUsableRumor('परीक्षा might be postponed')).toBe(true);
  });
});

describe('queue and stack snapshots', () => {
  const campus = generateCampus(42, 56);
  const source = campus.defaultSource;

  it('broadcast: the queue only ever holds students who know the rumor, each once', () => {
    const trace = simulate(campus, template, source, 'bfs', params);
    for (const tick of trace.ticks) {
      if (tick.kind !== 'tell') throw new Error('broadcast has no backtracks');
      expect(new Set(tick.frontier).size).toBe(tick.frontier.length);
      expect(tick.frontier).not.toContain(tick.speaker);
      // whoever was just told joins the back of the queue, in order
      expect(tick.frontier.slice(-tick.listeners.length)).toEqual(tick.listeners);
      for (const id of tick.frontier) expect(trace.hearings[id]!.tick).toBeLessThanOrEqual(tick.index);
    }
  });

  it('whisper chain: the top of the stack is whoever speaks next', () => {
    const trace = simulate(campus, template, source, 'dfs', params);
    for (const tick of trace.ticks) {
      const top = tick.frontier[tick.frontier.length - 1];
      if (tick.kind === 'tell') expect(top).toBe(tick.listeners[0]);
      else expect(top).toBe(tick.path[tick.path.length - 1]);
      expect(tick.frontier[0]).toBe(source);
      // every student on the stack was told by the one below them
      for (let i = 1; i < tick.frontier.length; i++) {
        expect(trace.hearings[tick.frontier[i]]!.from).toBe(tick.frontier[i - 1]);
      }
    }
  });
});

describe('version tree', () => {
  const campus = generateCampus(42, 56);
  const trace = simulate(campus, template, campus.defaultSource, 'dfs', params);

  it('accounts for every student exactly once', () => {
    const tree = versionTree(trace);
    const holders = tree.nodes.flatMap((node) => node.holders);
    expect(new Set(holders).size).toBe(holders.length);
    expect(holders.length).toBe(summarize(trace).heard);
    expect(tree.root.holders).toContain(trace.source);
    expect(tree.nodes[0]).toBe(tree.root);
  });

  it('each version is one detail, one step away from its parent', () => {
    const tree = versionTree(trace);
    expect(tree.nodes.length).toBeGreaterThan(3);
    for (const node of tree.nodes) {
      if (!node.parent) continue;
      const diffs = node.version.map((level, i) => level - node.parent!.version[i]).filter((d) => d !== 0);
      expect(diffs).toEqual([1]);
      expect(node.version[node.changedSegment!]).toBe(node.parent.version[node.changedSegment!] + 1);
      expect(depthOf(node)).toBe(depthOf(node.parent) + 1);
      expect(node.parent.firstTick).toBeLessThanOrEqual(node.firstTick);
    }
    for (const holder of tree.nodes.flatMap((node) => node.holders.map((id) => [node, id] as const))) {
      expect(trace.hearings[holder[1]]!.version).toEqual(holder[0].version);
    }
  });

  it('grows as the run plays', () => {
    expect(versionTree(trace, 0).nodes).toHaveLength(1);
    expect(versionTree(trace, 0).root.holders).toEqual([trace.source]);
    const sizes = [5, 15, 30, Infinity].map((t) => versionTree(trace, t).nodes.length);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });
});

describe('reruns', () => {
  const campus = generateCampus(42, 56);

  it('is deterministic and stays in range', () => {
    const a = rerun(campus, template, campus.defaultSource, params, 60);
    expect(rerun(campus, template, campus.defaultSource, params, 60)).toEqual(a);
    for (const route of [a.routes.bfs, a.routes.dfs]) {
      expect(route.bends).toHaveLength(60);
      for (const bends of route.bends) expect(bends).toBeGreaterThanOrEqual(0);
      for (const verbatim of route.verbatim) {
        expect(verbatim).toBeGreaterThanOrEqual(1);
        expect(verbatim).toBeLessThanOrEqual(56);
      }
    }
    expect(a.straightest.bfs + a.straightest.dfs + a.straightest.best + a.level).toBe(60);
  });

  it('really uses different dice, which change the wording but never who hears it', () => {
    const result = rerun(campus, template, campus.defaultSource, params, 60);
    expect(new Set(result.routes.dfs.bends).size).toBeGreaterThan(10);
    const reach = new Set(
      [1, 2, 3, 4, 5].map(
        (seed) => summarize(simulate(campus, template, campus.defaultSource, 'dfs', { ...params, seed })).heard,
      ),
    );
    expect(reach.size).toBe(1);
  });

  it('with no distortion every rerun keeps the story straight', () => {
    const result = rerun(campus, template, campus.defaultSource, { ...params, distortion: 0 }, 20);
    expect(result.routes.bfs.bends.every((b) => b === 0)).toBe(true);
    expect(result.level).toBe(20);
  });

  it('describes a distribution', () => {
    const stats = distribution([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stats.median).toBe(4);
    expect(stats.lowerQuartile).toBe(2);
    expect(stats.upperQuartile).toBe(6);
    expect(stats.below(5)).toBe(0.5);
    expect(stats.atOrBelow(5)).toBe(0.625);
    expect(standingOf([3, 3, 3], 3)).toBe('same');
    expect(standingOf([1, 2, 3, 4, 5, 6, 7, 8], 8)).toBe('high');
    expect(standingOf([1, 2, 3, 4, 5, 6, 7, 8], 1)).toBe('low');
    expect(standingOf([1, 2, 3, 4, 5, 6, 7, 8], 5)).toBe('typical');
  });
});

describe('quick layout', () => {
  it('places every student and matches the full layout in size', () => {
    const campus = generateCampus(3, 40);
    const quick = quickLayout(campus, 1.5);
    expect(quick).toHaveLength(40);
    expect(layoutCampus(campus, 1.5)).toHaveLength(40);
    for (const point of quick) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
    }
  });
});
