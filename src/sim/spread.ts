/**
 * The spread. Three graph traversals, reframed as gossip:
 *
 *   Broadcast (BFS)          a queue. Everyone who has heard the rumor tells all
 *                            of their friends before the next wave starts.
 *   Whisper chain (DFS)      a stack. Each student tells their closest friend who
 *                            has not heard it, and that friend does the same.
 *   Trusted first (best-first search)
 *                            a priority queue. Whoever holds the most credible
 *                            version speaks next and tells all of their friends.
 *
 * All three run on the same rules:
 *   1. First version sticks. A student who has heard the rumor ignores later
 *      versions. This is the "visited" set.
 *   2. Every hop costs credibility. Close friends lose less.
 *   3. Every retelling may bend one detail of the story.
 *   4. Below the cutoff a student still hears it but will not repeat it.
 *
 * Optionally a fact-checker knows the truth and starts spreading it after the
 * rumor's head start. The truth travels by the same route and the same rules,
 * except it never bends. Whoever reaches a student first wins them over.
 *
 * The whole run is computed up front as a list of ticks, so the interface can
 * play it, pause it, scrub it, and step backwards.
 */

import type { Campus, Friend } from './campus';
import { clamp, hashInts, mulberry32 } from './rng';
import { bendsOf, driftOf, mutateVersion, originalVersion, type RumorTemplate, type Version } from './rumor';

export type Algorithm = 'bfs' | 'dfs' | 'best';

export const ALGORITHMS: readonly Algorithm[] = ['bfs', 'dfs', 'best'];

export const ROUTE_NAMES: Record<Algorithm, { name: string; search: string }> = {
  bfs: { name: 'Broadcast', search: 'Breadth-first search' },
  dfs: { name: 'Whisper chain', search: 'Depth-first search' },
  best: { name: 'Trusted first', search: 'Best-first search' },
};

export interface SpreadParams {
  /** Share of credibility lost on an average hop, 0 to 1. */
  decay: number;
  /** Chance that a retelling bends the story, 0 to 1. */
  distortion: number;
  /** Students below this credibility stop repeating the rumor. */
  cutoff: number;
  /** Seeds the per-friendship dice. */
  seed: number;
}

export interface FactChecker {
  student: number;
  /**
   * The rumor's head start: waves for broadcast, retellings for the other routes.
   */
  lead: number;
}

/** What one student ended up with. */
export interface Hearing {
  student: number;
  /** Who told them. Null for the rumor's source and for the fact-checker. */
  from: number | null;
  tie: number | null;
  hop: number;
  credibility: number;
  version: Version;
  /** The version the teller held, for showing exactly what changed. */
  previous: Version | null;
  /** How many details differ from the truth (total ladder steps). */
  bends: number;
  /** Bends as a share of the most this rumor can bend, 0 to 1. */
  drift: number;
  /** True when this retelling bent the story. */
  bent: boolean;
  bentSegment: number | null;
  /** False when credibility fell below the cutoff: a dead end. */
  repeats: boolean;
  /** True when this student heard the fact-checker's correction rather than the rumor. */
  truth: boolean;
  /** Index of the tick in which they heard it. -1 for the two starting students. */
  tick: number;
}

/**
 * Every tick carries a snapshot of the frontier right after it: the queue
 * (next to speak first), the stack (bottom first, top last), or the priority
 * queue (most credible first).
 */
export type Tick =
  | {
      kind: 'tell';
      index: number;
      speaker: number;
      listeners: number[];
      hop: number;
      frontier: number[];
      truth: boolean;
    }
  /** The whisper chain hit a dead end at path[0] and resumes from the last entry. */
  | { kind: 'backtrack'; index: number; path: number[]; frontier: number[]; truth: boolean };

export interface Trace {
  algorithm: Algorithm;
  source: number;
  /** The fact-checker, if one took part. */
  checker: number | null;
  ticks: Tick[];
  /** Indexed by student id. Null means nothing reached them. */
  hearings: (Hearing | null)[];
}

export const SKEPTIC_FACTOR = 0.7;
export const EMBELLISHER_FACTOR = 2;

