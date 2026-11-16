/**
 * The rumor itself. A rumor is a sentence cut into segments. Fixed segments
 * never change. Mutable segments carry a ladder of variants: index 0 is the
 * truth, and each step up the ladder is one notch more dramatic.
 *
 * A "version" is just one ladder position per segment, so two students can
 * hold different versions of the same rumor and we can measure how far each
 * one has drifted from the original.
 */

export interface Segment {
  /** variants[0] is the original wording. A single variant means fixed text. */
  variants: string[];
}

export interface RumorTemplate {
  id: string;
  title: string;
  segments: Segment[];
}

/** One ladder position per segment. Treat as immutable. */
export type Version = readonly number[];

export interface TextPart {
  segment: number;
  text: string;
  original: string;
  mutable: boolean;
  changed: boolean;
}

const seg = (...variants: string[]): Segment => ({ variants });

export const PRESETS: RumorTemplate[] = [
  {
    id: 'quiz',
    title: 'The postponed quiz',
    segments: [
      seg('Prof. Rao', 'The CS department', 'The dean', 'The whole university'),
      seg(' '),
      seg('might postpone', 'is postponing', 'has cancelled', 'has banned'),
      seg(' '),
      seg('Friday’s quiz', 'this week’s quizzes', 'the midterms', 'all exams'),
      seg(' because '),
      seg('the projector is broken', 'the lab flooded', 'of a paper leak', 'of a cheating scandal'),
      seg('.'),
    ],
  },
  {
    id: 'canteen',
    title: 'The samosa price hike',
    segments: [
      seg('The canteen', 'The mess committee', 'The administration', 'The government'),
      seg(' is '),
      seg('raising the price of', 'doubling the price of', 'rationing', 'banning'),
      seg(' '),
      seg('samosas', 'all snacks', 'all canteen food', 'outside food'),
      seg(' '),
      seg('from Monday', 'from tomorrow', 'effective immediately', 'forever'),
      seg('.'),
    ],
  },
  {
    id: 'library',
    title: 'The library closing early',
    segments: [
      seg('The library', 'The library and the labs', 'The whole academic block', 'The entire campus'),
      seg(' will '),
      seg('close two hours early', 'close for the day', 'shut down for a week', 'be sealed off indefinitely'),
      seg(' '),
      seg('on Sunday', 'this weekend', 'starting tomorrow', 'starting tonight'),
      seg(' for '),
      seg('pest control', 'a rat problem', 'a snake sighting', 'a health emergency'),
      seg('.'),
    ],
  },
  {
    id: 'fest',
    title: 'The fest headliner',
    segments: [
      seg('A local band', 'A famous DJ', 'A Bollywood singer', 'An international pop star'),
      seg(' '),
      seg('might play', 'will play', 'is headlining', 'is secretly headlining'),
      seg(' at the college fest, and '),
      seg(
        'entry is free for students',
        'passes cost 500 rupees',
        'passes are almost sold out',
        'passes are being resold for thousands',
      ),
      seg('.'),
    ],
  },
  {
    id: 'curfew',
    title: 'The hostel curfew',
    segments: [
      seg('The warden', 'The hostel council', 'The dean', 'The board'),
      seg(' '),
      seg('may move', 'will move', 'has moved', 'has secretly moved'),
      seg(' the hostel curfew to '),
      seg('10 pm', '9 pm', '8 pm', 'sunset'),
      seg(' '),
      seg('during exam week', 'for the whole month', 'for the rest of the semester', 'permanently'),
      seg('.'),
    ],
  },
];

export const CUSTOM_EXAMPLE = 'Someone said the gym might be closed for a week, and a few students could get fined.';

export const CUSTOM_MAX_LENGTH = 180;

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

export function originalVersion(template: RumorTemplate): Version {
  return template.segments.map(() => 0);
}

export function renderVersion(template: RumorTemplate, version: Version): string {
  return template.segments.map((segment, i) => segment.variants[version[i]]).join('');
}

/** Total number of ladder steps available across the whole rumor. */
export function maxDrift(template: RumorTemplate): number {
  return template.segments.reduce((sum, segment) => sum + segment.variants.length - 1, 0);
}

/** How many details differ from the truth: the total number of ladder steps taken. */
export function bendsOf(version: Version): number {
  return version.reduce((sum, level) => sum + level, 0);
}

