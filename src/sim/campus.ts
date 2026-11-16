/**
 * Campus generator. Builds a made-up social graph: students are nodes,
 * friendships are weighted edges, and students cluster into hangout groups
 * joined by a handful of weaker "bridge" friendships.
 */

import { clamp, hashInts, mulberry32, randInt, randRange, shuffle, type Rng } from './rng';

export type Trait = 'relay' | 'embellisher' | 'skeptic' | 'stickler';

export interface Student {
  id: number;
  name: string;
  group: number;
  trait: Trait;
}

/** An undirected friendship. Closeness runs from 0 (barely know each other) to 1. */
export interface Tie {
  id: number;
  a: number;
  b: number;
  closeness: number;
  /** Links two different hangout groups. */
  bridge: boolean;
  /** Cut by the visitor: drawn on the map, but nothing travels along it. */
  cut?: boolean;
}

/** One entry in a student's friend list. */
export interface Friend {
  id: number;
  tie: number;
  closeness: number;
}

export interface Group {
  id: number;
  name: string;
  members: number[];
}

export interface Campus {
  seed: number;
  students: Student[];
  groups: Group[];
  ties: Tie[];
  /** Adjacency list. Each list is sorted closest friend first. */
  friends: Friend[][];
  defaultSource: number;
}

export const TRAITS: Record<Trait, { label: string; effect: string }> = {
  relay: { label: 'Relay', effect: 'Passes things on as heard.' },
  embellisher: { label: 'Embellisher', effect: 'Twice as likely to bend the story.' },
  skeptic: { label: 'Skeptic', effect: 'Believes only 70% of what arrives.' },
  stickler: { label: 'Stickler', effect: 'Repeats it word for word.' },
};

const NAMES = [
  'Aarav',
  'Aditi',
  'Akash',
  'Ananya',
  'Arjun',
  'Avni',
  'Bhavya',
  'Charu',
  'Daksh',
  'Deepa',
  'Dev',
  'Diya',
  'Esha',
  'Farhan',
  'Gauri',
  'Harsh',
  'Ishaan',
  'Isha',
  'Jai',
  'Juhi',
  'Kabir',
  'Kavya',
  'Kiran',
  'Krish',
  'Lakshmi',
  'Lavanya',
  'Manan',
  'Meera',
  'Mihir',
  'Mira',
  'Naina',
  'Nakul',
  'Neha',
  'Nikhil',
  'Nisha',
  'Ojas',
  'Pari',
  'Parth',
  'Pooja',
  'Pranav',
  'Priya',
  'Rahul',
  'Rhea',
  'Riya',
  'Rohan',
  'Ruhi',
  'Sahil',
  'Saanvi',
  'Samar',
  'Sana',
  'Sara',
  'Shreya',
  'Siddharth',
  'Sneha',
  'Soham',
  'Tanvi',
  'Tara',
  'Tejas',
  'Uma',
  'Varun',
  'Vedant',
  'Vidya',
  'Vikram',
  'Yash',
  'Zara',
  'Zoya',
  'Aisha',
  'Amit',
  'Anika',
  'Aryan',
  'Bela',
  'Chirag',
  'Divya',
  'Gaurav',
  'Hina',
  'Imran',
  'Jaya',
  'Karan',
  'Leela',
  'Madhav',
  'Mahira',
  'Naveen',
  'Nitya',
  'Omar',
  'Pallavi',
  'Rajat',
  'Rekha',
  'Ritika',
  'Sameer',
  'Shalini',
  'Tarun',
  'Trisha',
  'Uday',
  'Vani',
  'Vivek',
  'Yamini',
  'Zain',
  'Anjali',
  'Bharat',
  'Chetan',
  'Dhruv',
  'Ekta',
  'Fatima',
  'Girish',
  'Hemant',
  'Indira',
  'Joseph',
  'Kunal',
  'Lata',
  'Mohit',
  'Nandini',
  'Pavan',
  'Reema',
  'Sunil',
  'Tanya',
  'Utkarsh',
  'Vinay',
  'Wasim',
];

const GROUP_NAMES = [
  'North Hostel',
  'South Hostel',
  'Robotics Lab',
  'Drama Society',
  'Cricket Squad',
  'Night Canteen',
  'Library Corner',
  'Debate Club',
  'Music Room',
  'Hill Hostel',
];

export const MIN_STUDENTS = 24;
export const MAX_STUDENTS = 96;