/** Credibility kept across one friendship. Close friends (closeness 1) lose the least. */
export function retention(decay: number, closeness: number): number {
  return 1 - clamp(decay * (1.5 - closeness), 0, 0.95);
}

/**
 * One retelling. The dice are seeded by the pair of students, not by the
 * order of events, so the same friendship behaves identically on every route.
 * Only the route changes.
 */
function tell(
  campus: Campus,
  template: RumorTemplate,
  params: SpreadParams,
  speaker: Hearing,
  friend: Friend,
  tick: number,
): Hearing {
  const teller = campus.students[speaker.student];
  const listener = campus.students[friend.id];
  const dice = mulberry32(hashInts(params.seed, speaker.student, friend.id));
  const bendRoll = dice();
  const segmentRoll = dice();

  let credibility = speaker.credibility * retention(params.decay, friend.closeness);
  if (listener.trait === 'skeptic') credibility *= SKEPTIC_FACTOR;

  let bendChance = params.distortion;
  if (teller.trait === 'embellisher') bendChance *= EMBELLISHER_FACTOR;
  if (teller.trait === 'stickler' || speaker.truth) bendChance = 0;

  let version = speaker.version;
  let bent = false;
  let bentSegment: number | null = null;
  if (bendRoll < clamp(bendChance, 0, 0.95)) {
    const mutation = mutateVersion(template, version, segmentRoll);
    if (mutation) {
      version = mutation.version;
      bent = true;
      bentSegment = mutation.segment;
    }
  }

  return {
    student: friend.id,
    from: speaker.student,
    tie: friend.tie,
    hop: speaker.hop + 1,
    credibility,
    version,
    previous: speaker.version,
    bends: bendsOf(version),
    drift: driftOf(template, version),
    bent,
    bentSegment,
    repeats: credibility >= params.cutoff,
    truth: speaker.truth,
    tick,
  };
}

function startHearing(template: RumorTemplate, student: number, truth: boolean): Hearing {
  return {
    student,
    from: null,
    tie: null,
    hop: 0,
    credibility: 1,
    version: originalVersion(template),
    previous: null,
    bends: 0,
    drift: 0,
    bent: false,
    bentSegment: null,
    repeats: true,
    truth,
    tick: -1,
  };
}

interface Run {
  campus: Campus;
  template: RumorTemplate;
  params: SpreadParams;
  hearings: (Hearing | null)[];
  ticks: Tick[];
}

/** Tells every friend who has heard nothing yet. Returns who was told. */
function tellAll(run: Run, speaker: Hearing): number[] {
  const listeners: number[] = [];
  for (const friend of run.campus.friends[speaker.student]) {
    if (run.hearings[friend.id]) continue; // first version sticks
    run.hearings[friend.id] = tell(run.campus, run.template, run.params, speaker, friend, run.ticks.length);
    listeners.push(friend.id);
  }
  return listeners;
}

/** Breadth-first: waves. Students who heard in wave t speak in wave t, in the order they heard. */
function broadcast(run: Run, source: number, checker: FactChecker | null): void {
  const waves: number[][] = [[source]];
  if (checker) {
    while (waves.length <= checker.lead) waves.push([]);
    waves[checker.lead].push(checker.student);
  }

  for (let wave = 0; wave < waves.length; wave++) {
    const speakers = waves[wave];
    for (let i = 0; i < speakers.length; i++) {
      const speaker = run.hearings[speakers[i]]!;
      if (!speaker.repeats) continue;
      const listeners = tellAll(run, speaker);
      if (listeners.length === 0) continue;
      if (!waves[wave + 1]) waves.push([]);
      waves[wave + 1].push(...listeners);
      run.ticks.push({
        kind: 'tell',
        index: run.ticks.length,
        speaker: speaker.student,
        listeners,
        hop: speaker.hop + 1,
        frontier: [...speakers.slice(i + 1), ...waves.slice(wave + 1).flat()],
        truth: speaker.truth,
      });
    }
  }
}

