import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowsInIcon,
  DownloadSimpleIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  XIcon,
} from '@phosphor-icons/react';
import { TRAITS, type Campus } from '../sim/campus';
import { quickLayout, type Point } from '../sim/layout';
import type { RumorTemplate } from '../sim/rumor';
import { ROUTE_NAMES, summarize, type Trace } from '../sim/spread';
import { cachedLayout, layoutNow, requestLayout } from '../sim/workerClient';
import { SPEEDS, type PlaybackClock, type PlaybackState } from '../playback';
import { GraphRenderer, type MapView, type ViewTransform } from '../render/renderer';
import { BEND_CLASSES, BEND_RAMP, CANVAS_PALETTE, HEAT_RAMP, TRUTH_COLOR, useReducedMotion, type Mode } from '../theme';
import { listNames, percent, plural } from '../format';
import { Caption } from './Caption';
import { Frontier } from './Frontier';
import { IconButton } from './ui';

interface StageProps {
  campus: Campus;
  template: RumorTemplate;
  trace: Trace;
  clock: PlaybackClock;
  playback: PlaybackState;
  mode: Mode;
  view: MapView;
  onViewChange: (view: MapView) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  /** Students to spotlight on the map, for example everyone holding one version. */
  highlight: readonly number[] | null;
  /** A route to draw dashed over the map, such as the most believable path. */
  altPath: readonly number[] | null;
  /** Network view: reach if each student started the rumor. Null while it is being worked out. */
  heat: readonly number[] | null;
  /** Network view: bridge friendships and how many students each one isolates. */
  bridges: ReadonlyMap<number, number> | null;
  onToggleCut: (tieId: number) => void;
  onRestoreCuts: () => void;
  /** Small screens: jump from the map to the Trace panel. */
  onShowTrace: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
}

type Hover = { kind: 'student'; id: number; x: number; y: number } | { kind: 'tie'; id: number; x: number; y: number };

interface Layout {
  /** Which campus and canvas shape these points were computed for. */
  campusKey: string;
  key: string;
  points: Point[];
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 };