/** How far a version has drifted from the truth, from 0 (verbatim) to 1 (maxed out). */
export function driftOf(template: RumorTemplate, version: Version): number {
  const max = maxDrift(template);
  return max === 0 ? 0 : bendsOf(version) / max;
}

/**
 * Moves one segment one step up its ladder. `roll` (0 to 1) chooses which
 * segment. Returns null when every segment is already at its wildest.
 */
export function mutateVersion(
  template: RumorTemplate,
  version: Version,
  roll: number,
): { version: Version; segment: number } | null {
  const open: number[] = [];
  template.segments.forEach((segment, i) => {
    if (version[i] < segment.variants.length - 1) open.push(i);
  });
  if (open.length === 0) return null;
  const segment = open[Math.min(open.length - 1, Math.floor(roll * open.length))];
  const next = version.slice();
  next[segment] += 1;
  return { version: next, segment };
}

/** Splits a version into display parts, flagging the ones that no longer match the truth. */
export function partsOf(template: RumorTemplate, version: Version): TextPart[] {
  return template.segments.map((segment, i) => ({
    segment: i,
    text: segment.variants[version[i]],
    original: segment.variants[0],
    mutable: segment.variants.length > 1,
    changed: version[i] > 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Custom rumors                                                       */
/* ------------------------------------------------------------------ */

/**
 * Escalation ladders for free text. When a custom rumor contains the first
 * phrase of a ladder (or any phrase but the last), that phrase becomes a
 * mutable segment and the rest of the ladder becomes its variants.
 */
const LADDERS: string[][] = [
  ['might', 'will', 'will definitely'],
  ['could', 'will', 'will definitely'],
  ['maybe', 'probably', 'definitely'],
  ['possibly', 'probably', 'definitely'],
  ['is thinking about', 'is planning on', 'has decided on'],
  ['is considering', 'is planning', 'has approved'],
  ['a few', 'some', 'most', 'all'],
  ['several', 'most', 'all'],
  ['many', 'most', 'all'],
  ['someone', 'a group of people', 'everyone'],
  ['a student', 'a group of students', 'the whole batch'],
  ['one student', 'a group of students', 'the whole batch'],
  ['a professor', 'the department', 'the dean'],
  ['a teacher', 'the department', 'the principal'],
  ['postponed', 'cancelled', 'banned'],
  ['postpone', 'cancel', 'ban'],
  ['postponing', 'cancelling', 'banning'],
  ['delayed', 'cancelled', 'scrapped'],
  ['closed', 'shut down', 'sealed off'],
  ['closing', 'shutting down', 'sealing off'],
  ['warned', 'fined', 'suspended', 'expelled'],
  ['fined', 'suspended', 'expelled'],
  ['suspended', 'expelled', 'arrested'],
  ['quiz', 'test', 'midterm', 'final exam'],
  ['test', 'midterm', 'final exam'],
  ['assignment', 'project', 'final exam'],
  ['argument', 'fight', 'brawl', 'riot'],
  ['fight', 'brawl', 'riot'],
  ['small', 'big', 'huge'],
  ['minor', 'major', 'serious'],
  ['late', 'very late', 'hours late'],
  ['sometimes', 'often', 'always'],
  ['rarely', 'often', 'always'],
  ['an hour', 'a few hours', 'a whole day'],
  ['a day', 'a week', 'a month'],
  ['a week', 'a month', 'the whole semester'],
  ['next month', 'next week', 'tomorrow'],
  ['next week', 'this week', 'tomorrow'],
  ['tomorrow', 'tonight', 'right now'],
  ['talking to', 'dating', 'engaged to'],
  ['dating', 'engaged to', 'secretly married to'],
  ['said', 'announced', 'officially confirmed'],
  ['raising', 'doubling', 'tripling'],
  ['expensive', 'overpriced', 'unaffordable'],
];

const DAY_ESCALATION = ['tomorrow', 'tonight', 'right now'];
const TAIL_ESCALATION = ['', ', apparently', ', and it is official', ', and they are covering it up'];

/** phrase -> the variants that follow it on its ladder. First ladder to claim a phrase wins. */
const LADDER_LOOKUP = new Map<string, string[]>();
for (const ladder of LADDERS) {
  for (let i = 0; i < ladder.length - 1; i++) {
    if (!LADDER_LOOKUP.has(ladder[i])) LADDER_LOOKUP.set(ladder[i], ladder.slice(i + 1));
  }
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PHRASES = [...LADDER_LOOKUP.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);

const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

/** Words that make the number after them a label, not a quantity: "Room 204", "Quiz 1", "at 10". */
const LABEL_WORDS =
  'room|no|number|quiz|test|exam|lab|block|sem|semester|year|class|section|chapter|unit|page|bus|gate|' +
  'floor|platform|level|grade|hall|wing|batch|week|day|lecture|module|question|team|group|phase|round|' +
  'version|at|till|until|around';

/**
 * A quantity worth inflating. It must stand alone: not part of a time (3:30),
 * a date (12.5.2026), a list (1,000), or a code (B12, 007), and not a label
 * like "Room 204".
 */
const QUANTITY =
  `(?<![\\d.:,/#])(?<!\\b(?:${LABEL_WORDS})\\.?\\s?#?)` +
  `\\b(?!0\\d)\\d+(?:\\.\\d+)?\\b(?![.:,/]?\\d)(?!\\s?(?:am|pm)\\b)`;

// One pass, three kinds of match: "on Friday", a ladder phrase, or a quantity.
const MUTABLE_PATTERN = new RegExp(
  `\\b(?:on|this|next) (?:${DAYS})\\b|\\b(?:${PHRASES.join('|')})\\b|${QUANTITY}`,
  'gi',
);

function matchCase(source: string, variant: string): string {
  const letters = source.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return variant.toUpperCase();
  }
  const first = source.charAt(0);
  const isCapitalised = first !== first.toLowerCase() && first === first.toUpperCase();
  return isCapitalised ? variant.charAt(0).toUpperCase() + variant.slice(1) : variant;
}

/** Numbers inflate with each retelling: 2 becomes 4, then 10, then 20. */
function inflateNumber(text: string): string[] | null {
  const value = Number(text);
  if (!Number.isFinite(value) || value === 0) return null;
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return null; // probably a year
  const format = (n: number) => (Number.isInteger(value) ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  return [format(value * 2), format(value * 5), format(value * 10)];
}

export function cleanCustomText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_MAX_LENGTH);
}

export const MIN_CUSTOM_LENGTH = 8;

/** A custom rumor needs to be an actual sentence: at least eight characters and two words. */
export function isUsableRumor(text: string): boolean {
  const cleaned = cleanCustomText(text);
  const words = cleaned.match(/\p{L}{2,}/gu) ?? [];
  return cleaned.length >= MIN_CUSTOM_LENGTH && words.length >= 2;
}

/**
 * Turns free text into a rumor template by finding the parts that gossip
 * tends to exaggerate: hedges, quantities, days, numbers, and verbs like
 * "postponed". A trailing embellishment slot guarantees there is always
 * something left to bend.
 */
export function parseCustomRumor(rawText: string): RumorTemplate {
  const text = cleanCustomText(rawText);
  const punctuation = text.match(/[.!?]+["')\]]*$/)?.[0] ?? '';
  const body = punctuation ? text.slice(0, text.length - punctuation.length) : text;

  const segments: Segment[] = [];
  let cursor = 0;
  MUTABLE_PATTERN.lastIndex = 0;
  for (let match = MUTABLE_PATTERN.exec(body); match; match = MUTABLE_PATTERN.exec(body)) {
    const found = match[0];
    const lower = found.toLowerCase();
    let ladder: string[] | null = null;
    if (/^\d/.test(found)) ladder = inflateNumber(found);
    else if (LADDER_LOOKUP.has(lower)) ladder = LADDER_LOOKUP.get(lower)!;
    else ladder = DAY_ESCALATION;
    if (!ladder) continue;

    if (match.index > cursor) segments.push(seg(body.slice(cursor, match.index)));
    segments.push(seg(found, ...ladder.map((variant) => matchCase(found, variant))));
    cursor = match.index + found.length;
  }
  if (cursor < body.length) segments.push(seg(body.slice(cursor)));
  segments.push(seg(...TAIL_ESCALATION));
  if (punctuation) segments.push(seg(punctuation));

  return { id: 'custom', title: 'Your own rumor', segments };
}
