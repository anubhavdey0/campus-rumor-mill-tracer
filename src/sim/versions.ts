/**
 * The rumor's family tree. Every distinct wording in circulation is a node.
 * A node's parent is the wording it was bent from, so the tree shows how the
 * truth branched into versions as it travelled.
 */

import type { Version } from './rumor';
import type { Trace } from './spread';

export interface VersionNode {
  key: string;
  version: Version;
  /** How many details differ from the truth. */
  bends: number;
  /** Students who hold exactly this wording, in the order they heard it. */
  holders: number[];
  parent: VersionNode | null;
  children: VersionNode[];
  /** The segment that changed relative to the parent. Null for the original. */
  changedSegment: number | null;
  /** The student who first said it this way, and when. */
  originator: number;
  firstTick: number;
}

export interface VersionTree {
  root: VersionNode;
  /** Every node, root first, in the order the tree is drawn. */
  nodes: VersionNode[];
}

const keyOf = (version: Version) => version.join('.');

/** The family tree after `completedTicks` ticks. Omit it for the final outcome. */
export function versionTree(trace: Trace, completedTicks: number = Infinity): VersionTree {
  const source = trace.hearings[trace.source]!;
  const root: VersionNode = {
    key: keyOf(source.version),
    version: source.version,
    bends: 0,
    holders: [],
    parent: null,
    children: [],
    changedSegment: null,
    originator: trace.source,
    firstTick: -1,
  };
  const byKey = new Map<string, VersionNode>([[root.key, root]]);

  // Visit students in the order they heard the rumor, so the earliest route to a wording wins.
  // Students won over by the fact-checker hold the truth, not a version of the rumor.
  const heard = trace.hearings
    .filter((hearing) => hearing !== null && !hearing.truth && hearing.tick < completedTicks)
    .sort((a, b) => a!.tick - b!.tick || a!.student - b!.student);

  for (const hearing of heard) {
    const key = keyOf(hearing!.version);
    let node = byKey.get(key);
    if (!node) {
      const parent = byKey.get(keyOf(hearing!.previous!))!;
      node = {
        key,
        version: hearing!.version,
        bends: hearing!.bends,
        holders: [],
        parent,
        children: [],
        changedSegment: hearing!.bentSegment,
        originator: hearing!.student,
        firstTick: hearing!.tick,
      };
      parent.children.push(node);
      byKey.set(key, node);
    }
    node.holders.push(hearing!.student);
  }

  // Biggest branches first, so the most common wordings read at the top.
  const weight = new Map<VersionNode, number>();
  const total = (node: VersionNode): number => {
    const sum = node.holders.length + node.children.reduce((acc, child) => acc + total(child), 0);
    weight.set(node, sum);
    return sum;
  };
  total(root);
  const nodes: VersionNode[] = [];
  const walk = (node: VersionNode) => {
    nodes.push(node);
    node.children.sort((a, b) => weight.get(b)! - weight.get(a)! || a.firstTick - b.firstTick);
    node.children.forEach(walk);
  };
  walk(root);

  return { root, nodes };
}

/** How deep a node sits in the tree. The original is 0. */
export function depthOf(node: VersionNode): number {
  let depth = 0;
  for (let current = node.parent; current; current = current.parent) depth += 1;
  return depth;
}
