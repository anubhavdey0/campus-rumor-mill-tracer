import type { Campus } from '../sim/campus';
import type { Tick, Trace } from '../sim/spread';
import { listNames } from '../format';

interface LogPanelProps {
  campus: Campus;
  trace: Trace;
  completed: number;
  onSeek: (tick: number) => void;
}

/** Every retelling so far as plain text, newest first. Doubles as the text alternative to the map. */
export function LogPanel({ campus, trace, completed, onSeek }: LogPanelProps) {
  const name = (id: number) => campus.students[id].name;
  const shown = trace.ticks.slice(0, completed).reverse();

  if (shown.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-3">
        Nothing has been said yet. Press Spread it, or step forward one retelling at a time.
      </p>
    );
  }

  const summarizeTick = (tick: Tick) => {
    if (tick.kind === 'backtrack') {
      return {
        text: `Dead end at ${name(tick.path[0])}. Back to ${name(tick.path[tick.path.length - 1])}.`,
        bent: 0,
        dropped: 0,
      };
    }
    const hearings = tick.listeners.map((id) => trace.hearings[id]!);
    if (tick.truth) {
      return {
        text: `${name(tick.speaker)} set ${listNames(tick.listeners.map(name))} straight.`,
        bent: 0,
        dropped: hearings.filter((hearing) => !hearing.repeats).length,
      };
    }
    return {
      text: `${name(tick.speaker)} told ${listNames(tick.listeners.map(name))}.`,
      bent: hearings.filter((hearing) => hearing.bent).length,
      dropped: hearings.filter((hearing) => !hearing.repeats).length,
    };
  };

  return (
    <div>
      <p className="mb-2 text-[13px] text-ink-3">Newest first. Select a line to jump the map back to that moment.</p>
      <ol className="scroll-thin -mx-2 max-h-[460px] overflow-y-auto">
        {shown.map((tick) => {
          const { text, bent, dropped } = summarizeTick(tick);
          const single = tick.kind === 'tell' && tick.listeners.length === 1;
          return (
            <li key={tick.index} className="[contain-intrinsic-size:auto_32px] [content-visibility:auto]">
              <button
                type="button"
                onClick={() => onSeek(tick.index + 1)}
                className="grid w-full grid-cols-[30px_minmax(0,1fr)] items-baseline gap-x-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="font-mono text-[12px] tabular-nums text-ink-3">{tick.index + 1}</span>
                <span className={`text-[13px] leading-snug ${tick.kind === 'backtrack' ? 'text-ink-3' : 'text-ink'}`}>
                  {text}
                  {bent > 0 && (
                    <span className="ml-1.5 whitespace-nowrap rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-ink">
                      {single ? 'bent' : `${bent} bent`}
                    </span>
                  )}
                  {dropped > 0 && (
                    <span className="ml-1.5 whitespace-nowrap text-[12px] text-ink-3">
                      {single ? 'will not repeat it' : `${dropped} will not repeat it`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