/** Depth-first: one chain per side. With a fact-checker, the two chains take turns. */
function whisperChain(run: Run, source: number, checker: FactChecker | null): void {
  interface Side {
    stack: number[];
    truth: boolean;
    done: boolean;
  }

  const nextListener = (student: number): Friend | undefined => {
    if (!run.hearings[student]!.repeats) return undefined;
    return run.campus.friends[student].find((friend) => !run.hearings[friend.id]);
  };

  /** One move for a side: a retelling, or a walk back to someone with friends left to tell. */
  const step = (side: Side): void => {
    while (side.stack.length > 0) {
      const current = side.stack[side.stack.length - 1];
      const friend = nextListener(current);
      if (friend) {
        const speaker = run.hearings[current]!;
        run.hearings[friend.id] = tell(run.campus, run.template, run.params, speaker, friend, run.ticks.length);
        side.stack.push(friend.id);
        run.ticks.push({
          kind: 'tell',
          index: run.ticks.length,
          speaker: current,
          listeners: [friend.id],
          hop: speaker.hop + 1,
          frontier: side.stack.slice(),
          truth: side.truth,
        });
        return;
      }

      // Dead end. Walk back up the chain to the nearest student with someone left to tell.
      const path = [current];
      side.stack.pop();
      while (side.stack.length > 0 && !nextListener(side.stack[side.stack.length - 1])) {
        path.push(side.stack.pop()!);
      }
      if (side.stack.length > 0) {
        path.push(side.stack[side.stack.length - 1]);
        run.ticks.push({
          kind: 'backtrack',
          index: run.ticks.length,
          path,
          frontier: side.stack.slice(),
          truth: side.truth,
        });
        return;
      }
    }
    side.done = true;
  };

  const sides: Side[] = [{ stack: [source], truth: false, done: false }];
  let truthStarted = checker === null;
  let turn = 0;
  for (;;) {
    let active = sides.filter((side) => !side.done);
    if (!truthStarted && (run.ticks.length >= checker!.lead || active.length === 0)) {
      sides.push({ stack: [checker!.student], truth: true, done: false });
      truthStarted = true;
      active = sides.filter((side) => !side.done);
    }
    if (active.length === 0) break;
    step(active[turn % active.length]);
    turn += 1;
  }
}

/** Best-first: whoever holds the most credible version speaks next. */
function trustedFirst(run: Run, source: number, checker: FactChecker | null): void {
  const waiting: number[] = [source];
  let pending = checker;

  // Most credible first. Ties go to whoever heard first, then the rumor, then the lower id.
  const before = (a: Hearing, b: Hearing) =>
    a.credibility !== b.credibility
      ? a.credibility > b.credibility
      : a.tick !== b.tick
        ? a.tick < b.tick
        : a.truth !== b.truth
          ? !a.truth
          : a.student < b.student;
  const ranked = () => waiting.slice().sort((x, y) => (before(run.hearings[x]!, run.hearings[y]!) ? -1 : 1));

  for (;;) {
    if (pending && (run.ticks.length >= pending.lead || waiting.length === 0)) {
      waiting.push(pending.student);
      pending = null;
    }
    if (waiting.length === 0) break;

    let best = 0;
    for (let i = 1; i < waiting.length; i++) {
      if (before(run.hearings[waiting[i]]!, run.hearings[waiting[best]]!)) best = i;
    }
    const speaker = run.hearings[waiting.splice(best, 1)[0]]!;
    if (!speaker.repeats) continue;
    const listeners = tellAll(run, speaker);
    if (listeners.length === 0) continue;
    waiting.push(...listeners);
    run.ticks.push({
      kind: 'tell',
      index: run.ticks.length,
      speaker: speaker.student,
      listeners,
      hop: speaker.hop + 1,
      frontier: ranked(),
      truth: speaker.truth,
    });
  }
}

