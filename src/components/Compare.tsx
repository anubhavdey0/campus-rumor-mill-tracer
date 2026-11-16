import { memo, useMemo } from 'react';
import { ArrowUpIcon } from '@phosphor-icons/react';
import type { Campus } from '../sim/campus';
import { distribution, standingOf, type RerunResult, type Standing, type TippingPoint } from '../sim/rerun';
import {
  ALGORITHMS,
  hopProfile,
  ROUTE_NAMES,
  summarize,
  type Algorithm,
  type HopBucket,
  type Summary,
  type Trace,
} from '../sim/spread';
import { bendColor, type Mode } from '../theme';
import { decimal, listNames, percent, plural } from '../format';
import { Bars, tickEvery, type Bar } from './Bars';
import { RaceView } from './RaceView';
import { TippingChart } from './TippingChart';

interface CompareProps {
  campus: Campus;
  traces: Record<Algorithm, Trace>;
  reruns: RerunResult | null;
  /** True while a fresh set of reruns is being computed. */
  rerunning: boolean;
  curve: TippingPoint[] | null;
  decay: number;
  active: Algorithm;
  onWatch: (algorithm: Algorithm) => void;
  mode: Mode;
}

/** Bin widths for the rerun histogram, smallest first. */
const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];

/** The payoff: the same rumor on the same campus, run to the end every way. */
export const Compare = memo(function Compare(props: CompareProps) {
  const { campus, traces, reruns, rerunning, curve, decay, active, onWatch, mode } = props;
  const results = useMemo(() => {
    const summaries = Object.fromEntries(ALGORITHMS.map((a) => [a, summarize(traces[a])])) as Record<
      Algorithm,
      Summary
    >;
    const profiles = Object.fromEntries(ALGORITHMS.map((a) => [a, hopProfile(traces[a])])) as Record<
      Algorithm,
      HopBucket[]
    >;
    const maxHop = Math.max(1, ...ALGORITHMS.map((a) => profiles[a].length));
    const maxCount = Math.max(1, ...ALGORITHMS.flatMap((a) => profiles[a].map((b) => b.count)));
    return { summaries, profiles, maxHop, maxCount };
  }, [traces]);

  // Reruns arrive from the background. Ignore a result that belongs to a different campus size.
  const runs = reruns && reruns.students === results.summaries.bfs.students ? reruns : null;
  const { summaries } = results;

  // Every histogram shares one scale so the routes can be compared at a glance.
  const scale = useMemo(() => {
    if (!runs) return null;
    const top = Math.max(
      ...ALGORITHMS.map((a) => summaries[a].bends),
      ...ALGORITHMS.flatMap((a) => runs.routes[a].bends),
    );
    const step = STEPS.find((candidate) => top / candidate <= 24) ?? 2;
    return { step, bins: Math.max(1, Math.floor(top / step + 1e-9) + 1) };
  }, [runs, summaries]);

  const reach = ALGORITHMS.map(
    (a) =>
      `${ROUTE_NAMES[a].name.toLowerCase()} reaches ${summaries[a].heard} within ${plural(summaries[a].deepestHop, 'hop')}`,
  );

  return (
    <section id="routes" className="border-t border-line">
      <div className="mx-auto max-w-[1500px] px-4 py-16 md:px-6 md:py-20 lg:px-8">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">Same rumor, three routes</h2>
        <p className="mt-4 max-w-[64ch] text-pretty leading-relaxed text-ink-2">
          Every run below uses the campus, the starting student, and the dice from the map above. Only the order of the
          retellings changes. Of {summaries.bfs.students} students, {listNames(reach)}.
        </p>
        {runs && <p className="mt-3 max-w-[64ch] text-pretty leading-relaxed text-ink-2">{headToHead(runs)}</p>}

        <RaceView campus={campus} traces={traces} mode={mode} />

        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-0">
          {ALGORITHMS.map((algorithm, i) => (
            <Route
              key={algorithm}
              algorithm={algorithm}
              summary={summaries[algorithm]}
              profile={results.profiles[algorithm]}
              maxHop={results.maxHop}
              maxCount={results.maxCount}
              rerunBends={runs ? runs.routes[algorithm].bends : null}
              scale={scale}
              rerunning={rerunning}
              hasChecker={traces[algorithm].checker !== null}
              mode={mode}
              showing={active === algorithm}
              onWatch={() => onWatch(algorithm)}
              className={i === 0 ? 'lg:pr-8 xl:pr-10' : 'lg:border-l lg:border-line lg:px-8 xl:px-10'}
            />
          ))}
        </div>

        <div className="mt-16 border-t border-line pt-12">
          <h3 className="text-xl font-semibold tracking-tight">Where does it tip?</h3>
          <p className="mb-6 mt-1.5 max-w-[64ch] text-[15px] leading-relaxed text-ink-2">
            How many students hear the rumor as the trust lost per hop rises, with every other dial as set above.
          </p>
          <TippingChart curve={curve} decay={decay} students={summaries.bfs.students} mode={mode} />
        </div>
      </div>
    </section>
  );
});

