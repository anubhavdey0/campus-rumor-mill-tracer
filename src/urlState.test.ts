import { describe, expect, it } from 'vitest';
import { parseScenario, scenarioQuery, type Scenario } from './urlState';

const DEFAULTS: Scenario = {
  seed: 4821,
  settings: { rumorId: 'quiz', algorithm: 'bfs', decay: 0.16, distortion: 0.35, cutoff: 0.25, size: 56 },
  source: null,
  customText: 'Someone said the gym might be closed for a week.',
  checker: null,
  lead: 2,
  cuts: [],
};

describe('shareable links', () => {
  it('writes nothing when every value is a default', () => {
    expect(scenarioQuery(DEFAULTS, DEFAULTS)).toBe('');
    expect(parseScenario('', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('round-trips every setting', () => {
    const scenario: Scenario = {
      seed: 777,
      settings: { rumorId: 'custom', algorithm: 'best', decay: 0.3, distortion: 0.55, cutoff: 0.4, size: 72 },
      source: 5,
      customText: 'The dean might cancel the fest on Friday.',
      checker: 40,
      lead: 6,
      cuts: [2, 17, 33],
    };
    const query = scenarioQuery(scenario, DEFAULTS);
    expect(query).toContain('cut=2,17,33');
    expect(query).toContain('route=best');
    expect(parseScenario(`?${query}`, DEFAULTS)).toEqual(scenario);
  });

  it('falls back to defaults for anything broken', () => {
    const parsed = parseScenario(
      '?campus=abc&students=9999&rumor=nope&route=zigzag&decay=-4&bend=999&cutoff=x&from=500&checker=-1&lead=99&cut=a,,-3,5,5&text=!!',
      DEFAULTS,
    );
    expect(parsed.seed).toBe(4821);
    expect(parsed.settings.size).toBe(96);
    expect(parsed.settings.rumorId).toBe('quiz');
    expect(parsed.settings.algorithm).toBe('bfs');
    expect(parsed.settings.decay).toBe(0);
    expect(parsed.settings.distortion).toBe(0.9);
    expect(parsed.settings.cutoff).toBe(0.25);
    expect(parsed.source).toBeNull();
    expect(parsed.checker).toBeNull();
    expect(parsed.lead).toBe(8);
    expect(parsed.cuts).toEqual([5]);
    expect(parsed.customText).toBe(DEFAULTS.customText);
  });

  it('drops a fact-checker who is also the source', () => {
    expect(parseScenario('?from=4&checker=4', DEFAULTS).checker).toBeNull();
    expect(parseScenario('?from=4&checker=9', DEFAULTS).checker).toBe(9);
  });

  it('only writes the head start when there is a fact-checker', () => {
    expect(scenarioQuery({ ...DEFAULTS, lead: 5 }, DEFAULTS)).toBe('');
    expect(scenarioQuery({ ...DEFAULTS, checker: 3, lead: 5 }, DEFAULTS)).toBe('checker=3&lead=5');
  });
});
