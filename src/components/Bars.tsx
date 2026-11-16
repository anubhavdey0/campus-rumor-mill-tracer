import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Bar {
  value: number;
  color: string;
  /** Full description for screen readers. */
  label: string;
  /** Lines shown in the hover tooltip. */
  tooltip: ReactNode;
}

interface BarsProps {
  /** Names the chart for screen readers. */
  label: string;
  /** One slot per column. Null leaves the column empty. */
  bars: (Bar | null)[];
  max: number;
  height: number;
  /** Text under each column. Empty strings are skipped. */
  ticks: string[];
  axisTitle: string;
  /** A short label drawn above one column, such as its count or "This run". */
  callout?: { index: number; text: string } | null;
}

/**
 * A small column chart. Every column has a hover and focus tooltip, but the
 * chart is a single Tab stop: arrow keys move between columns.
 */
export function Bars({ label, bars, max, height, ticks, axisTitle, callout = null }: BarsProps) {
  const [active, setActive] = useState<number | null>(null);
  const filled = bars.map((bar, i) => (bar && bar.value > 0 ? i : -1)).filter((i) => i >= 0);
  const home = callout && filled.includes(callout.index) ? callout.index : (filled[0] ?? -1);
  const [rover, setRover] = useState<number | null>(null);
  const focusIndex = rover !== null && filled.includes(rover) ? rover : home;
  const items = useRef<(HTMLLIElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const position = filled.indexOf(focusIndex);
    let next = position;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(filled.length - 1, position + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, position - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = filled.length - 1;
    else return;
    event.preventDefault();
    const index = filled[next];
    setRover(index);
    items.current[index]?.focus();
  };

  return (
    <div>
      <ul
        // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from unstyled lists without it.
        role="list"
        aria-label={label}
        onKeyDown={move}
        className="flex items-end gap-[2px] border-b border-line-strong"
        style={{ height }}
      >
        {bars.map((bar, i) => {
          const isFilled = bar !== null && bar.value > 0;
          const barHeight = isFilled ? Math.max(3, (bar.value / Math.max(1, max)) * 84) : 0;
          const align = i < 2 ? 'left-0' : i > bars.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
          const showCallout = callout?.index === i;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: each column is a fixed position on the axis.
              key={i}
              ref={(element) => {
                items.current[i] = element;
              }}
              tabIndex={isFilled ? (i === focusIndex ? 0 : -1) : undefined}
              aria-label={bar?.label}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((current) => (current === i ? null : current))}
              onFocus={() => {
                setActive(i);
                setRover(i);
              }}
              onBlur={() => setActive((current) => (current === i ? null : current))}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-t-[4px] focus-visible:outline-offset-0"
            >
              {showCallout && (
                // Pinned to the top of the plot, where no column reaches (columns stop at 84%),
                // so a label wider than its column never collides with a taller neighbour.
                <span
                  className={`absolute top-0 whitespace-nowrap font-mono text-[11px] leading-none tabular-nums text-ink-2 ${align}`}
                >
                  {callout.text}
                </span>
              )}
              {isFilled && (
                <span
                  className="block w-full max-w-[26px] rounded-t-[4px]"
                  style={{ height: `${barHeight}%`, background: bar.color }}
                />
              )}
              {active === i && isFilled && (
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute z-10 w-max rounded-control border border-line bg-surface px-3 py-2 text-left text-[12px] leading-relaxed shadow-[var(--shadow)] ${align}`}
                  style={{ bottom: `calc(${barHeight}% + 8px)` }}
                >
                  {bar.tooltip}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden>
        {ticks.map((tick, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: each label is a fixed position on the axis.
          <span key={i} className="min-w-0 flex-1 text-center font-mono text-[11px] tabular-nums text-ink-3">
            {tick}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[12px] text-ink-3" aria-hidden>
        {axisTitle}
      </p>
    </div>
  );
}

/** Label every column when there are few, otherwise every 2nd or 5th, so tick labels never collide. */
export function tickEvery(columns: number): number {
  if (columns > 30) return 5;
  if (columns > 14) return 2;
  return 1;
}
