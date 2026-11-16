import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DesktopIcon, GraphIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { generateCampus } from './sim/campus';
import { findBridges, mostBelievablePath, withCuts } from './sim/network';
import { hashInts, hashString } from './sim/rng';
import { CUSTOM_EXAMPLE, PRESETS, isUsableRumor, parseCustomRumor } from './sim/rumor';
import type { RerunResult, TippingPoint } from './sim/rerun';
import {
  ALGORITHMS,
  simulate,
  summarize,
  type Algorithm,
  type FactChecker,
  type SpreadParams,
  type Summary,
  type Trace,
} from './sim/spread';
import { versionTree } from './sim/versions';
import { requestCurve, requestReach, requestRerun } from './sim/workerClient';
import { PlaybackClock, usePlayback } from './playback';
import type { MapView } from './render/renderer';
import { useTheme, type Preference } from './theme';
import { decimal } from './format';
import { MAX_LEAD, MAX_SEED, readScenario, scenarioUrl, writeScenario, type Scenario } from './urlState';
import { Compare } from './components/Compare';
import { Controls, type LinkStatus, type Settings } from './components/Controls';
import { Intro } from './components/Intro';
import { LogPanel } from './components/LogPanel';
import { Model } from './components/Model';
import { Stage } from './components/Stage';
import { TracePanel } from './components/TracePanel';
import { VersionsPanel } from './components/VersionsPanel';
import { Tabs } from './components/ui';

type TabId = 'setup' | 'trace' | 'versions' | 'log';

const TABS: { id: TabId; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'trace', label: 'Trace' },
  { id: 'versions', label: 'Versions' },
  { id: 'log', label: 'Log' },
];

const DEFAULTS: Scenario = {
  seed: 4821,
  settings: {
    rumorId: PRESETS[0].id,
    algorithm: 'bfs',
    decay: 0.16,
    distortion: 0.35,
    cutoff: 0.25,
    size: 56,
  },
  source: null,
  customText: CUSTOM_EXAMPLE,
  checker: null,
  lead: 2,
  cuts: [],
};

const SHORTCUT_KEYS = new Set([' ', 'ArrowRight', 'ArrowLeft']);

const THEME_LABEL: Record<Preference, string> = { system: 'match your system', light: 'light', dark: 'dark' };
const THEME_NEXT: Record<Preference, Preference> = { system: 'light', light: 'dark', dark: 'system' };

