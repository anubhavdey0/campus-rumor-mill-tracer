/**
 * Force-directed layout. Places students so friends sit close together and
 * each hangout group forms its own cluster. Runs once per campus (and again
 * when the canvas changes shape), not per frame.
 */

import type { Campus } from './campus';
import { clamp, hashInts, mulberry32 } from './rng';

export interface Point {
  x: number;
  y: number;
}

const ITERATIONS = 320;

/**
 * Where every student starts before the forces run: a loose blob around each
 * group's spot. Cheap enough to draw immediately while the full layout is
 * computed off the main thread.
 */
export function quickLayout(campus: Campus, aspect: number): Point[] {
  return normalise(seedPositions(campus, aspect).points);
}

function seedPositions(campus: Campus, aspect: number) {
  const width = clamp(aspect, 0.55, 2.6);
  const height = 1;
  const rng = mulberry32(hashInts(campus.seed, campus.students.length, 7));

  // Group anchors on a snaking grid, so ring-neighbour groups end up adjacent.
  const groupCount = campus.groups.length;
  const cols = clamp(Math.round(Math.sqrt(groupCount * width)), 1, groupCount);
  const rows = Math.ceil(groupCount / cols);
  const anchors: Point[] = campus.groups.map((_, g) => {
    const row = Math.floor(g / cols);
    const inRow = row === rows - 1 ? groupCount - row * cols : cols;
    const position = g - row * cols;
    const col = row % 2 === 0 ? position : inRow - 1 - position;
    return {
      x: ((col + 0.5) / inRow) * width + (rng() - 0.5) * 0.08 * width,
      y: ((row + 0.5) / rows) * height + (rng() - 0.5) * 0.1 * height,
    };
  });

  const points: Point[] = campus.students.map((student) => {
    const anchor = anchors[student.group];
    const angle = rng() * Math.PI * 2;
    const radius = 0.02 + rng() * 0.08;
    return { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
  });

  return { width, height, rng, anchors, points };
}

/**
 * Returns one point per student, normalised to the unit square.
 * `aspect` is canvas width divided by height, so clusters spread to fit.
 */
export function layoutCampus(campus: Campus, aspect: number): Point[] {
  const { width, height, rng, anchors, points } = seedPositions(campus, aspect);
  const count = campus.students.length;

  // Fruchterman-Reingold with a pull toward each group's anchor. Repulsion is
  // short-range only, so clusters stay compact instead of shoving each other
  // toward the edges.
  const ideal = 0.5 * Math.sqrt((width * height) / count);
  const repulsionRange = ideal * 3.2;
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const temperature = 0.06 * (1 - iteration / ITERATIONS) + 0.001;
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let ex = points[i].x - points[j].x;
        let ey = points[i].y - points[j].y;
        let distance = Math.hypot(ex, ey);
        if (distance < 1e-4) {
          ex = (rng() - 0.5) * 1e-3;
          ey = (rng() - 0.5) * 1e-3;
          distance = Math.hypot(ex, ey);
        }
        if (distance > repulsionRange) continue;
        const force = (ideal * ideal) / distance;
        const fx = (ex / distance) * force;
        const fy = (ey / distance) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }

    for (const tie of campus.ties) {
      const ex = points[tie.a].x - points[tie.b].x;
      const ey = points[tie.a].y - points[tie.b].y;
      const distance = Math.hypot(ex, ey) || 1e-4;
      const strength = tie.bridge ? 0.03 : 1;
      const force = ((distance * distance) / ideal) * strength;
      const fx = (ex / distance) * force;
      const fy = (ey / distance) * force;
      dx[tie.a] -= fx;
      dy[tie.a] -= fy;
      dx[tie.b] += fx;
      dy[tie.b] += fy;
    }

    for (let i = 0; i < count; i++) {
      const anchor = anchors[campus.students[i].group];
      dx[i] += (anchor.x - points[i].x) * 1.1;
      dy[i] += (anchor.y - points[i].y) * 1.1;

      const length = Math.hypot(dx[i], dy[i]) || 1e-4;
      const step = Math.min(length, temperature);
      points[i].x += (dx[i] / length) * step;
      points[i].y += (dy[i] / length) * step;
    }
  }

  return normalise(points);
}

/** Stretches points to fill the unit square. */
function normalise(points: Point[]): Point[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return points.map((point) => ({ x: (point.x - minX) / spanX, y: (point.y - minY) / spanY }));
}
