/**
 * Canvas renderer for the campus graph. It is handed a scene (campus, layout,
 * the precomputed run) and a playhead position, and draws that one moment:
 * who has heard the rumor, how bent their version is, and which retelling is
 * in flight right now. It keeps no simulation state of its own.
 *
 * Two views share the same map:
 *   spread   the run itself, as above
 *   network  the campus as a graph: who would make the best spreader, which
 *            friendships are bridges, and which ones the visitor has cut
 */

import type { Campus } from '../sim/campus';
import type { Point } from '../sim/layout';
import type { Hearing, Tick, Trace } from '../sim/spread';
import { bendColor, heatColor, type CanvasPalette, type Mode } from '../theme';

export type MapView = 'spread' | 'network';

export interface Scene {
  campus: Campus;
  /** Target positions in the unit square. The renderer eases toward them. */
  points: Point[];
  trace: Trace;
  mode: Mode;
  palette: CanvasPalette;
  view: MapView;
  selected: number | null;
  hovered: number | null;
  hoveredTie: number | null;
  /** When set, these students stay bright and everyone else fades back. */
  highlight: ReadonlySet<number> | null;
  /** A route to draw as a dashed line, such as the most believable path. */
  altPath: readonly number[] | null;
  /** Network view: how many students each student would reach as the source. */
  heat: readonly number[] | null;
  /** Network view: bridge friendships, and how many students each one isolates. */
  bridges: ReadonlyMap<number, number> | null;
  reducedMotion: boolean;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Share of a tick spent travelling along the edge. The rest is the arrival. */
const ARRIVE = 0.7;
const FONT_FAMILY = '"Schibsted Grotesk Variable", system-ui, sans-serif';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

interface Label {
  id: number;
  text: string;
}

export class GraphRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private base = 6;
  /** Node size for this frame: the base size, grown a little when zoomed in. */
  private unit = 6;
  private scene: Scene | null = null;
  private current: Point[] = [];
  private px = new Float64Array(0);
  private py = new Float64Array(0);
  private view: ViewTransform = { scale: 1, x: 0, y: 0 };
  /** Network view: each student's reach as a rank from 0 (fewest) to 1 (most), ties sharing a rank. */
  private heatShares: Float64Array | null = null;
  private heatSource: readonly number[] | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.base = clamp(Math.min(width, height) / 68, 4.4, 8);
  }

  setScene(scene: Scene): void {
    const previous = this.scene;
    this.scene = scene;
    const sameCount = previous !== null && previous.points.length === scene.points.length;
    if (!sameCount || scene.reducedMotion) {
      this.current = scene.points.map((point) => ({ ...point }));
    }
  }

  /**
   * Colors go by rank, not raw reach, so one cut-off student cannot wash every
   * other student out to the same shade.
   */
  private rankHeat(heat: readonly number[] | null): void {
    if (heat === this.heatSource) return;
    this.heatSource = heat;
    if (!heat) {
      this.heatShares = null;
      return;
    }
    const sorted = heat.slice().sort((a, b) => a - b);
    const distinct = [...new Set(sorted)];
    const shares = new Float64Array(heat.length);
    heat.forEach((value, i) => {
      shares[i] = distinct.length === 1 ? 1 : distinct.indexOf(value) / (distinct.length - 1);
    });
    this.heatShares = shares;
  }

  setView(view: ViewTransform): void {
    this.view = view;
  }

  /** Nearest student to a canvas-space point, or null if none is close enough. */
  hitTest(x: number, y: number): number | null {
    const reach = Math.max(14, this.unit * 1.5 + 7);
    let best: number | null = null;
    let bestDistance = reach * reach;
    for (let i = 0; i < this.px.length; i++) {
      const distance = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Nearest friendship to a canvas-space point, or null if none is close enough. */
  hitTie(x: number, y: number): number | null {
    const scene = this.scene;
    if (!scene) return null;
    let best: number | null = null;
    let bestDistance = 7;
    for (const tie of scene.campus.ties) {
      const ax = this.px[tie.a];
      const ay = this.py[tie.a];
      const bx = this.px[tie.b];
      const by = this.py[tie.b];
      const lengthSq = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSq, 0.08, 0.92);
      const distance = Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tie.id;
      }
    }
    return best;
  }

  /** Canvas-space position of a student, for anchoring the tooltip. */
  pointOf(id: number): Point | null {
    return id < this.px.length ? { x: this.px[id], y: this.py[id] } : null;
  }

  /** Canvas-space midpoint of a friendship. */
  midpointOf(tieId: number): Point | null {
    const tie = this.scene?.campus.ties[tieId];
    if (!tie) return null;
    return { x: (this.px[tie.a] + this.px[tie.b]) / 2, y: (this.py[tie.a] + this.py[tie.b]) / 2 };
  }

  /** The current frame on a solid background, ready to save as an image. */
  snapshot(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = this.scene?.palette.surface ?? '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  /**
   * Draws the moment at `position` (in ticks). Returns true while node
   * positions are still easing, so the caller knows to keep the loop alive.
   */
  draw(position: number, elapsedMs: number): boolean {
    const scene = this.scene;
    if (!scene || this.width === 0 || this.height === 0) return false;
    const { ctx } = this;
    if (this.current.length !== scene.campus.students.length) return false;

    const settling = this.project(scene, elapsedMs);
    this.unit = this.base * Math.min(1.6, Math.sqrt(this.view.scale));

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawGroups(scene);

    if (scene.view === 'network') this.drawNetwork(scene);
    else this.drawSpread(scene, position);

    if (scene.altPath && scene.altPath.length > 1) this.drawAltPath(scene, scene.altPath);
    return settling;
  }

  /* ---------------------------------------------------------------- */
  /* The spread                                                        */
  /* ---------------------------------------------------------------- */

  private drawSpread(scene: Scene, position: number): void {
    const { ctx } = this;
    const { campus, trace, palette, mode } = scene;
    const count = campus.students.length;
    const total = trace.ticks.length;
    const clamped = clamp(position, 0, total);
    const done = Math.floor(clamped + 1e-9);
    const fraction = clamped - done;
    const live: Tick | null = fraction > 1e-6 && done < total ? trace.ticks[done] : null;
    const progress = scene.reducedMotion ? 0 : fraction;
    const colorOf = (hearing: Hearing) => (hearing.truth ? palette.truth : bendColor(mode, hearing.bends));

    const hasHeard = (hearing: Hearing | null): hearing is Hearing =>
      hearing !== null && (hearing.tick < done || (live !== null && hearing.tick === done && progress >= ARRIVE));

    this.drawTies(scene, false);

    // Friendships the rumor (or the truth) has travelled, tinted by what crossed them.
    const pulses: { x: number; y: number; color: string }[] = [];
    for (const hearing of trace.hearings) {
      if (!hearing || hearing.from === null) continue;
      const landed = hearing.tick < done;
      const flying = live !== null && hearing.tick === done;
      if (!landed && !flying) continue;

      const travel = landed ? 1 : easeInOut(clamp(progress / ARRIVE, 0, 1));
      if (travel <= 0) continue;
      const x1 = this.px[hearing.from];
      const y1 = this.py[hearing.from];
      const x2 = x1 + (this.px[hearing.student] - x1) * travel;
      const y2 = y1 + (this.py[hearing.student] - y1) * travel;
      const color = colorOf(hearing);
      const faded = scene.highlight !== null && !scene.highlight.has(hearing.student);

      ctx.globalAlpha = (0.5 + 0.5 * hearing.credibility) * (faded ? 0.18 : 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (!landed && travel < 1) pulses.push({ x: x2, y: y2, color });
    }
    ctx.globalAlpha = 1;

    // The chain of custody for the selected student, back to whoever started it.
    const onChain = new Set<number>();
    if (scene.selected !== null) {
      let hearing = trace.hearings[scene.selected] ?? null;
      if (hasHeard(hearing)) {
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        while (hearing) {
          onChain.add(hearing.student);
          if (hearing.from === null) break;
          ctx.moveTo(this.px[hearing.student], this.py[hearing.student]);
          ctx.lineTo(this.px[hearing.from], this.py[hearing.from]);
          hearing = trace.hearings[hearing.from];
        }
        ctx.stroke();
      }
    }

    if (live?.kind === 'backtrack') this.drawBacktrack(scene, live.path, progress);

    for (let i = 0; i < count; i++) {
      const hearing = trace.hearings[i];
      const x = this.px[i];
      const y = this.py[i];
      let radius = this.unit * 0.6;
      const spotlit = scene.highlight?.has(i) ?? false;
      const fade = scene.highlight !== null && !spotlit ? 0.22 : 1;
      ctx.globalAlpha = fade;

      if (hasHeard(hearing)) {
        const color = colorOf(hearing);
        radius = hearing.repeats ? this.unit * (0.7 + 0.7 * hearing.credibility) : this.unit * 0.72;

        if (live !== null && hearing.tick === done) {
          // Arrival: the dot swells, a ring ripples out, and a bent version throws sparks.
          const arrival = clamp((progress - ARRIVE) / (1 - ARRIVE), 0, 1);
          radius *= 1 + 0.45 * Math.sin(Math.PI * arrival);
          ctx.globalAlpha = (1 - arrival) * 0.85 * fade;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, radius + 3 + 16 * arrival, 0, Math.PI * 2);
          ctx.stroke();
          if (hearing.bent) {
            ctx.strokeStyle = palette.ink;
            ctx.beginPath();
            for (let spark = 0; spark < 6; spark++) {
              const angle = (spark / 6) * Math.PI * 2 + 0.4;
              const inner = radius + 5 + 9 * arrival;
              ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
              ctx.lineTo(x + Math.cos(angle) * (inner + 5), y + Math.sin(angle) * (inner + 5));
            }
            ctx.stroke();
          }
          ctx.globalAlpha = fade;
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        if (hearing.repeats) {
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // Heard it, but too doubtful to pass it on: a hollow ring.
          ctx.fillStyle = palette.surface;
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        this.drawIdle(scene, x, y, radius);
      }

      const isSpeaker = live?.kind === 'tell' && live.speaker === i;
      const starter = i === trace.source || i === trace.checker;
      if (starter || isSpeaker || onChain.has(i) || spotlit) {
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = starter ? 1.75 : 1.25;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (i === scene.selected) this.drawSelectionRing(scene, x, y, radius);
    }
    ctx.globalAlpha = 1;

    // The rumor in flight.
    for (const pulse of pulses) {
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color;
      ctx.fill();
      ctx.strokeStyle = palette.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const names: Label[] = [];
    if (live?.kind === 'tell') {
      names.push({ id: live.speaker, text: scene.campus.students[live.speaker].name });
      if (live.listeners.length === 1) {
        names.push({ id: live.listeners[0], text: scene.campus.students[live.listeners[0]].name });
      }
    } else if (live?.kind === 'backtrack') {
      for (const id of [live.path[0], live.path[live.path.length - 1]]) {
        names.push({ id, text: scene.campus.students[id].name });
      }
    }
    this.drawLabels(scene, names);
  }

  /* ---------------------------------------------------------------- */
  /* The network                                                       */
  /* ---------------------------------------------------------------- */

  private drawNetwork(scene: Scene): void {
    const { ctx } = this;
    const { campus, palette, mode, heat, trace } = scene;
    this.drawTies(scene, true);
    this.rankHeat(heat);

    for (let i = 0; i < campus.students.length; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const radius = this.unit * 0.95;
      if (heat && this.heatShares) {
        const share = this.heatShares[i];
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = heatColor(mode, share);
        ctx.fill();
        ctx.strokeStyle = palette.surface;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        this.drawIdle(scene, x, y, this.unit * 0.6);
      }
      if (i === trace.source || i === trace.checker) {
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (i === scene.selected) this.drawSelectionRing(scene, x, y, radius);
    }

    // Name the three best spreaders.
    const names: Label[] = [];
    if (heat) {
      const ranked = heat
        .map((reach, id) => ({ reach, id }))
        .sort((a, b) => b.reach - a.reach || a.id - b.id)
        .slice(0, 3);
      ranked.forEach(({ id, reach }, rank) => {
        names.push({ id, text: `${rank + 1}. ${campus.students[id].name}, ${reach}` });
      });
    }
    this.drawLabels(scene, names);
  }

  /**
   * Friendships. Bridges between groups are dotted; cut friendships are dashed
   * and crossed out. In the network view, bridges that isolate two or more
   * students are drawn heavier, and the hovered friendship is outlined.
   */
  private drawTies(scene: Scene, network: boolean): void {
    const { ctx } = this;
    const { campus, palette, bridges } = scene;

    for (const tie of campus.ties) {
      const ax = this.px[tie.a];
      const ay = this.py[tie.a];
      const bx = this.px[tie.b];
      const by = this.py[tie.b];
      const isolates = network ? (bridges?.get(tie.id) ?? 0) : 0;
      const hovered = network && tie.id === scene.hoveredTie;

      ctx.globalAlpha = tie.cut ? 0.8 : 0.45 + 0.55 * tie.closeness;
      ctx.strokeStyle = hovered || isolates >= 2 ? palette.inkSoft : palette.line;
      ctx.lineWidth = hovered ? 3 : isolates >= 2 ? 2.25 : 1;
      ctx.setLineDash(tie.cut ? [4, 4] : tie.bridge && isolates < 2 ? [2, 5] : []);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      if (tie.cut) {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = palette.inkSoft;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx - 3.5, my - 3.5);
        ctx.lineTo(mx + 3.5, my + 3.5);
        ctx.moveTo(mx + 3.5, my - 3.5);
        ctx.lineTo(mx - 3.5, my + 3.5);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawIdle(scene: Scene, x: number, y: number, radius: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = scene.palette.surface;
    ctx.fill();
    ctx.strokeStyle = scene.palette.idle;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  private drawSelectionRing(scene: Scene, x: number, y: number, radius: number): void {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = scene.palette.ink;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, radius + 7.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** A route drawn as a dashed line over the map, such as the most believable path. */
  private drawAltPath(scene: Scene, path: readonly number[]): void {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = scene.palette.ink;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(this.px[path[0]], this.py[path[0]]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(this.px[path[i]], this.py[path[i]]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const id of path) {
      ctx.beginPath();
      ctx.arc(this.px[id], this.py[id], 2.5, 0, Math.PI * 2);
      ctx.fillStyle = scene.palette.ink;
      ctx.fill();
    }
  }

  /** Eases node positions toward their targets and projects them to pixels, applying zoom and pan. */
  private project(scene: Scene, elapsedMs: number): boolean {
    const count = scene.points.length;
    if (this.px.length !== count) {
      this.px = new Float64Array(count);
      this.py = new Float64Array(count);
    }
    const ease = 1 - Math.exp(-Math.max(1, elapsedMs) / 150);
    const padX = Math.max(34, this.width * 0.07);
    const padTop = 72; // clears the map toolbar
    const padBottom = 50;
    const spanX = this.width - padX * 2;
    const spanY = this.height - padTop - padBottom;
    const { scale, x: offsetX, y: offsetY } = this.view;

    let settling = false;
    for (let i = 0; i < count; i++) {
      const target = scene.points[i];
      const point = this.current[i];
      const dx = target.x - point.x;
      const dy = target.y - point.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0008) {
        point.x += dx * ease;
        point.y += dy * ease;
        settling = true;
      } else {
        point.x = target.x;
        point.y = target.y;
      }
      this.px[i] = (padX + point.x * spanX) * scale + offsetX;
      this.py[i] = (padTop + point.y * spanY) * scale + offsetY;
    }
    return settling;
  }

  /**
   * A soft patch and a name behind each hangout group. Each name goes above
   * its patch, or below it when that spot would sit on another group.
   */
  private drawGroups(scene: Scene): void {
    const { ctx } = this;
    const { campus, palette } = scene;
    ctx.font = `500 11px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const hulls = campus.groups.map((group) => {
      let cx = 0;
      let cy = 0;
      for (const id of group.members) {
        cx += this.px[id];
        cy += this.py[id];
      }
      cx /= group.members.length;
      cy /= group.members.length;
      let reach = 0;
      for (const id of group.members) {
        reach = Math.max(reach, Math.hypot(this.px[id] - cx, this.py[id] - cy));
      }
      return { name: group.name, cx, cy, r: reach + this.unit * 1.7 };
    });

    ctx.fillStyle = palette.hull;
    for (const hull of hulls) {
      ctx.beginPath();
      ctx.arc(hull.cx, hull.cy, hull.r, 0, Math.PI * 2);
      ctx.fill();
    }

    type Box = { x: number; y: number; w: number; h: number };
    const placed: Box[] = [];
    const overlapsCircle = (box: Box, cx: number, cy: number, r: number) => {
      const nx = clamp(cx, box.x, box.x + box.w);
      const ny = clamp(cy, box.y, box.y + box.h);
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    };
    const overlapsBox = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    const labels: { text: string; x: number; y: number }[] = [];
    hulls.forEach((hull, index) => {
      const width = ctx.measureText(hull.name).width;
      const x = clamp(hull.cx, width / 2 + 8, this.width - width / 2 - 8);
      const candidates = [hull.cy - hull.r - 7, hull.cy + hull.r + 15];
      let bestY = candidates[0];
      let bestScore = Infinity;
      candidates.forEach((y, order) => {
        const box = { x: x - width / 2 - 2, y: y - 11, w: width + 4, h: 14 };
        let score = order * 0.5; // prefer above
        if (box.y < 2 || box.y + box.h > this.height - 2) score += 4;
        // The map toolbar sits in the top corners.
        if (box.y < 48 && (box.x < 190 || box.x + box.w > this.width - 170)) score += 3;
        hulls.forEach((other, j) => {
          if (j !== index && overlapsCircle(box, other.cx, other.cy, other.r)) score += 2;
        });
        for (const other of placed) if (overlapsBox(box, other)) score += 3;
        if (score < bestScore) {
          bestScore = score;
          bestY = y;
        }
      });
      placed.push({ x: x - width / 2 - 2, y: bestY - 11, w: width + 4, h: 14 });
      labels.push({ text: hull.name, x, y: clamp(bestY, 14, this.height - 4) });
    });

    // Names go on after every patch, with a halo, so a neighbouring patch never covers them.
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.surface;
    ctx.fillStyle = palette.muted;
    for (const label of labels) {
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillText(label.text, label.x, label.y);
    }
  }

  /** A dead end: the chain retraces its steps to the last student with someone left to tell. */
  private drawBacktrack(scene: Scene, path: number[], progress: number): void {
    const { ctx } = this;
    const { palette } = scene;

    ctx.strokeStyle = palette.inkSoft;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(this.px[path[0]], this.py[path[0]]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(this.px[path[i]], this.py[path[i]]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (scene.reducedMotion) return;

    // A hollow marker walks back along the path.
    const lengths: number[] = [];
    let totalLength = 0;
    for (let i = 1; i < path.length; i++) {
      const length = Math.hypot(this.px[path[i]] - this.px[path[i - 1]], this.py[path[i]] - this.py[path[i - 1]]);
      lengths.push(length);
      totalLength += length;
    }
    let remaining = easeInOut(clamp(progress / 0.9, 0, 1)) * totalLength;
    let x = this.px[path[0]];
    let y = this.py[path[0]];
    for (let i = 0; i < lengths.length; i++) {
      const fromX = this.px[path[i]];
      const fromY = this.py[path[i]];
      const toX = this.px[path[i + 1]];
      const toY = this.py[path[i + 1]];
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const share = lengths[i] === 0 ? 1 : clamp(remaining / lengths[i], 0, 1);
        x = fromX + (toX - fromX) * share;
        y = fromY + (toY - fromY) * share;
        break;
      }
      remaining -= lengths[i];
    }
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Names for the students that matter right now. Everyone else stays unlabeled to keep the map calm. */
  private drawLabels(scene: Scene, extra: Label[]): void {
    const { ctx } = this;
    const { campus, trace, palette } = scene;
    const labels: Label[] = [];
    const add = (id: number | null, text?: string) => {
      if (id === null || id >= campus.students.length) return;
      if (labels.some((label) => label.id === id)) return;
      labels.push({ id, text: text ?? campus.students[id].name });
    };

    add(trace.source, `${campus.students[trace.source].name} (source)`);
    if (trace.checker !== null) add(trace.checker, `${campus.students[trace.checker].name} (fact-checker)`);
    for (const label of extra) add(label.id, label.text);
    add(scene.selected);
    add(scene.hovered);

    ctx.font = `600 12px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const label of labels) {
      const x = this.px[label.id];
      const y = this.py[label.id];
      if (x < -40 || x > this.width + 40 || y < -20 || y > this.height + 20) continue;
      const offset = this.unit * 1.5 + 8;
      const textWidth = ctx.measureText(label.text).width;
      const fitsRight = x + offset + textWidth < this.width - 6;
      ctx.textAlign = fitsRight ? 'left' : 'right';
      const textX = fitsRight ? x + offset : x - offset;
      ctx.strokeStyle = palette.surface;
      ctx.lineWidth = 4;
      ctx.strokeText(label.text, textX, y);
      ctx.fillStyle = palette.ink;
      ctx.fillText(label.text, textX, y);
    }
  }
}
