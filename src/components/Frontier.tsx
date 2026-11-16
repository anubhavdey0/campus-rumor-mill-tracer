import type { Campus } from '../sim/campus';
import type { Trace } from '../sim/spread';
import type { PlaybackState } from '../playback';
import { TRUTH_COLOR, type Mode } from '../theme';

interface FrontierProps {
  campus: Campus;
  trace: Trace;
  playback: PlaybackState;
  mode: Mode;
  /** Points at a student on the map while the pointer rests on their name. */
  onPeek: (id: number | null) => void;
}

const SHOWN = 14;

const STRUCTURE = {
  bfs: { name: 'Queue', order: 'next to speak first', start: 'queue = [source]', done: 'while queue is not empty' },
  dfs: { name: 'Stack', order: 'top first', start: 'stack = [source]', done: 'while stack is not empty' },
  best: {
    name: 'Priority queue',
    order: 'most credible first',
    start: 'waiting = [source]',
    done: 'while waiting is not empty',
  },
} as const;

/**
 * The data structure doing the work, live. Broadcast keeps a queue (whoever
 * heard it first speaks first). The whisper chain keeps a stack (whoever heard
 * it last speaks next). Trusted first keeps a priority queue (whoever holds the
 * most credible version speaks next).
 */
export function Frontier({ campus, trace, playback, mode, onPeek }: FrontierProps) {
  const total = trace.ticks.length;
  const completed = Math.min(playback.completed, total);
  const index = playback.moving ? completed : completed - 1;
  const finished = completed >= total && !playback.moving;
  const tick = index >= 0 && index < total ? trace.ticks[index] : null;
  const structure = STRUCTURE[trace.algorithm];

  let members: number[];
  let code: string;
  if (finished) {
    members = [];
    code = structure.done;
  } else if (!tick) {
    members = [trace.source];
    if (trace.checker !== null && trace.algorithm !== 'dfs') members.push(trace.checker);
    code = structure.start;
  } else if (tick.kind === 'tell') {
    members = tick.frontier;
    code =
      trace.algorithm === 'dfs'
        ? 'stack.push(friend)'
        : trace.algorithm === 'bfs'
          ? `queue.addLast(friend) × ${tick.listeners.length}`
          : `waiting.add(friend) × ${tick.listeners.length}`;
  } else {
    members = tick.frontier;
    code = `stack.pop() × ${tick.path.length - 1}`;
  }

  // A stack reads top first: the top is who speaks next.
  const ordered = trace.algorithm === 'dfs' ? members.slice().reverse() : members;
  const count = ordered.length;
  const status = finished ? 'empty' : trace.algorithm === 'dfs' ? `${count} deep` : `${count} waiting`;
  // With a fact-checker the whisper chain runs two stacks that take turns.
  const side =
    trace.checker !== null && trace.algorithm === 'dfs' && tick ? (tick.truth ? ' (truth)' : ' (rumor)') : '';

  return (
    <div className="flex min-h-[44px] items-center gap-3 border-t border-line px-4 py-2 sm:px-5">
      <p className="shrink-0 text-[12px]">
        <span className="font-semibold text-ink">
          {structure.name}
          {side}
        </span>{' '}
        <span className="font-mono tabular-nums text-ink-3">{status}</span>
        {count > 0 && <span className="sr-only">, {structure.order}:</span>}
      </p>
      <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,black_82%,transparent)]">
        {finished ? (
          <p className="truncate text-[12px] text-ink-3">Nobody is left to pass anything on.</p>
        ) : (
          <ol className="flex gap-1.5 whitespace-nowrap" aria-label={structure.name}>
            {ordered.slice(0, SHOWN).map((id, position) => {
              const hearing = trace.hearings[id];
              const skipped = hearing !== null && !hearing.repeats;
              const truth = hearing?.truth ?? false;
              const next = position === 0;
              return (
                <li
                  key={id}
                  onMouseEnter={() => onPeek(id)}
                  onMouseLeave={() => onPeek(null)}
                  title={
                    skipped
                      ? 'Too doubtful to repeat it, so they will be skipped'
                      : truth
                        ? 'Carries the correction'
                        : undefined
                  }
                  className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[12px] ${
                    skipped
                      ? 'border-dashed border-line-strong text-ink-3'
                      : next
                        ? 'border-ink font-semibold text-ink'
                        : 'border-line-strong text-ink-2'
                  }`}
                  style={truth && !skipped ? { borderColor: TRUTH_COLOR[mode] } : undefined}
                >
                  {campus.students[id].name}
                  {truth && <span className="sr-only"> (carries the correction)</span>}
                  {skipped && <span className="sr-only"> (will be skipped)</span>}
                </li>
              );
            })}
            {count > SHOWN && (
              <li className="inline-flex h-6 shrink-0 items-center px-1 text-[12px] text-ink-3">
                +{count - SHOWN} more
              </li>
            )}
          </ol>
        )}
      </div>
      <code translate="no" className="hidden shrink-0 font-mono text-[12px] text-ink-3 md:block">
        {code}
      </code>
    </div>
  );
}