function pickTrait(rng: Rng): Trait {
  const roll = rng();
  if (roll < 0.2) return 'embellisher';
  if (roll < 0.35) return 'skeptic';
  if (roll < 0.45) return 'stickler';
  return 'relay';
}

/** Splits `total` students into `count` groups of slightly uneven size. */
function groupSizes(rng: Rng, total: number, count: number): number[] {
  const weights = Array.from({ length: count }, () => randRange(rng, 0.75, 1.3));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const sizes = weights.map((w) => Math.max(3, Math.floor((w / weightSum) * total)));
  let assigned = sizes.reduce((sum, s) => sum + s, 0);
  // Hand out (or take back) the rounding remainder one student at a time.
  let cursor = 0;
  while (assigned !== total) {
    const index = cursor % count;
    if (assigned < total) {
      sizes[index] += 1;
      assigned += 1;
    } else if (sizes[index] > 3) {
      sizes[index] -= 1;
      assigned -= 1;
    }
    cursor += 1;
  }
  return sizes;
}

export function generateCampus(seed: number, size: number): Campus {
  const total = clamp(Math.round(size), MIN_STUDENTS, MAX_STUDENTS);
  const rng = mulberry32(hashInts(seed, total));

  const names = shuffle(rng, NAMES).slice(0, total);
  const groupCount = clamp(Math.round(total / 9), 3, GROUP_NAMES.length);
  const groupNames = shuffle(rng, GROUP_NAMES).slice(0, groupCount);
  const sizes = groupSizes(rng, total, groupCount);

  const students: Student[] = [];
  const groups: Group[] = [];
  for (let g = 0; g < groupCount; g++) {
    const members: number[] = [];
    for (let i = 0; i < sizes[g]; i++) {
      const id = students.length;
      students.push({ id, name: names[id], group: g, trait: pickTrait(rng) });
      members.push(id);
    }
    groups.push({ id: g, name: groupNames[g], members });
  }

  const ties: Tie[] = [];
  const seen = new Set<number>();
  const addTie = (a: number, b: number, closeness: number, bridge: boolean): boolean => {
    if (a === b) return false;
    const key = Math.min(a, b) * 1000 + Math.max(a, b);
    if (seen.has(key)) return false;
    seen.add(key);
    ties.push({ id: ties.length, a, b, closeness, bridge });
    return true;
  };

  // Inside each group: a random spanning tree keeps the group connected,
  // then extra friendships fill it in.
  for (const group of groups) {
    const order = shuffle(rng, group.members);
    for (let i = 1; i < order.length; i++) {
      addTie(order[i], order[randInt(rng, 0, i - 1)], randRange(rng, 0.45, 1), false);
    }
    const extraChance = clamp(1.5 / (order.length - 1), 0, 0.6);
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (rng() < extraChance) addTie(order[i], order[j], randRange(rng, 0.4, 1), false);
      }
    }
  }

  // Between groups: neighbours in the ring always share a bridge or two,
  // so the whole campus is one connected graph. A few long chords are added on top.
  const bridge = (g1: number, g2: number) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = groups[g1].members[randInt(rng, 0, groups[g1].members.length - 1)];
      const b = groups[g2].members[randInt(rng, 0, groups[g2].members.length - 1)];
      if (addTie(a, b, randRange(rng, 0.12, 0.5), true)) return;
    }
  };
  for (let g = 0; g < groupCount; g++) {
    const next = (g + 1) % groupCount;
    bridge(g, next);
    if (rng() < 0.55) bridge(g, next);
  }
  const chords = Math.round(groupCount / 3);
  for (let i = 0; i < chords; i++) {
    const g1 = randInt(rng, 0, groupCount - 1);
    const g2 = (g1 + randInt(rng, 2, Math.max(2, groupCount - 2))) % groupCount;
    if (g1 !== g2) bridge(g1, g2);
  }

  const friends: Friend[][] = students.map(() => []);
  for (const tie of ties) {
    friends[tie.a].push({ id: tie.b, tie: tie.id, closeness: tie.closeness });
    friends[tie.b].push({ id: tie.a, tie: tie.id, closeness: tie.closeness });
  }
  // People tell their closest friend first. This order drives both searches.
  for (const list of friends) {
    list.sort((x, y) => y.closeness - x.closeness || x.id - y.id);
  }

  // Start the rumor with the best-connected student of the first group.
  let defaultSource = groups[0].members[0];
  for (const id of groups[0].members) {
    if (friends[id].length > friends[defaultSource].length) defaultSource = id;
  }

  return { seed, students, groups, ties, friends, defaultSource };
}