export function Stage(props: StageProps) {
  const { campus, template, trace, clock, playback, mode, view, onViewChange, selected, onSelect } = props;
  const { highlight, altPath, heat, bridges, onToggleCut, onRestoreCuts, onShowTrace, speed, onSpeedChange } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const reducedMotion = useReducedMotion();

  // The layout is computed off the main thread. Until it arrives the map shows
  // the previous layout for this campus, or a quick rough one, and then eases
  // into place.
  const aspect = size.height > 0 ? Math.round((size.width / size.height) * 6) / 6 : 0;
  const campusKey = `${campus.seed}:${campus.students.length}`;
  const layoutKey = `${campusKey}:${aspect}`;
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    if (aspect <= 0) return;
    let current = true;
    requestLayout(campus, aspect).then((points) => {
      if (current) setLayout({ campusKey, key: layoutKey, points });
    });
    return () => {
      current = false;
    };
  }, [campus, aspect, campusKey, layoutKey]);

  const points = useMemo(() => {
    if (aspect <= 0) return null;
    if (layout?.key === layoutKey) return layout.points;
    // First paint: lay out right away so the map never opens on the rough placeholder.
    if (layout === null) return layoutNow(campus, aspect);
    return (
      cachedLayout(campus, aspect) ?? (layout.campusKey === campusKey ? layout.points : quickLayout(campus, aspect))
    );
  }, [layout, layoutKey, campusKey, campus, aspect]);

  // The animation loop. It advances the playhead and redraws, and goes to sleep
  // when nothing is moving. React state is never touched per frame.
  useEffect(() => {
    const renderer = new GraphRenderer(canvasRef.current!);
    rendererRef.current = renderer;
    let frame = 0;
    let running = false;
    let last = 0;

    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      const moving = clock.advance(elapsed);
      const settling = renderer.draw(clock.position, elapsed);
      if (moving || settling) frame = requestAnimationFrame(tick);
      else running = false;
    };
    const wake = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.resize(width, height, Math.min(3, window.devicePixelRatio || 1));
      renderer.draw(clock.position, 16);
      setSize({ width, height });
      wake();
    });
    observer.observe(wrapRef.current!);
    const unsubscribe = clock.subscribe(wake);
    document.fonts?.ready.then(wake);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      rendererRef.current = null;
    };
  }, [clock]);

  /* ---------------- Zoom and pan ---------------- */

  const viewRef = useRef<ViewTransform>(IDENTITY);
  const [zoom, setZoom] = useState(1);

  const applyView = useCallback((next: ViewTransform) => {
    const width = wrapRef.current?.clientWidth ?? 0;
    const height = wrapRef.current?.clientHeight ?? 0;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.scale));
    // Keep the map covering the frame: no panning past its edges.
    const x = Math.min(0, Math.max(width - width * scale, next.x));
    const y = Math.min(0, Math.max(height - height * scale, next.y));
    viewRef.current = { scale, x, y };
    rendererRef.current?.setView(viewRef.current);
    setZoom(scale);
    setHover(null);
    wakeRef.current();
  }, []);

  /** Zooms by `factor`, keeping the canvas point (cx, cy) fixed under the pointer. */
  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const current = viewRef.current;
      const width = wrapRef.current?.clientWidth ?? 0;
      const height = wrapRef.current?.clientHeight ?? 0;
      const px = cx ?? width / 2;
      const py = cy ?? height / 2;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
      const k = scale / current.scale;
      applyView({ scale, x: px - (px - current.x) * k, y: py - (py - current.y) * k });
    },
    [applyView],
  );

  // A new campus starts zoomed out.
  const zoomedCampus = useRef(campusKey);
  useEffect(() => {
    if (zoomedCampus.current === campusKey) return;
    zoomedCampus.current = campusKey;
    applyView(IDENTITY);
  }, [campusKey, applyView]);
  // Re-clamp after the frame changes size.
  useEffect(() => {
    if (size.width > 0) applyView(viewRef.current);
  }, [size, applyView]);

  // Ctrl + scroll (and trackpad pinch, which browsers report the same way) zooms.
  // Plain scrolling is left alone so the page still scrolls past the map.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /* ---------------- Scene ---------------- */

  const hoveredStudent = hover?.kind === 'student' && hover.id < campus.students.length ? hover.id : null;
  const hoveredTie = hover?.kind === 'tie' && hover.id < campus.ties.length ? hover.id : null;
  const highlightSet = useMemo(() => (highlight ? new Set(highlight) : null), [highlight]);

  useEffect(() => {
    if (!points) return;
    rendererRef.current?.setScene({
      campus,
      points,
      trace,
      mode,
      palette: CANVAS_PALETTE[mode],
      view,
      selected,
      hovered: hoveredStudent,
      hoveredTie,
      highlight: view === 'spread' ? highlightSet : null,
      altPath,
      heat,
      bridges,
      reducedMotion,
    });
    wakeRef.current();
  }, [
    campus,
    points,
    trace,
    mode,
    view,
    selected,
    hoveredStudent,
    hoveredTie,
    highlightSet,
    altPath,
    heat,
    bridges,
    reducedMotion,
  ]);

  // Forget the hover when the campus or the view changes underneath it.
  const [hoverScope, setHoverScope] = useState({ campus, view });
  if (hoverScope.campus !== campus || hoverScope.view !== view) {
    setHoverScope({ campus, view });
    setHover(null);
  }

  /* ---------------- Pointer input ---------------- */

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; viewX: number; viewY: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const studentAt = (id: number | null): Hover | null => {
    const point = id === null ? null : (rendererRef.current?.pointOf(id) ?? null);
    return id !== null && point ? { kind: 'student', id, x: point.x, y: point.y } : null;
  };

  const probe = (x: number, y: number): Hover | null => {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const student = studentAt(renderer.hitTest(x, y));
    if (student || view !== 'network') return student;
    const tie = renderer.hitTie(x, y);
    const middle = tie === null ? null : renderer.midpointOf(tie);
    return tie !== null && middle ? { kind: 'tie', id: tie, x: middle.x, y: middle.y } : null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      drag.current = { ...point, viewX: viewRef.current.x, viewY: viewRef.current.y, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: viewRef.current.scale };
      if (drag.current) drag.current.moved = true;
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinch.current.scale * (distance / pinch.current.distance);
      zoomAt(target / viewRef.current.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (drag.current && pointers.current.size === 1) {
      const dx = point.x - drag.current.x;
      const dy = point.y - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
      if (drag.current.moved && viewRef.current.scale > 1) {
        applyView({ scale: viewRef.current.scale, x: drag.current.viewX + dx, y: drag.current.viewY + dy });
      }
      return;
    }
    if (event.pointerType === 'touch') return;
    const next = probe(point.x, point.y);
    setHover((previous) => (previous?.kind === next?.kind && previous?.id === next?.id ? previous : next));
  };

  const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const gesture = drag.current;
    if (pointers.current.size === 0) drag.current = null;
    if (cancelled || !gesture || gesture.moved || pointers.current.size > 0) return;

    // A tap or click that did not drag: pick a student, or cut a friendship in the network view.
    const point = local(event);
    const hit = probe(point.x, point.y);
    if (hit?.kind === 'tie') onToggleCut(hit.id);
    else onSelect(hit?.kind === 'student' ? hit.id : null);
  };

  /* ---------------- Export ---------------- */

  const total = trace.ticks.length;
  const completed = Math.min(playback.completed, total);
  const finished = completed >= total && !playback.moving;
  const live = useMemo(() => summarize(trace, completed), [trace, completed]);

  const saveImage = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.snapshot().toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        view === 'network'
          ? `rumor-mill-campus-${campus.seed}-network.png`
          : `rumor-mill-campus-${campus.seed}-${trace.algorithm}-retelling-${completed}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  const playLabel = playback.playing ? 'Pause' : finished ? 'Replay' : completed > 0 ? 'Resume' : 'Spread it';
  const togglePlay = () => {
    if (view === 'network' && !playback.playing) onViewChange('spread');
    clock.toggle();
  };
  const cuts = campus.ties.filter((tie) => tie.cut).length;

  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:h-full">
      <div
        ref={wrapRef}
        className="relative order-1 h-[clamp(280px,calc(100svh-345px),560px)] lg:order-none lg:h-auto lg:min-h-0 lg:flex-1"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            view === 'network'
              ? `Network of ${campus.students.length} students, colored by how far a rumor would spread if each one started it. The Trace tab gives details for any student.`
              : `Map of ${campus.students.length} students and their friendships. ${live.heard} of them ${live.heard === 1 ? 'believes' : 'believe'} the rumor so far. The Trace, Versions, and Log tabs give the same information as text.`
          }
          className={`absolute inset-0 size-full ${hover ? 'cursor-pointer' : zoom > 1 ? 'cursor-grab' : 'cursor-default'}`}
          style={{ touchAction: zoom > 1 ? 'none' : 'pan-y' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endPointer(event, false)}
          onPointerCancel={(event) => endPointer(event, true)}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') setHover(null);
          }}
        />

        <MapToolbar
          view={view}
          onViewChange={onViewChange}
          zoom={zoom}
          onZoomIn={() => zoomAt(1.5)}
          onZoomOut={() => zoomAt(1 / 1.5)}
          onZoomReset={() => applyView(IDENTITY)}
          onSave={saveImage}
        />

        {hover?.kind === 'student' && hoveredStudent !== null && (
          <Tooltip x={hover.x} y={hover.y} size={size}>
            <StudentTip campus={campus} trace={trace} completed={completed} id={hover.id} view={view} heat={heat} />
          </Tooltip>
        )}
        {hover?.kind === 'tie' && hoveredTie !== null && (
          <Tooltip x={hover.x} y={hover.y} size={size}>
            <TieTip campus={campus} tieId={hover.id} isolates={bridges?.get(hover.id) ?? 0} />
          </Tooltip>
        )}
      </div>

      {selected !== null && selected < campus.students.length && (
        <SelectionBar
          campus={campus}
          trace={trace}
          completed={completed}
          selected={selected}
          onClear={() => onSelect(null)}
          onShowTrace={onShowTrace}
        />
      )}

      {view === 'network' ? (
        <div className="order-4 lg:order-none">
          <NetworkCaption campus={campus} trace={trace} heat={heat} cuts={cuts} onRestoreCuts={onRestoreCuts} />
        </div>
      ) : (
        <>
          <div className="order-5 lg:order-none">
            <Frontier
              campus={campus}
              trace={trace}
              playback={playback}
              mode={mode}
              onPeek={(id) => setHover(studentAt(id))}
            />
          </div>
          <div className="order-4 lg:order-none">
            <Caption campus={campus} template={template} trace={trace} playback={playback} />
          </div>
        </>
      )}
      <Legend mode={mode} view={view} hasChecker={trace.checker !== null} hasCuts={cuts > 0} />

      <div className="order-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-3 py-2.5 sm:px-4 lg:order-none">
        <div className="flex items-center gap-1">
          <IconButton label="Restart" onClick={() => clock.seek(0)} disabled={completed === 0 && !playback.moving}>
            <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
          </IconButton>
          <IconButton
            label="Step back"
            shortcut="ArrowLeft"
            onClick={() => clock.stepBack()}
            disabled={completed === 0 && !playback.moving}
          >
            <SkipBackIcon size={18} weight="fill" aria-hidden />
          </IconButton>
          <button
            type="button"
            onClick={togglePlay}
            disabled={total === 0}
            aria-keyshortcuts="Space"
            className="mx-1 inline-flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
          >
            {playback.playing ? (
              <PauseIcon size={16} weight="fill" aria-hidden />
            ) : (
              <PlayIcon size={16} weight="fill" aria-hidden />
            )}
            {playLabel}
          </button>
          <IconButton
            label="Step forward"
            shortcut="ArrowRight"
            onClick={() => clock.stepForward()}
            disabled={completed >= total}
          >
            <SkipForwardIcon size={18} weight="fill" aria-hidden />
          </IconButton>
        </div>

        <div className="flex min-w-[140px] flex-1 items-center gap-3">
          <input
            type="range"
            name="timeline"
            className="slider"
            min={0}
            max={Math.max(1, total)}
            step={1}
            value={completed}
            disabled={total === 0}
            onChange={(event) => clock.seek(Number(event.target.value))}
            aria-label="Timeline"
            aria-valuetext={`Retelling ${completed} of ${total}`}
            style={{ '--fill': `${total === 0 ? 0 : (completed / total) * 100}%` } as CSSProperties}
          />
          <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-ink-2">
            {completed}/{total}
          </span>
        </div>

        <label className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
          <span className="sr-only sm:not-sr-only">Speed</span>
          <select
            name="speed"
            value={speed}
            onChange={(event) => onSpeedChange(Number(event.target.value))}
            className="h-9 cursor-pointer rounded-control border border-line-strong bg-surface px-2 font-mono text-[13px] text-ink transition-colors hover:border-ink-3"
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Map toolbar                                                         */
/* ------------------------------------------------------------------ */

interface MapToolbarProps {
  view: MapView;
  onViewChange: (view: MapView) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onSave: () => void;
}

const TOOL =
  'inline-flex size-8 items-center justify-center rounded-[7px] text-ink-2 transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35';

function MapToolbar({ view, onViewChange, zoom, onZoomIn, onZoomOut, onZoomReset, onSave }: MapToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
      <fieldset className="pointer-events-auto flex gap-0.5 rounded-control border border-line bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm">
        <legend className="sr-only">Map view</legend>
        {(
          [
            ['spread', 'Spread'],
            ['network', 'Network'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="cursor-pointer">
            <input
              type="radio"
              name="map-view"
              value={value}
              checked={view === value}
              onChange={() => onViewChange(value)}
              className="peer sr-only"
            />
            <span className="flex h-8 items-center rounded-[7px] px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink peer-checked:bg-ink peer-checked:text-bg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="pointer-events-auto flex gap-0.5 rounded-control border border-line bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          className={TOOL}
          onClick={onZoomOut}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <MagnifyingGlassMinusIcon size={16} weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className={TOOL}
          onClick={onZoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          title="Zoom in (or ctrl + scroll)"
        >
          <MagnifyingGlassPlusIcon size={16} weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className={TOOL}
          onClick={onZoomReset}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Fit the whole campus"
          title="Fit the whole campus"
        >
          <ArrowsInIcon size={16} weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className={TOOL}
          onClick={onSave}
          aria-label="Save the map as an image"
          title="Save the map as an image"
        >
          <DownloadSimpleIcon size={16} weight="bold" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend and captions                                                 */
/* ------------------------------------------------------------------ */

interface LegendProps {
  mode: Mode;
  view: MapView;
  hasChecker: boolean;
  hasCuts: boolean;
}

function Legend({ mode, view, hasChecker, hasCuts }: LegendProps) {
  const dot = 'inline-block shrink-0 rounded-full';
  const shell =
    'order-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5 lg:order-none';
  const cut = (
    <div className="flex items-center gap-1.5">
      <svg width="22" height="10" aria-hidden className="text-ink-2">
        <line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
        <path d="M8 2l6 6M14 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>Cut friendship</span>
    </div>
  );

  if (view === 'network') {
    const ramp = HEAT_RAMP[mode];
    return (
      <div className={shell}>
        <div className="flex items-center gap-2">
          <span>Reach if they started it</span>
          <span className="font-mono text-ink-2">fewer</span>
          <div className="flex items-center gap-1">
            {ramp.map((color) => (
              <span key={color} className={`${dot} size-2.5`} style={{ background: color }} />
            ))}
          </div>
          <span className="font-mono text-ink-2">more</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-[2.5px] w-5 rounded-full bg-ink-2" />
          <span>Bridge: the only link to part of campus</span>
        </div>
        {hasCuts && cut}
      </div>
    );
  }

  const ramp = BEND_RAMP[mode];
  return (
    <div className={shell}>
      <div className="flex items-center gap-2">
        <span>Details bent</span>
        <div className="flex items-center gap-1.5">
          {BEND_CLASSES.map((label, i) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`${dot} size-2.5`} style={{ background: ramp[i] }} />
              <span className="font-mono tabular-nums text-ink-2">{label}</span>
            </span>
          ))}
        </div>
      </div>
      {hasChecker && (
        <div className="flex items-center gap-1.5">
          <span className={`${dot} size-2.5`} style={{ background: TRUTH_COLOR[mode] }} />
          <span>Heard the fact-checker first</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className={`${dot} size-3.5`} style={{ background: ramp[1] }} />
        <span className={`${dot} size-2`} style={{ background: ramp[1] }} />
        <span>Bigger means more credible</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`${dot} size-2.5 border-2 bg-surface`} style={{ borderColor: ramp[2] }} />
        <span>Heard it, will not repeat it</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`${dot} size-2.5 border border-ink-3 bg-surface`} />
        <span>Has not heard it</span>
      </div>
      {hasCuts && cut}
    </div>
  );
}

interface NetworkCaptionProps {
  campus: Campus;
  trace: Trace;
  heat: readonly number[] | null;
  cuts: number;
  onRestoreCuts: () => void;
}

/** What the network view shows, who the best spreaders are, and how to cut friendships. */
function NetworkCaption({ campus, trace, heat, cuts, onRestoreCuts }: NetworkCaptionProps) {
  const route = ROUTE_NAMES[trace.algorithm].name.toLowerCase();
  let headline: string;
  if (!heat) {
    headline = 'Trying every student as the source…';
  } else {
    const ranked = heat.map((reach, id) => ({ reach, id })).sort((a, b) => b.reach - a.reach || a.id - b.id);
    const top = ranked.slice(0, 3).map(({ id, reach }) => `${campus.students[id].name} (${reach})`);
    const source = heat[trace.source];
    headline = `Best starting points by ${route}: ${listNames(top)}. ${campus.students[trace.source].name}, the current source, would reach ${source}.`;
  }

  return (
    <div className="min-h-[104px] border-t border-line px-4 py-3.5 sm:px-5" aria-live="polite">
      <p className="text-[13px] font-medium text-ink-3">
        Each student is colored by how many students the rumor would reach if they started it, with the current route
        and dials. Heavy lines are bridges. Click a friendship to cut it.
      </p>
      <p className="mt-1.5 text-pretty text-[15px] font-medium leading-snug text-ink">{headline}</p>
      {cuts > 0 && (
        <button
          type="button"
          onClick={onRestoreCuts}
          className="mt-2 inline-flex h-8 items-center rounded-control border border-line-strong px-3 text-[13px] font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]"
        >
          Restore {plural(cuts, 'cut friendship')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltips and the selection bar                                      */
/* ------------------------------------------------------------------ */

export function describeStudent(campus: Campus, trace: Trace, completed: number, id: number): string {
  const hearing = trace.hearings[id];
  if (id === trace.source) return 'Started the rumor.';
  if (id === trace.checker) return 'The fact-checker. Knows the truth from the start.';
  if (!hearing || hearing.tick >= completed) return 'Has not heard anything yet.';
  const teller = campus.students[hearing.from!].name;
  let status = hearing.truth
    ? `Set straight by ${teller} at hop ${hearing.hop}. ${percent(hearing.credibility)} credible.`
    : `Heard it from ${teller} at hop ${hearing.hop}. ${percent(hearing.credibility)} credible, ${plural(hearing.bends, 'detail')} bent.`;
  if (!hearing.repeats) status += ' Too doubtful to repeat it.';
  return status;
}

interface TooltipProps {
  x: number;
  y: number;
  size: { width: number; height: number };
  children: ReactNode;
}

function Tooltip({ x, y, size, children }: TooltipProps) {
  const width = 230;
  const flipX = x + 16 + width > size.width - 8;
  const flipY = y > size.height * 0.62;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-control border border-line bg-surface px-3 py-2.5 text-[13px] leading-snug shadow-[var(--shadow)]"
      style={{
        width,
        left: flipX ? Math.max(8, x - 16 - width) : x + 16,
        top: y + (flipY ? -14 : 14),
        transform: flipY ? 'translateY(-100%)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

interface StudentTipProps {
  campus: Campus;
  trace: Trace;
  completed: number;
  id: number;
  view: MapView;
  heat: readonly number[] | null;
}

function StudentTip({ campus, trace, completed, id, view, heat }: StudentTipProps) {
  const student = campus.students[id];
  return (
    <>
      <p className="font-semibold text-ink">{student.name}</p>
      <p className="text-ink-3">
        {TRAITS[student.trait].label}, {campus.groups[student.group].name}
      </p>
      <p className="mt-1.5 text-ink-2">
        {view === 'network'
          ? heat
            ? `If ${student.name} started it, ${plural(heat[id], 'student')} would hear it. ${plural(campus.friends[id].length, 'friend')}.`
            : 'Working out their reach…'
          : describeStudent(campus, trace, completed, id)}
      </p>
    </>
  );
}

function TieTip({ campus, tieId, isolates }: { campus: Campus; tieId: number; isolates: number }) {
  const tie = campus.ties[tieId];
  const a = campus.students[tie.a].name;
  const b = campus.students[tie.b].name;
  let detail: string;
  if (tie.cut) detail = 'Cut: nothing travels here. Click to restore it.';
  else if (isolates >= 2)
    detail = `A bridge. Cutting it leaves ${isolates} students unreachable from the rest. Click to cut it.`;
  else if (isolates === 1) detail = `The only link to one student. Click to cut it.`;
  else detail = 'Click to cut it and see what changes.';
  return (
    <>
      <p className="font-semibold text-ink">
        {a} and {b}
      </p>
      <p className="text-ink-3">
        {percent(tie.closeness)} close{tie.bridge ? ', across two groups' : ''}
      </p>
      <p className="mt-1.5 text-ink-2">{detail}</p>
    </>
  );
}

interface SelectionBarProps {
  campus: Campus;
  trace: Trace;
  completed: number;
  selected: number;
  onClear: () => void;
  onShowTrace: () => void;
}

/** Small screens: the Trace panel sits far below the map, so a tap shows the essentials right here. */
function SelectionBar({ campus, trace, completed, selected, onClear, onShowTrace }: SelectionBarProps) {
  const student = campus.students[selected];
  return (
    <div className="order-2 flex items-start gap-3 border-t border-line px-4 py-3 lg:hidden" aria-live="polite">
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <p className="font-semibold text-ink">
          {student.name}{' '}
          <span className="font-normal text-ink-3">
            {TRAITS[student.trait].label}, {campus.groups[student.group].name}
          </span>
        </p>
        <p className="text-ink-2">{describeStudent(campus, trace, completed, selected)}</p>
      </div>
      <button
        type="button"
        onClick={onShowTrace}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-[13px] font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]"
      >
        <ArrowDownIcon size={14} weight="bold" aria-hidden />
        Trace
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="-mr-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <XIcon size={16} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
