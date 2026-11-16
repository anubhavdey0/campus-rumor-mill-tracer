import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react';
import type { Campus } from '../sim/campus';
import { ALGORITHMS, ROUTE_NAMES, summarize, type Algorithm, type Trace } from '../sim/spread';
import { cachedLayout, layoutNow, requestLayout } from '../sim/workerClient';
import { PlaybackClock, usePlayback } from '../playback';
import { GraphRenderer } from '../render/renderer';
import { CANVAS_PALETTE, useReducedMotion, type Mode } from '../theme';

interface RaceViewProps {
  campus: Campus;
  traces: Record<Algorithm, Trace>;
  mode: Mode;
}

const RACE_SPEED = 2;

/**
 * All three routes released at the same moment, one retelling per beat on
 * each map, so the shape of each search is visible side by side.
 */
export function RaceView({ campus, traces, mode }: RaceViewProps) {
  const [clocks] = useState(
    () =>
      Object.fromEntries(
        ALGORITHMS.map((algorithm) => {
          const clock = new PlaybackClock();
          clock.speed = RACE_SPEED;
          return [algorithm, clock];
        }),
      ) as Record<Algorithm, PlaybackClock>,
  );
  const canvases = useRef<Partial<Record<Algorithm, HTMLCanvasElement | null>>>({});
  const renderers = useRef<Partial<Record<Algorithm, GraphRenderer>>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const wakeRef = useRef<() => void>(() => {});
  const [aspect, setAspect] = useState(0);
  const reducedMotion = useReducedMotion();
  const states = {
    bfs: usePlayback(clocks.bfs),
    dfs: usePlayback(clocks.dfs),
    best: usePlayback(clocks.best),
  };
  const anyMoving = ALGORITHMS.some((algorithm) => states[algorithm].moving);
  const allDone = ALGORITHMS.every((algorithm) => states[algorithm].completed >= traces[algorithm].ticks.length);

  // One animation loop drives all three maps and sleeps when nothing moves.
  useEffect(() => {
    let frame = 0;
    let running = false;
    let last = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      let busy = false;
      for (const algorithm of ALGORITHMS) {
        const moving = clocks[algorithm].advance(elapsed);
        const settling = renderers.current[algorithm]?.draw(clocks[algorithm].position, elapsed) ?? false;
        busy = busy || moving || settling;
      }
      if (busy) frame = requestAnimationFrame(tick);
      else running = false;
    };
    const wake = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    for (const algorithm of ALGORITHMS) {
      renderers.current[algorithm] = new GraphRenderer(canvases.current[algorithm]!);
    }
    const observer = new ResizeObserver(() => {
      const canvas = canvases.current.bfs;
      if (!canvas) return;
      const { width, height } = canvas.getBoundingClientRect();
      for (const algorithm of ALGORITHMS) {
        renderers.current[algorithm]?.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
      }
      setAspect(height > 0 ? Math.round((width / height) * 6) / 6 : 0);
      wake();
    });
    observer.observe(frameRef.current!);
    const unsubscribers = ALGORITHMS.map((algorithm) => clocks[algorithm].subscribe(wake));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [clocks]);

  // A new run resets the race.
  useEffect(() => {
    for (const algorithm of ALGORITHMS) clocks[algorithm].load(traces[algorithm].ticks.length);
  }, [clocks, traces]);

  const [points, setPoints] = useState<{ key: string; points: ReturnType<typeof layoutNow> } | null>(null);
  const layoutKey = `${campus.seed}:${campus.students.length}:${aspect}`;
  useEffect(() => {
    if (aspect <= 0) return;
    let current = true;
    requestLayout(campus, aspect).then((result) => {
      if (current) setPoints({ key: layoutKey, points: result });
    });
    return () => {
      current = false;
    };
  }, [campus, aspect, layoutKey]);

  useEffect(() => {
    if (aspect <= 0) return;
    const shown =
      points?.key === layoutKey ? points.points : (cachedLayout(campus, aspect) ?? layoutNow(campus, aspect));
    for (const algorithm of ALGORITHMS) {
      renderers.current[algorithm]?.setScene({
        campus,
        points: shown,
        trace: traces[algorithm],
        mode,
        palette: CANVAS_PALETTE[mode],
        view: 'spread',
        selected: null,
        hovered: null,
        hoveredTie: null,
        highlight: null,
        altPath: null,
        heat: null,
        bridges: null,
        reducedMotion,
      });
    }
    wakeRef.current();
  }, [campus, traces, mode, aspect, points, layoutKey, reducedMotion]);

  const play = () => {
    if (anyMoving) {
      for (const algorithm of ALGORITHMS) clocks[algorithm].pause();
      return;
    }
    const restart = allDone;
    for (const algorithm of ALGORITHMS) {
      const clock = clocks[algorithm];
      if (restart) clock.seek(0);
      if (clock.position < clock.total) clock.play();
    }
  };

  const restart = () => {
    for (const algorithm of ALGORITHMS) clocks[algorithm].seek(0);
  };

  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">Watch them race</h3>
          <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
            The same rumor, released at the same moment on all three routes, one retelling per beat on each map.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={restart}
            aria-label="Restart the race"
            className="inline-flex size-10 items-center justify-center rounded-control text-ink-2 transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.94]"
          >
            <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            onClick={play}
            className="inline-flex h-10 min-w-[132px] items-center justify-center gap-2 rounded-control bg-ink px-4 text-sm font-semibold text-bg transition-[filter,transform] hover:brightness-110 active:scale-[0.97]"
          >
            {anyMoving ? (
              <PauseIcon size={16} weight="fill" aria-hidden />
            ) : (
              <PlayIcon size={16} weight="fill" aria-hidden />
            )}
            {anyMoving ? 'Pause race' : allDone ? 'Race again' : 'Start the race'}
          </button>
        </div>
      </div>

      <div ref={frameRef} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ALGORITHMS.map((algorithm) => {
          const trace = traces[algorithm];
          const state = states[algorithm];
          const completed = Math.min(state.completed, trace.ticks.length);
          const done = completed >= trace.ticks.length && !state.moving;
          const summary = summarize(trace, completed);
          return (
            <figure key={algorithm} className="overflow-hidden rounded-panel border border-line bg-surface">
              <div className="relative aspect-[4/3]">
                <canvas
                  ref={(element) => {
                    canvases.current[algorithm] = element;
                  }}
                  role="img"
                  aria-label={`${ROUTE_NAMES[algorithm].name}: ${summary.heard} of ${summary.students} students believe the rumor after ${completed} of ${trace.ticks.length} retellings.`}
                  className="absolute inset-0 size-full"
                />
              </div>
              <figcaption className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-2.5">
                <span className="text-[13px] font-semibold text-ink">{ROUTE_NAMES[algorithm].name}</span>
                <span className="font-mono text-[12px] tabular-nums text-ink-3">
                  {summary.heard}/{summary.students} {done ? 'done' : `· ${completed}/${trace.ticks.length}`}
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