export function App() {
  const { mode, preference, cycle: cycleTheme } = useTheme();

  // The scenario can arrive in the link, so the first render reads the URL.
  const [initial] = useState(() => readScenario(DEFAULTS));
  const [seed, setSeed] = useState(initial.seed);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [customDraft, setCustomDraft] = useState(initial.customText);
  const [customText, setCustomText] = useState(initial.customText);
  const [sourceChoice, setSourceChoice] = useState<number | null>(initial.source);
  const [checkerChoice, setCheckerChoice] = useState<number | null>(initial.checker);
  const [lead, setLead] = useState(initial.lead);
  const [cuts, setCuts] = useState<number[]>(initial.cuts);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [versionKey, setVersionKey] = useState<string | null>(null);
  const [view, setView] = useState<MapView>('spread');
  const [showBestPath, setShowBestPath] = useState(false);
  const [tab, setTab] = useState<TabId>('setup');
  const [speed, setSpeed] = useState(1);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('idle');
  const [reruns, setReruns] = useState<{ result: RerunResult | null; pending: boolean }>({
    result: null,
    pending: true,
  });
  const [curve, setCurve] = useState<TippingPoint[] | null>(null);
  const [heat, setHeat] = useState<{ key: string; values: number[] } | null>(null);

  const [clock] = useState(() => new PlaybackClock());
  const playback = usePlayback(clock);
  const autoplay = useRef(false);

  // Everything below is derived. The whole run is recomputed whenever an input changes.
  const baseCampus = useMemo(() => generateCampus(seed, settings.size), [seed, settings.size]);
  const campus = useMemo(() => withCuts(baseCampus, cuts), [baseCampus, cuts]);
  const template = useMemo(
    () =>
      settings.rumorId === 'custom'
        ? parseCustomRumor(customText)
        : (PRESETS.find((preset) => preset.id === settings.rumorId) ?? PRESETS[0]),
    [settings.rumorId, customText],
  );
  const inRange = (id: number | null) => (id !== null && id < campus.students.length ? id : null);
  const source = inRange(sourceChoice) ?? campus.defaultSource;
  const checkerId = inRange(checkerChoice) !== source ? inRange(checkerChoice) : null;
  const selected = inRange(selectedChoice);

  const params = useMemo<SpreadParams>(
    () => ({
      decay: settings.decay,
      distortion: settings.distortion,
      cutoff: settings.cutoff,
      seed: hashInts(seed, hashString(template.id)),
    }),
    [seed, template.id, settings.decay, settings.distortion, settings.cutoff],
  );
  const checker = useMemo<FactChecker | null>(
    () => (checkerId === null ? null : { student: checkerId, lead }),
    [checkerId, lead],
  );
  const traces = useMemo(
    () =>
      Object.fromEntries(
        ALGORITHMS.map((algorithm) => [algorithm, simulate(campus, template, source, algorithm, params, checker)]),
      ) as Record<Algorithm, Trace>,
    [campus, template, source, params, checker],
  );
  const trace = traces[settings.algorithm];

  // Dials only nudge the run, so the playhead keeps its place. A new campus,
  // source, route, rumor, fact-checker, or cut is a different story, so it starts over.
  const structureKey = [
    seed,
    settings.size,
    source,
    settings.algorithm,
    settings.rumorId,
    customText,
    checkerId,
    lead,
    cuts.join(','),
  ].join('|');
  const lastStructure = useRef(structureKey);
  useEffect(() => {
    const keepPlace = lastStructure.current === structureKey;
    lastStructure.current = structureKey;
    clock.load(trace.ticks.length, keepPlace);
    if (autoplay.current) {
      autoplay.current = false;
      clock.seek(0);
      clock.play();
    }
  }, [clock, trace, structureKey]);

  useEffect(() => {
    clock.speed = speed;
  }, [clock, speed]);

  // Background jobs: 200 reruns with other dice, and the tipping-point sweep.
  useEffect(() => {
    let current = true;
    setReruns((previous) => (previous.pending ? previous : { ...previous, pending: true }));
    const input = { campus, template, source, params, checker };
    const timer = window.setTimeout(() => {
      requestRerun(input).then((result) => {
        if (current) setReruns({ result, pending: false });
      });
      requestCurve(input).then((result) => {
        if (current) setCurve(result);
      });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [campus, template, source, params, checker]);

  // The network view needs every student's reach as a source. Only worked out while it is open.
  const heatKey = `${campus.seed}|${campus.students.length}|${cuts.join(',')}|${settings.algorithm}|${settings.decay}|${settings.cutoff}|${template.id}`;
  useEffect(() => {
    if (view !== 'network' || heat?.key === heatKey) return;
    let current = true;
    requestReach(campus, template, settings.algorithm, params).then((values) => {
      if (current) setHeat({ key: heatKey, values });
    });
    return () => {
      current = false;
    };
  }, [view, heatKey, heat?.key, campus, template, settings.algorithm, params]);
  const bridges = useMemo(() => (view === 'network' ? findBridges(campus) : null), [view, campus]);

  // Mirror the scenario into the address bar. Debounced, because sliders fire on every pixel.
  const scenario = useMemo<Scenario>(
    () => ({
      seed,
      settings,
      source: sourceChoice !== null && sourceChoice < settings.size ? sourceChoice : null,
      customText,
      checker: checkerChoice !== null && checkerChoice < settings.size ? checkerChoice : null,
      lead,
      cuts,
    }),
    [seed, settings, sourceChoice, customText, checkerChoice, lead, cuts],
  );
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  useEffect(() => {
    const timer = window.setTimeout(() => writeScenario(scenario, DEFAULTS), 250);
    return () => window.clearTimeout(timer);
  }, [scenario]);

  const loadScenario = useCallback((next: Scenario) => {
    setSeed(next.seed);
    setSettings(next.settings);
    setSourceChoice(next.source);
    setCustomText(next.customText);
    setCustomDraft(next.customText);
    setCheckerChoice(next.checker);
    setLead(next.lead);
    setCuts(next.cuts);
    setSelectedChoice(null);
    setVersionKey(null);
  }, []);

  // Back and Forward restore a previous campus.
  useEffect(() => {
    const onPopState = () => {
      const shown = new URL(scenarioUrl(scenarioRef.current, DEFAULTS), window.location.href).search;
      if (shown === window.location.search) return; // only the #section changed
      loadScenario(readScenario(DEFAULTS));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loadScenario]);

  // A link to #routes or #model lands on that section once the page has its final height.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const jump = () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(jump));
  }, []);

  useEffect(() => {
    if (linkStatus === 'idle') return;
    const timer = window.setTimeout(() => setLinkStatus('idle'), linkStatus === 'copied' ? 2000 : 8000);
    return () => window.clearTimeout(timer);
  }, [linkStatus]);

  // Space plays and pauses, the arrow keys step. They only apply while the map is on
  // screen and focus is on the page or in the simulator, so they never steal scrolling
  // from the rest of the page or keys from a control that uses them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!SHORTCUT_KEYS.has(event.key)) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const onPage = !target || target === document.body || target === document.documentElement;
      if (!onPage && !document.getElementById('simulator')?.contains(target)) return;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === ' ' && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
      const stage = document.getElementById('stage')?.getBoundingClientRect();
      if (!stage || stage.bottom < 120 || stage.top > window.innerHeight - 120) return;

      event.preventDefault();
      if (event.key === ' ') {
        if (!clock.playing) setView('spread');
        clock.toggle();
      } else if (event.key === 'ArrowRight') clock.stepForward();
      else clock.stepBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clock]);

  /* ---------------- Actions ---------------- */

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    if (patch.size !== undefined) {
      setSourceChoice(null);
      setCheckerChoice(null);
      setSelectedChoice(null);
      setCuts([]);
    }
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const goToCampus = useCallback((next: number) => {
    // Save where we are, then add a history entry so Back returns to this campus.
    writeScenario(scenarioRef.current, DEFAULTS);
    writeScenario({ ...scenarioRef.current, seed: next, source: null, checker: null, cuts: [] }, DEFAULTS, true);
    setSeed(next);
    setSourceChoice(null);
    setCheckerChoice(null);
    setSelectedChoice(null);
    setVersionKey(null);
    setCuts([]);
  }, []);

  const shuffleCampus = useCallback(() => goToCampus(1000 + Math.floor(Math.random() * 9000)), [goToCampus]);

  const resetDials = useCallback(() => {
    setSettings((current) => ({
      ...current,
      decay: DEFAULTS.settings.decay,
      distortion: DEFAULTS.settings.distortion,
      cutoff: DEFAULTS.settings.cutoff,
    }));
  }, []);

  const changeCustom = useCallback((text: string) => {
    setCustomDraft(text);
    if (isUsableRumor(text)) setCustomText(text);
  }, []);

  const selectStudent = useCallback((id: number | null) => {
    setSelectedChoice(id);
    if (id !== null) setTab('trace');
  }, []);

  const showTrace = useCallback(() => {
    setTab('trace');
    requestAnimationFrame(() => document.getElementById('panels')?.scrollIntoView({ block: 'start' }));
  }, []);

  const startHere = useCallback(
    (id: number) => {
      clock.seek(0);
      setSourceChoice(id);
      setCheckerChoice((current) => (current === id ? null : current));
    },
    [clock],
  );

  const toggleCut = useCallback((tieId: number) => {
    setCuts((current) =>
      current.includes(tieId) ? current.filter((id) => id !== tieId) : [...current, tieId].sort((a, b) => a - b),
    );
  }, []);

  const watchRoute = useCallback((algorithm: Algorithm) => {
    autoplay.current = true;
    setView('spread');
    setSettings((current) => ({ ...current, algorithm }));
    document.getElementById('simulator')?.scrollIntoView({ block: 'start' });
  }, []);

  const copyLink = useCallback(async () => {
    const url = new URL(scenarioUrl(scenario, DEFAULTS), window.location.href).href;
    writeScenario(scenario, DEFAULTS);
    try {
      await navigator.clipboard.writeText(url);
      setLinkStatus('copied');
    } catch {
      setLinkStatus('failed');
    }
  }, [scenario]);

  /* ---------------- Derived views ---------------- */

  const completed = Math.min(playback.completed, trace.ticks.length);
  const live = useMemo(() => summarize(trace, completed), [trace, completed]);
  const tree = useMemo(() => (tab === 'versions' ? versionTree(trace, completed) : null), [tab, trace, completed]);
  const highlight = useMemo(
    () => (tree && versionKey ? (tree.nodes.find((node) => node.key === versionKey)?.holders ?? null) : null),
    [tree, versionKey],
  );
  const altPath = useMemo(() => {
    if (!showBestPath || selected === null || selected === source || selected === checkerId) return null;
    return mostBelievablePath(campus, source, selected, settings.decay, settings.cutoff)?.path ?? null;
  }, [showBestPath, selected, source, checkerId, campus, settings.decay, settings.cutoff]);
  const dialsChanged =
    settings.decay !== DEFAULTS.settings.decay ||
    settings.distortion !== DEFAULTS.settings.distortion ||
    settings.cutoff !== DEFAULTS.settings.cutoff;

  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <a
        href="#simulator"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-40 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg"
      >
        Skip to the simulator
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-[1500px] items-center justify-between px-4 md:px-6 lg:px-8">
          <a
            href="#simulator"
            translate="no"
            className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          >
            <span className="grid size-7 place-items-center rounded-control bg-accent text-accent-ink">
              <GraphIcon size={16} weight="bold" aria-hidden />
            </span>
            Rumor Mill Tracer
          </a>
          <nav aria-label="Sections" className="flex items-center gap-1">
            <a
              href="#routes"
              className="hidden h-9 items-center rounded-control px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink sm:inline-flex"
            >
              Routes
            </a>
            <a
              href="#model"
              className="hidden h-9 items-center rounded-control px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink sm:inline-flex"
            >
              The model
            </a>
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Theme: ${THEME_LABEL[preference]}. Switch to ${THEME_LABEL[THEME_NEXT[preference]]}.`}
              title={`Theme: ${THEME_LABEL[preference]}`}
              className="ml-1 inline-flex size-9 items-center justify-center rounded-control text-ink-2 transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.94]"
            >
              {preference === 'system' ? (
                <DesktopIcon size={18} weight="bold" aria-hidden />
              ) : preference === 'dark' ? (
                <MoonIcon size={18} weight="bold" aria-hidden />
              ) : (
                <SunIcon size={18} weight="bold" aria-hidden />
              )}
            </button>
          </nav>
        </div>
      </header>

      <main>
        <section
          id="simulator"
          aria-label="Simulator"
          className="mx-auto grid max-w-[1500px] grid-cols-1 gap-x-8 gap-y-5 px-4 pb-14 pt-4 md:px-6 md:pt-6 lg:grid-cols-[372px_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-y-6 lg:px-8 lg:pt-8"
        >
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-tight md:text-[2.5rem]">
              Watch a rumor outrun the truth.
            </h1>
            <p className="mt-3 max-w-[46ch] text-pretty text-[15px] leading-relaxed text-ink-2 md:text-base">
              Start a rumor on a simulated campus, choose how it travels, and trace every retelling back to its source.
            </p>
          </div>

          <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
            <div id="stage" className="stage-frame">
              <Stage
                campus={campus}
                template={template}
                trace={trace}
                clock={clock}
                playback={playback}
                mode={mode}
                view={view}
                onViewChange={setView}
                selected={selected}
                onSelect={selectStudent}
                highlight={highlight}
                altPath={altPath}
                heat={heat?.key === heatKey ? heat.values : null}
                bridges={bridges}
                onToggleCut={toggleCut}
                onRestoreCuts={() => setCuts([])}
                onShowTrace={showTrace}
                speed={speed}
                onSpeedChange={setSpeed}
              />
            </div>
          </div>

          <div className="grid gap-5 lg:col-start-1 lg:row-start-2">
            <LiveStats summary={live} hasChecker={checkerId !== null} />
            <Intro />
          </div>

          <div id="panels" className="scroll-mt-[76px] lg:col-start-1 lg:row-start-3">
            <Tabs label="Simulator panels" tabs={TABS} value={tab} onChange={setTab} idBase="panel" />
            <div
              role="tabpanel"
              id={`panel-panel-${tab}`}
              aria-labelledby={`panel-tab-${tab}`}
              tabIndex={-1}
              className="pt-5"
            >
              {tab === 'setup' && (
                <Controls
                  campus={campus}
                  template={template}
                  settings={settings}
                  onChange={changeSettings}
                  source={source}
                  onSourceChange={startHere}
                  checker={checkerId}
                  onCheckerChange={setCheckerChoice}
                  lead={lead}
                  maxLead={MAX_LEAD}
                  onLeadChange={setLead}
                  customDraft={customDraft}
                  customValid={isUsableRumor(customDraft)}
                  onCustomChange={changeCustom}
                  maxSeed={MAX_SEED}
                  onCampusChange={goToCampus}
                  onShuffle={shuffleCampus}
                  dialsChanged={dialsChanged}
                  onResetDials={resetDials}
                  onCopyLink={copyLink}
                  linkStatus={linkStatus}
                />
              )}
              {tab === 'trace' && (
                <TracePanel
                  campus={campus}
                  template={template}
                  trace={trace}
                  completed={completed}
                  selected={selected}
                  onSelect={setSelectedChoice}
                  onStartHere={startHere}
                  decay={settings.decay}
                  cutoff={settings.cutoff}
                  showBestPath={showBestPath}
                  onShowBestPath={setShowBestPath}
                  mode={mode}
                />
              )}
              {tab === 'versions' && tree && (
                <VersionsPanel
                  campus={campus}
                  template={template}
                  trace={trace}
                  tree={tree}
                  selectedKey={versionKey}
                  onSelect={setVersionKey}
                  mode={mode}
                  corrected={Math.max(0, live.corrected - 1)}
                />
              )}
              {tab === 'log' && (
                <LogPanel campus={campus} trace={trace} completed={completed} onSeek={(tick) => clock.seek(tick)} />
              )}
            </div>
          </div>
        </section>

        <Compare
          campus={campus}
          traces={traces}
          reruns={reruns.result}
          rerunning={reruns.pending}
          curve={curve && curve.length > 0 ? curve : null}
          decay={settings.decay}
          active={settings.algorithm}
          onWatch={watchRoute}
          mode={mode}
        />
        <Model mode={mode} />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 py-8 text-[13px] leading-relaxed text-ink-3 md:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p>Campus Rumor Mill Tracer is a simulation. Every student, friendship, and rumor on this page is made up.</p>
          <p>
            Keyboard: <kbd className="font-mono text-ink-2">Space</kbd> plays and pauses,{' '}
            <kbd className="font-mono text-ink-2">Left</kbd> and <kbd className="font-mono text-ink-2">Right</kbd> step
            one retelling. Ctrl and scroll zooms the map.
          </p>
        </div>
      </footer>
    </div>
  );
}

function LiveStats({ summary, hasChecker }: { summary: Summary; hasChecker: boolean }) {
  const stats = [
    { label: 'Believe it', value: String(summary.heard), unit: `of ${summary.students}` },
    hasChecker
      ? { label: 'Set straight', value: String(Math.max(0, summary.corrected - 1)), unit: '' }
      : { label: 'Still repeating it', value: String(summary.repeating), unit: '' },
    { label: 'Word for word', value: String(summary.verbatim), unit: '' },
    { label: 'Details bent', value: decimal(summary.bends), unit: 'avg' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4 lg:grid-cols-2">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-[13px] text-ink-3">{stat.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-medium tabular-nums tracking-tight text-ink">{stat.value}</span>
            {stat.unit && <span className="text-[13px] text-ink-3">{stat.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
