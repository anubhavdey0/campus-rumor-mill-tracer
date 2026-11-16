/**
 * Talks to the background worker. If workers are unavailable or the worker
 * fails, every request falls back to running on the main thread, so the page
 * still works, just less smoothly.
 */

import type { Campus } from './campus';
import { layoutCampus, type Point } from './layout';
import { reachFromEach } from './network';
import { rerun, RERUNS, tippingCurve, type RerunResult, type TippingPoint } from './rerun';
import type { RumorTemplate } from './rumor';
import type { Algorithm, FactChecker, SpreadParams } from './spread';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

type Pending = { resolve: (value: unknown) => void; fallback: () => unknown };

/** WorkerRequest without its id, kept as a union so each request type keeps its own fields. */
type Request = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(): void {
  worker?.terminate();
  worker = null;
  for (const [id, job] of pending) {
    pending.delete(id);
    job.resolve(job.fallback());
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      job.resolve(event.data.result);
    };
    worker.onerror = failAll;
    worker.onmessageerror = failAll;
  } catch {
    worker = null;
  }
  return worker;
}

function send<T>(request: Request, fallback: () => T): Promise<T> {
  const target = getWorker();
  if (!target) return Promise.resolve(fallback());
  const id = nextId++;
  return new Promise<T>((resolve) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, fallback });
    target.postMessage({ ...request, id } as WorkerRequest);
  });
}

/* Layouts are cached, so resizing back and forth or revisiting a campus is instant. */
const layoutCache = new Map<string, Point[]>();
const LAYOUT_CACHE_SIZE = 24;

export function cachedLayout(campus: Campus, aspect: number): Point[] | undefined {
  return layoutCache.get(`${campus.seed}:${campus.students.length}:${aspect}`);
}

/**
 * Computes a layout right here on the main thread and caches it. Used once,
 * for the first paint, so nobody sees the rough placeholder while the worker
 * starts up.
 */
export function layoutNow(campus: Campus, aspect: number): Point[] {
  const key = `${campus.seed}:${campus.students.length}:${aspect}`;
  let points = layoutCache.get(key);
  if (!points) {
    points = layoutCampus(campus, aspect);
    layoutCache.set(key, points);
  }
  return points;
}

export async function requestLayout(campus: Campus, aspect: number): Promise<Point[]> {
  const key = `${campus.seed}:${campus.students.length}:${aspect}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const points = await send({ type: 'layout', campus, aspect }, () => layoutCampus(campus, aspect));
  layoutCache.set(key, points);
  if (layoutCache.size > LAYOUT_CACHE_SIZE) layoutCache.delete(layoutCache.keys().next().value!);
  return points;
}

export interface ScenarioInput {
  campus: Campus;
  template: RumorTemplate;
  source: number;
  params: SpreadParams;
  checker: FactChecker | null;
}

export function requestRerun(input: ScenarioInput, runs: number = RERUNS): Promise<RerunResult> {
  const { campus, template, source, params, checker } = input;
  return send({ type: 'rerun', runs, ...input }, () => rerun(campus, template, source, params, runs, checker));
}

export function requestCurve(input: ScenarioInput): Promise<TippingPoint[]> {
  const { campus, template, source, params, checker } = input;
  return send({ type: 'curve', ...input }, () => tippingCurve(campus, template, source, params, checker));
}

export function requestReach(
  campus: Campus,
  template: RumorTemplate,
  algorithm: Algorithm,
  params: SpreadParams,
): Promise<number[]> {
  return send({ type: 'reach', campus, template, algorithm, params }, () =>
    reachFromEach(campus, template, algorithm, params),
  );
}
