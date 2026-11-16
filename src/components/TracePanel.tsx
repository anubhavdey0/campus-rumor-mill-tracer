import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { FlagIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import { TRAITS, type Campus } from '../sim/campus';
import { mostBelievablePath } from '../sim/network';
import type { RumorTemplate } from '../sim/rumor';
import { chainTo, type Hearing, type Trace } from '../sim/spread';
import { bendColor, TRUTH_COLOR, type Mode } from '../theme';
import { percent, plural } from '../format';
import { RumorText } from './RumorText';

interface TracePanelProps {
  campus: Campus;
  template: RumorTemplate;
  trace: Trace;
  completed: number;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onStartHere: (id: number) => void;
  decay: number;
  cutoff: number;
  /** Whether the most believable route is drawn on the map. */
  showBestPath: boolean;
  onShowBestPath: (show: boolean) => void;
  mode: Mode;
}

/** Follows one student's version of the rumor back to the source, one retelling at a time. */
export function TracePanel(props: TracePanelProps) {
  const { campus, template, trace, completed, selected, onSelect, onStartHere, decay, cutoff, mode } = props;
  const finished = completed >= trace.ticks.length;
  const student = selected === null ? null : campus.students[selected];
  const hearing = selected === null ? null : trace.hearings[selected];
  const heard = hearing !== null && hearing.tick < completed;
  const chain = selected !== null && heard ? chainTo(trace, selected) : [];
  const starter = selected === trace.source || selected === trace.checker;

  return (
    <div className="grid gap-5">
      <StudentSearch campus={campus} selected={selected} onSelect={onSelect} />

      {!student ? (
        <p className="text-sm leading-relaxed text-ink-3">
          Find a student by name, or click one on the map, to follow their version of the rumor back to the source, one
          retelling at a time.
        </p>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">{student.name}</h2>
            <p className="text-[13px] text-ink-3">
              {campus.groups[student.group].name}. {TRAITS[student.trait].label}: {TRAITS[student.trait].effect}
            </p>
          </div>

          {heard ? (
            <>
              <div className="rounded-control bg-surface-2 px-3.5 py-3">
                <p className="text-[13px] font-medium text-ink-3">
                  {selected === trace.checker
                    ? 'What the fact-checker knows'
                    : hearing.truth
                      ? `What ${student.name} heard: the fact-checker's correction`
                      : hearing.from === null
                        ? 'What really happened'
                        : `What ${student.name} heard, ${plural(hearing.bends, 'detail')} bent`}
                </p>
                <p className="mt-1 text-pretty break-words text-[15px] font-medium leading-snug text-ink">
                  <RumorText template={template} version={hearing.version} />
                </p>
              </div>

              <ol className="grid">
                {chain.map((link, i) => (
                  <ChainLink
                    key={link.student}
                    campus={campus}
                    template={template}
                    link={link}
                    last={i === chain.length - 1}
                    mode={mode}
                  />
                ))}
              </ol>
            </>
          ) : (
            <p className="rounded-control bg-surface-2 px-3.5 py-3 text-sm leading-relaxed text-ink-2">
              {finished
                ? `Nothing reached ${student.name}. Everyone who could have passed it on had stopped believing it.`
                : `${student.name} has not heard anything yet. Keep playing to see whether it gets this far.`}
            </p>
          )}

          {!starter && selected !== null && (
            <BestRoute
              campus={campus}
              trace={trace}
              target={selected}
              actual={heard && !hearing.truth ? hearing : null}
              decay={decay}
              cutoff={cutoff}
              shown={props.showBestPath}
              onShow={props.onShowBestPath}
            />
          )}

          {selected === trace.source ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-3">
              <FlagIcon size={15} weight="fill" aria-hidden />
              The rumor starts here.
            </p>
          ) : selected === trace.checker ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-3">
              <FlagIcon size={15} weight="fill" aria-hidden />
              The fact-checker. The truth starts here.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onStartHere(student.id)}
              className="inline-flex h-10 items-center justify-center gap-2 justify-self-start rounded-control border border-line-strong px-3.5 text-sm font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]"
            >
              <FlagIcon size={15} weight="bold" aria-hidden />
              Start the rumor with {student.name}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Finds a student by typing their name. A native datalist keeps it light and
 * accessible: suggestions appear as you type, and an exact match selects.
 */
function StudentSearch({
  campus,
  selected,
  onSelect,
}: {
  campus: Campus;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const id = useId();
  const selectedName = selected === null ? '' : campus.students[selected].name;
  const [query, setQuery] = useState(selectedName);
  useEffect(() => setQuery(selectedName), [selectedName]);

  const byName = useMemo(
    () => new Map(campus.students.map((student) => [student.name.toLowerCase(), student.id])),
    [campus],
  );
  const unknown = query.trim() !== '' && query !== selectedName && !byName.has(query.trim().toLowerCase());

  const change = (text: string) => {
    setQuery(text);
    const match = byName.get(text.trim().toLowerCase());
    if (match !== undefined) onSelect(match);
  };

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        Student
      </label>
      <div className="relative">
        <MagnifyingGlassIcon
          size={15}
          weight="bold"
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          id={id}
          type="search"
          name="student"
          list={`${id}-names`}
          value={query}
          onChange={(event) => change(event.target.value)}
          placeholder={`Type a name, such as ${campus.students[0].name}…`}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-help`}
          className="h-10 w-full rounded-control border border-line-strong bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              onSelect(null);
            }}
            aria-label="Clear the student"
            className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <XIcon size={14} weight="bold" aria-hidden />
          </button>
        )}
        <datalist id={`${id}-names`}>
          {campus.students.map((student) => (
            <option key={student.id} value={student.name}>
              {campus.groups[student.group].name}
            </option>
          ))}
        </datalist>
      </div>
      <p id={`${id}-help`} aria-live="polite" className="text-[13px] leading-snug text-ink-3">
        {unknown
          ? `No student called “${query.trim()}” on this campus.`
          : `${campus.students.length} students on this campus.`}
      </p>
    </div>
  );
}

interface BestRouteProps {
  campus: Campus;
  trace: Trace;
  target: number;
  /** The hearing the rumor actually delivered, if it got there. */
  actual: Hearing | null;
  decay: number;
  cutoff: number;
  shown: boolean;
  onShow: (show: boolean) => void;
}

/** The most believable route the rumor could have taken (Dijkstra), next to the route it did take. */
function BestRoute({ campus, trace, target, actual, decay, cutoff, shown, onShow }: BestRouteProps) {
  const best = useMemo(
    () => mostBelievablePath(campus, trace.source, target, decay, cutoff),
    [campus, trace.source, target, decay, cutoff],
  );
  const name = (id: number) => campus.students[id].name;

  let text: ReactNode;
  if (!best) {
    text = `No route reaches ${name(target)} with enough trust left: everyone in between would stop believing it first.`;
  } else {
    const kept = best.credibility[best.credibility.length - 1];
    const route = best.path.map(name).join(', ');
    const hops = plural(best.path.length - 1, 'hop');
    text = (
      <>
        The most believable route runs {route} ({hops}) and arrives {percent(kept)} credible.{' '}
        {actual
          ? actual.credibility >= kept - 1e-9
            ? 'The rumor took a route just as believable.'
            : `The route the rumor took arrived only ${percent(actual.credibility)} credible.`
          : 'The rumor never got there by any route.'}
      </>
    );
  }

  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold text-ink">Most believable route</h3>
      <p className="text-[13px] leading-snug text-ink-2">{text}</p>
      {best && (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={shown}
            onChange={(event) => onShow(event.target.checked)}
            className="size-4 accent-[var(--ink)]"
          />
          Show it on the map as a dashed line
        </label>
      )}
    </div>
  );
}

interface ChainLinkProps {
  campus: Campus;
  template: RumorTemplate;
  link: Hearing;
  last: boolean;
  mode: Mode;
}

function ChainLink({ campus, template, link, last, mode }: ChainLinkProps) {
  const color = link.truth ? TRUTH_COLOR[mode] : bendColor(mode, link.bends);
  const name = campus.students[link.student].name;

  let detail: ReactNode;
  if (link.from === null) {
    detail = link.truth ? 'Knows the truth and starts setting people straight.' : 'Knows what really happened.';
  } else if (link.truth) {
    detail = 'Passed on the correction.';
  } else if (link.bent && link.bentSegment !== null && link.previous) {
    const variants = template.segments[link.bentSegment].variants;
    const before = variants[link.previous[link.bentSegment]].trim();
    const after = variants[link.version[link.bentSegment]].replace(/^,\s*/, '').trim();
    detail = before ? (
      <>
        <del className="rumor-del">{before}</del>
        <span className="sr-only"> became </span>
        <mark className="rumor-mark rumor-mark-new">{after}</mark>
      </>
    ) : (
      <>
        Added <mark className="rumor-mark rumor-mark-new">{after}</mark>
      </>
    );
  } else {
    detail = 'Passed on unchanged.';
  }

  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <span
          className="mt-[5px] size-3 shrink-0 rounded-full border-2"
          style={{ borderColor: color, background: link.repeats ? color : 'transparent' }}
        />
        {!last && <span className="w-px flex-1 bg-line-strong" />}
      </div>
      <div className={last ? '' : 'pb-4'}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-ink">
            {name}
            {link.from !== null && <span className="ml-2 font-normal text-ink-3">hop {link.hop}</span>}
          </p>
          <p className="font-mono text-[12px] tabular-nums text-ink-3">{percent(link.credibility)}</p>
        </div>
        <p className="text-[13px] leading-snug text-ink-2">{detail}</p>
        {!link.repeats && <p className="text-[13px] leading-snug text-ink-3">Too doubtful to repeat it.</p>}
      </div>
    </li>
  );
}