export function simulate(
  campus: Campus,
  template: RumorTemplate,
  source: number,
  algorithm: Algorithm,
  params: SpreadParams,
  factChecker: FactChecker | null = null,
): Trace {
  const count = campus.students.length;
  const checker =
    factChecker && factChecker.student !== source && factChecker.student >= 0 && factChecker.student < count
      ? { student: factChecker.student, lead: Math.max(0, Math.round(factChecker.lead)) }
      : null;

  const run: Run = { campus, template, params, hearings: campus.students.map(() => null), ticks: [] };
  run.hearings[source] = startHearing(template, source, false);
  if (checker) run.hearings[checker.student] = startHearing(template, checker.student, true);

  if (algorithm === 'bfs') broadcast(run, source, checker);
  else if (algorithm === 'dfs') whisperChain(run, source, checker);
  else trustedFirst(run, source, checker);

  return { algorithm, source, checker: checker?.student ?? null, ticks: run.ticks, hearings: run.hearings };
}

/* ------------------------------------------------------------------ */
/* Reading a trace                                                     */
/* ------------------------------------------------------------------ */

export interface Summary {
  students: number;
  /** Everyone who believes some version of the rumor, including the source. */
  heard: number;
  /** Believe the rumor and are still willing to repeat it. */
  repeating: number;
  /** Hold the rumor's original wording, including the source. */
  verbatim: number;
  /** Mean of (1 - drift) across everyone the rumor was told to. */
  fidelity: number;
  /** Mean number of bent details across everyone the rumor was told to. */
  bends: number;
  /** Mean credibility across everyone the rumor was told to. */
  credibility: number;
  deepestHop: number;
  /** Heard the fact-checker's correction first, including the fact-checker. */
  corrected: number;
}

/** Summarises the state after `completedTicks` ticks. Omit it for the final outcome. */
export function summarize(trace: Trace, completedTicks: number = Infinity): Summary {
  let heard = 0;
  let repeating = 0;
  let verbatim = 0;
  let told = 0;
  let fidelitySum = 0;
  let bendSum = 0;
  let credibilitySum = 0;
  let deepestHop = 0;
  let corrected = 0;

  for (const hearing of trace.hearings) {
    if (!hearing || hearing.tick >= completedTicks) continue;
    if (hearing.truth) {
      corrected += 1;
      continue;
    }
    heard += 1;
    if (hearing.repeats) repeating += 1;
    if (hearing.drift === 0) verbatim += 1;
    if (hearing.from !== null) {
      told += 1;
      fidelitySum += 1 - hearing.drift;
      bendSum += hearing.bends;
      credibilitySum += hearing.credibility;
      deepestHop = Math.max(deepestHop, hearing.hop);
    }
  }

  return {
    students: trace.hearings.length,
    heard,
    repeating,
    verbatim,
    fidelity: told > 0 ? fidelitySum / told : 1,
    bends: told > 0 ? bendSum / told : 0,
    credibility: told > 0 ? credibilitySum / told : 1,
    deepestHop,
    corrected,
  };
}

export interface HopBucket {
  hop: number;
  count: number;
  /** Mean number of bent details among students at this hop. */
  bends: number;
  credibility: number;
}

/** How many students first heard the rumor at each hop, and in what shape it arrived. */
export function hopProfile(trace: Trace): HopBucket[] {
  const buckets: HopBucket[] = [];
  for (const hearing of trace.hearings) {
    if (!hearing || hearing.from === null || hearing.truth) continue;
    while (buckets.length < hearing.hop) {
      buckets.push({ hop: buckets.length + 1, count: 0, bends: 0, credibility: 0 });
    }
    const bucket = buckets[hearing.hop - 1];
    bucket.count += 1;
    bucket.bends += hearing.bends;
    bucket.credibility += hearing.credibility;
  }
  for (const bucket of buckets) {
    if (bucket.count > 0) {
      bucket.bends /= bucket.count;
      bucket.credibility /= bucket.count;
    }
  }
  return buckets;
}

/** The chain of retellings from the source (or the fact-checker) down to one student. */
export function chainTo(trace: Trace, student: number): Hearing[] {
  const chain: Hearing[] = [];
  let hearing = trace.hearings[student];
  while (hearing) {
    chain.push(hearing);
    hearing = hearing.from === null ? null : trace.hearings[hearing.from];
  }
  return chain.reverse();
}
