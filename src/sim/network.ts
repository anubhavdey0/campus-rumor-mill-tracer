/**
 * Graph questions about the campus itself, rather than about one run:
 * which friendships are load-bearing, who would make the best spreader, and
 * what the most believable route between two students would be.
 */

import type { Campus, Friend } from './campus';
import type { RumorTemplate } from './rumor';
import { retention, simulate, SKEPTIC_FACTOR, summarize, type Algorithm, type SpreadParams } from './spread';

/** The campus with some friendships cut. Cut ties stay on the map but nothing travels along them. */
export function withCuts(campus: Campus, cuts: readonly number[]): Campus {
  const valid = new Set(cuts.filter((id) => id >= 0 && id < campus.ties.length));
  if (valid.size === 0) return campus;
  const ties = campus.ties.map((tie) => (valid.has(tie.id) ? { ...tie, cut: true } : tie));
  const friends: Friend[][] = campus.friends.map((list) => list.filter((friend) => !valid.has(friend.tie)));
  return { ...campus, ties, friends };
}

/**
 * Bridges: friendships that are the only connection between two parts of the
 * campus (Tarjan's algorithm). The value is how many students sit on the
 * smaller side, so cutting that friendship isolates them from the rest.
 */
export function findBridges(campus: Campus): Map<number, number> {
  const count = campus.students.length;
  const order = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const size = new Array<number>(count).fill(1);
  const component = new Array<number>(count).fill(0);
  const bridges = new Map<number, number>();
  const found: { tie: number; child: number; root: number }[] = [];
  let counter = 0;

  const visit = (node: number, viaTie: number, root: number) => {
    order[node] = low[node] = counter++;
    for (const friend of campus.friends[node]) {
      if (friend.tie === viaTie) continue;
      if (order[friend.id] === -1) {
        visit(friend.id, friend.tie, root);
        size[node] += size[friend.id];
        low[node] = Math.min(low[node], low[friend.id]);
        if (low[friend.id] > order[node]) found.push({ tie: friend.tie, child: friend.id, root });
      } else {
        low[node] = Math.min(low[node], order[friend.id]);
      }
    }
  };

  for (let node = 0; node < count; node++) {
    if (order[node] !== -1) continue;
    visit(node, -1, node);
    component[node] = size[node];
  }
  for (const { tie, child, root } of found) {
    bridges.set(tie, Math.min(size[child], component[root] - size[child]));
  }
  return bridges;
}

/** How many students a rumor would reach if each student in turn started it. */
export function reachFromEach(
  campus: Campus,
  template: RumorTemplate,
  algorithm: Algorithm,
  params: SpreadParams,
): number[] {
  return campus.students.map((student) => summarize(simulate(campus, template, student.id, algorithm, params)).heard);
}

export interface BelievablePath {
  /** Student ids from the start to the target. */
  path: number[];
  /** Credibility on arrival at each student along the path. */
  credibility: number[];
}

/**
 * The most believable route from one student to another: the path that keeps
 * the most credibility on arrival (Dijkstra on the product of retentions).
 * Everyone along the way except the target must stay above the cutoff, or
 * they would never repeat it. Returns null when no such route exists.
 */
export function mostBelievablePath(
  campus: Campus,
  from: number,
  to: number,
  decay: number,
  cutoff: number,
): BelievablePath | null {
  const count = campus.students.length;
  const best = new Array<number>(count).fill(0);
  const parent = new Array<number>(count).fill(-1);
  const done = new Array<boolean>(count).fill(false);
  best[from] = 1;

  for (;;) {
    let node = -1;
    for (let i = 0; i < count; i++) {
      if (!done[i] && best[i] > 0 && (node === -1 || best[i] > best[node])) node = i;
    }
    if (node === -1 || node === to) break;
    done[node] = true;
    if (node !== from && best[node] < cutoff) continue; // hears it, but would not repeat it
    for (const friend of campus.friends[node]) {
      if (done[friend.id]) continue;
      let credibility = best[node] * retention(decay, friend.closeness);
      if (campus.students[friend.id].trait === 'skeptic') credibility *= SKEPTIC_FACTOR;
      if (credibility > best[friend.id]) {
        best[friend.id] = credibility;
        parent[friend.id] = node;
      }
    }
  }

  if (best[to] === 0) return null;
  const path: number[] = [];
  for (let node = to; node !== -1; node = parent[node]) path.push(node);
  path.reverse();
  return { path, credibility: path.map((id) => best[id]) };
}