function headToHead(runs: RerunResult): string {
  const intro =
    'The dice only decide how the story bends. Who hears it depends on trust and friendships alone, ' +
    'so reach is the same however the dice fall.';
  if (runs.level === runs.runs) return `${intro} With these dials no route bends the story less than the others.`;
  const ranked = ALGORITHMS.map((a) => ({ a, share: runs.straightest[a] / runs.runs }))
    .filter(({ share }) => share > 0)
    .sort((x, y) => y.share - x.share)
    .map(({ a, share }) => `${ROUTE_NAMES[a].name.toLowerCase()} in ${percent(share)}`);
  let sentence = `${intro} Rerun ${runs.runs} times with different dice, the story stayed straightest on ${listNames(ranked)} of reruns`;
  if (runs.level > 0) sentence += `, with no single winner in ${percent(runs.level / runs.runs)}`;
  return `${sentence}.`;
}

interface RouteProps {
  algorithm: Algorithm;
  summary: Summary;
  profile: HopBucket[];
  maxHop: number;
  maxCount: number;
  rerunBends: number[] | null;
  scale: { step: number; bins: number } | null;
  rerunning: boolean;
  hasChecker: boolean;
  mode: Mode;
  showing: boolean;
  onWatch: () => void;
  className: string;
}

function Route(props: RouteProps) {
  const { algorithm, summary, profile, maxHop, maxCount, rerunBends, scale, rerunning, mode, showing, onWatch } = props;
  const { name, search } = ROUTE_NAMES[algorithm];
  const stats = [
    { label: 'Believe it', value: String(summary.heard), unit: `of ${summary.students}` },
    { label: 'Word for word', value: String(summary.verbatim), unit: 'students' },
    { label: 'Details bent', value: decimal(summary.bends), unit: 'on average' },
    props.hasChecker
      ? { label: 'Set straight', value: String(Math.max(0, summary.corrected - 1)), unit: 'students' }
      : { label: 'Deepest hop', value: String(summary.deepestHop), unit: '' },
  ];

  return (
    <div className={props.className}>
      {/* Every column's header has the same shape, so the charts below line up across routes. */}
      <div className="grid gap-2">
        <h3 className="text-xl font-semibold tracking-tight">{name}</h3>
        <p className="text-[15px] text-ink-3">{search}</p>
        <div className="flex h-9 items-center">
          {showing ? (
            <p className="text-[13px] font-medium text-ink-3">On the map now</p>
          ) : (
            <button
              type="button"
              onClick={onWatch}
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong px-3 text-[13px] font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]"
            >
              <ArrowUpIcon size={14} weight="bold" aria-hidden />
              Watch this route
            </button>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2">
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

      <figure className="mt-8">
        <HopChart name={name} profile={profile} maxHop={maxHop} maxCount={maxCount} mode={mode} />
        <figcaption className="mt-3 text-[13px] leading-snug text-ink-3">
          Students who first heard the rumor at each hop. Bar color uses the scale from the map: how bent the rumor was
          on arrival.
        </figcaption>
      </figure>

      <figure className="mt-10" aria-busy={rerunning}>
        <h4 className="text-[15px] font-semibold tracking-tight">Was this run typical?</h4>
        <RerunChart name={name} values={rerunBends} actual={summary.bends} scale={scale} stale={rerunning} />
      </figure>
    </div>
  );
}

interface HopChartProps {
  name: string;
  profile: HopBucket[];
  maxHop: number;
  maxCount: number;
  mode: Mode;
}

/** One column per hop. Every route shares the same axes so they can be compared directly. */
function HopChart({ name, profile, maxHop, maxCount, mode }: HopChartProps) {
  const every = tickEvery(maxHop);
  const peak = profile.reduce((best, bucket) => Math.max(best, bucket.count), 0);
  const peakIndex = profile.findIndex((bucket) => bucket.count === peak);

  const bars: (Bar | null)[] = Array.from({ length: maxHop }, (_, i) => {
    const bucket = profile[i];
    if (!bucket || bucket.count === 0) return null;
    return {
      value: bucket.count,
      color: bendColor(mode, bucket.bends),
      label: `Hop ${i + 1}: ${plural(bucket.count, 'student')}, ${decimal(bucket.bends)} details bent on average, ${percent(bucket.credibility)} credible`,
      tooltip: (
        <>
          <p className="font-semibold text-ink">Hop {i + 1}</p>
          <p className="text-ink-2">{plural(bucket.count, 'student')}</p>
          <p className="text-ink-2">{decimal(bucket.bends)} details bent on average</p>
          <p className="text-ink-2">{percent(bucket.credibility)} credible on average</p>
        </>
      ),
    };
  });

  return (
    <Bars
      label={`${name}: students reached at each hop`}
      bars={bars}
      max={maxCount}
      height={150}
      ticks={bars.map((_, i) => (labelled(i, every) ? String(i + 1) : ''))}
      axisTitle="Hops from the source"
      callout={peakIndex >= 0 ? { index: peakIndex, text: String(peak) } : null}
    />
  );
}

function labelled(index: number, every: number): boolean {
  if (every === 1) return true;
  if (every === 2) return index % 2 === 0;
  return index === 0 || index % every === 0;
}

interface RerunChartProps {
  name: string;
  values: number[] | null;
  actual: number;
  scale: { step: number; bins: number } | null;
  stale: boolean;
}

/** How bent the story ended up across all the reruns, with this run marked. */
function RerunChart({ name, values, actual, scale, stale }: RerunChartProps) {
  if (!values || !scale) {
    return (
      <div aria-hidden className="mt-3">
        <div className="flex h-[96px] items-end gap-[2px] border-b border-line-strong">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a static placeholder shape.
              key={i}
              className="block flex-1 rounded-t-[4px] bg-surface-2"
              style={{ height: `${10 + 62 * Math.exp(-((i - 8) ** 2) / 14)}%` }}
            />
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-3">Rolling the dice 200 times…</p>
      </div>
    );
  }

  const { step, bins } = scale;
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const fmt = (n: number) => n.toFixed(digits);
  const binOf = (value: number) => Math.min(bins - 1, Math.floor(value / step + 1e-9));
  const range = (bin: number) => `${fmt(bin * step)}-${fmt((bin + 1) * step)}`;

  const counts = new Array<number>(bins).fill(0);
  for (const value of values) counts[binOf(value)] += 1;
  const stats = distribution(values);
  const thisBin = binOf(actual);
  const runs = values.length;
  const every = tickEvery(bins);

  const bars: (Bar | null)[] = counts.map((count, bin) =>
    count === 0
      ? null
      : {
          value: count,
          color: bin === thisBin ? 'var(--ink)' : 'var(--line-strong)',
          label: `${range(bin)} details bent on average in ${plural(count, 'rerun')}${bin === thisBin ? ', including this run' : ''}`,
          tooltip: (
            <>
              <p className="font-semibold text-ink">{range(bin)} details bent</p>
              <p className="text-ink-2">
                {plural(count, 'rerun')} of {runs} ({percent(count / runs)})
              </p>
              {bin === thisBin && <p className="text-ink-2">This run: {decimal(actual)}</p>}
            </>
          ),
        },
  );

  const standing = standingOf(values, actual);
  const summary =
    standing === 'same'
      ? `All ${runs} reruns with different dice ended with ${decimal(stats.min)} details bent on average, so the dice made no difference here.`
      : `Across ${runs} reruns with different dice, the average student heard ${decimal(stats.median)} details bent ` +
        `(the middle half of reruns: ${decimal(stats.lowerQuartile)} to ${decimal(stats.upperQuartile)}). ` +
        `This run: ${decimal(actual)}. ${STANDING_TEXT[standing]}`;

  return (
    <div className={`mt-3 transition-opacity ${stale ? 'opacity-50' : ''}`}>
      <Bars
        label={`${name}: average details bent across ${runs} reruns`}
        bars={bars}
        max={Math.max(...counts)}
        height={96}
        ticks={counts.map((_, bin) => (labelled(bin, every) ? fmt(bin * step) : ''))}
        axisTitle="Details bent per student, on average"
        callout={counts[thisBin] > 0 ? { index: thisBin, text: 'This run' } : null}
      />
      <p className="mt-3 max-w-[60ch] text-[13px] leading-snug text-ink-3">{summary}</p>
    </div>
  );
}

const STANDING_TEXT: Record<Exclude<Standing, 'same'>, string> = {
  high: 'The dice were rough on the story this time: most reruns bent it less.',
  low: 'The story got off lightly this time: most reruns bent it more.',
  typical: 'That is about typical for this campus and these dials.',
};
