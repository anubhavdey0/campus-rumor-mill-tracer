import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { TippingPoint } from '../sim/rerun';
import { ALGORITHMS, ROUTE_NAMES, type Algorithm } from '../sim/spread';
import { ROUTE_COLORS, type Mode } from '../theme';
import { percent } from '../format';

interface TippingChartProps {
  curve: TippingPoint[] | null;
  /** The current dial setting, marked on the chart. */
  decay: number;
  students: number;
  mode: Mode;
}

const HEIGHT = 260;
const MARGIN = { top: 16, right: 116, bottom: 34, left: 40 };
const DASH: Record<Algorithm, string | undefined> = { bfs: undefined, dfs: '6 4', best: '2 4' };

/** Where reach collapses: the first dial setting at which each route reaches fewer than half the campus. */
export function tippingPoints(curve: TippingPoint[], students: number): Record<Algorithm, number | null> {
  const half = students / 2;
  return Object.fromEntries(
    ALGORITHMS.map((algorithm) => [algorithm, curve.find((point) => point.reach[algorithm] < half)?.decay ?? null]),
  ) as Record<Algorithm, number | null>;
}

/**
 * Reach against trust lost per hop, one line per route. Reach does not depend
 * on the dice, so each point is one exact run, not an average.
 */
export function TippingChart({ curve, decay, students, mode }: TippingChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(wrapRef.current!);
    return () => observer.disconnect();
  }, []);

  const colors = ROUTE_COLORS[mode];
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxDecay = curve ? curve[curve.length - 1].decay : 0.4;
  const x = (value: number) => MARGIN.left + (value / maxDecay) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / Math.max(1, students)) * plotHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((share) => Math.round(share * students));
  const xTicks = [0, 0.1, 0.2, 0.3, 0.4];

  // Direct labels at the right end, nudged apart so they never overlap.
  const labels = curve
    ? ALGORITHMS.map((algorithm) => ({ algorithm, y: y(curve[curve.length - 1].reach[algorithm]) }))
        .sort((a, b) => a.y - b.y)
        .reduce<{ algorithm: Algorithm; y: number }[]>((placed, label) => {
          const previous = placed[placed.length - 1];
          placed.push({ ...label, y: previous ? Math.max(label.y, previous.y + 15) : label.y });
          return placed;
        }, [])
    : [];

  const indexAt = (clientX: number) => {
    if (!curve || !wrapRef.current) return null;
    const left = wrapRef.current.getBoundingClientRect().left;
    const value = ((clientX - left - MARGIN.left) / plotWidth) * maxDecay;
    return Math.max(0, Math.min(curve.length - 1, Math.round((value / maxDecay) * (curve.length - 1))));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!curve) return;
    const current = active ?? Math.round((decay / maxDecay) * (curve.length - 1));
    let next = current;
    if (event.key === 'ArrowRight') next = Math.min(curve.length - 1, current + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = curve.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
  };

  const point = curve && active !== null ? curve[active] : null;
  const tips = curve ? tippingPoints(curve, students) : null;

  return (
    <figure>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-3" aria-hidden>
        {ALGORITHMS.map((algorithm) => (
          <span key={algorithm} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="21"
                y2="4"
                stroke={colors[algorithm]}
                strokeWidth="2"
                strokeDasharray={DASH[algorithm]}
                strokeLinecap="round"
              />
            </svg>
            {ROUTE_NAMES[algorithm].name}
          </span>
        ))}
      </div>

      <div ref={wrapRef} className="relative mt-3" style={{ height: HEIGHT }}>
        {!curve ? (
          <div className="flex h-full items-end gap-[2px] border-b border-line-strong pb-px" aria-hidden>
            <p className="m-auto text-[13px] text-ink-3">Sweeping the dial from 0% to 40%…</p>
          </div>
        ) : (
          width > 0 && (
            // Arrow keys move a reading line across the dial, so the chart behaves like a slider.
            <div
              tabIndex={0}
              role="slider"
              aria-label="Students reached as trust lost per hop rises. Use the arrow keys to read each point."
              aria-valuemin={0}
              aria-valuemax={Math.round(maxDecay * 100)}
              aria-valuenow={Math.round(
                (point ?? curve[Math.round((decay / maxDecay) * (curve.length - 1))]).decay * 100,
              )}
              aria-valuetext={(() => {
                const at = point ?? curve[Math.round((decay / maxDecay) * (curve.length - 1))];
                return `${percent(at.decay)} trust lost per hop: ${ALGORITHMS.map(
                  (algorithm) => `${ROUTE_NAMES[algorithm].name} ${at.reach[algorithm]} of ${students}`,
                ).join(', ')}`;
              })()}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
              onPointerMove={(event: PointerEvent<HTMLDivElement>) => setActive(indexAt(event.clientX))}
              onPointerLeave={() => setActive(null)}
              className="rounded-[4px]"
            >
              <svg width={width} height={HEIGHT} aria-hidden="true" className="overflow-visible">
                {yTicks.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={MARGIN.left}
                      x2={MARGIN.left + plotWidth}
                      y1={y(tick)}
                      y2={y(tick)}
                      stroke="var(--line)"
                      strokeWidth={tick === 0 ? 1.25 : 1}
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={y(tick)}
                      dy="0.32em"
                      textAnchor="end"
                      className="fill-ink-3 font-mono text-[11px]"
                    >
                      {tick}
                    </text>
                  </g>
                ))}
                {xTicks.map((tick) => (
                  <text
                    key={tick}
                    x={x(tick)}
                    y={HEIGHT - MARGIN.bottom + 18}
                    textAnchor="middle"
                    className="fill-ink-3 font-mono text-[11px]"
                  >
                    {percent(tick)}
                  </text>
                ))}
                <text
                  x={MARGIN.left + plotWidth / 2}
                  y={HEIGHT - 2}
                  textAnchor="middle"
                  className="fill-ink-3 text-[12px]"
                >
                  Trust lost per hop
                </text>

                {/* Where the dial is set now. */}
                <line
                  x1={x(decay)}
                  x2={x(decay)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                  stroke="var(--ink-3)"
                  strokeDasharray="3 4"
                />
                <text
                  x={x(decay) + (decay > maxDecay * 0.85 ? -5 : 5)}
                  y={MARGIN.top + plotHeight - 6}
                  textAnchor={decay > maxDecay * 0.85 ? 'end' : 'start'}
                  className="fill-ink-2 font-mono text-[11px]"
                  style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3 }}
                >
                  Now {percent(decay)}
                </text>

                {ALGORITHMS.map((algorithm) => (
                  <path
                    key={algorithm}
                    d={curve
                      .map(
                        (p, i) => `${i === 0 ? 'M' : 'L'}${x(p.decay).toFixed(1)},${y(p.reach[algorithm]).toFixed(1)}`,
                      )
                      .join('')}
                    fill="none"
                    stroke={colors[algorithm]}
                    strokeWidth={2}
                    strokeDasharray={DASH[algorithm]}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}

                {labels.map((label) => (
                  <text
                    key={label.algorithm}
                    x={MARGIN.left + plotWidth + 8}
                    y={label.y}
                    dy="0.32em"
                    className="fill-ink-2 text-[12px] font-medium"
                  >
                    {ROUTE_NAMES[label.algorithm].name}
                  </text>
                ))}

                {point && (
                  <g>
                    <line
                      x1={x(point.decay)}
                      x2={x(point.decay)}
                      y1={MARGIN.top}
                      y2={MARGIN.top + plotHeight}
                      stroke="var(--ink)"
                      strokeWidth={1}
                    />
                    {ALGORITHMS.map((algorithm) => (
                      <circle
                        key={algorithm}
                        cx={x(point.decay)}
                        cy={y(point.reach[algorithm])}
                        r={4}
                        fill={colors[algorithm]}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
              </svg>
            </div>
          )
        )}

        {point && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-2 z-10 w-max rounded-control border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed shadow-[var(--shadow)]"
            style={x(point.decay) > width / 2 ? { right: width - x(point.decay) + 12 } : { left: x(point.decay) + 12 }}
          >
            <p className="font-semibold text-ink">{percent(point.decay)} trust lost per hop</p>
            {ALGORITHMS.map((algorithm) => (
              <p key={algorithm} className="flex items-center gap-2 text-ink-2">
                <span className="inline-block size-2 rounded-full" style={{ background: colors[algorithm] }} />
                {ROUTE_NAMES[algorithm].name}: {point.reach[algorithm]} of {students}
              </p>
            ))}
          </div>
        )}
      </div>

      {curve && tips && (
        <figcaption className="mt-3 max-w-[70ch] text-[13px] leading-snug text-ink-3">
          {ALGORITHMS.map((algorithm) => {
            const tip = tips[algorithm];
            const name = ROUTE_NAMES[algorithm].name;
            return tip === null
              ? `${name} still reaches at least half the campus at 40%. `
              : `${name} drops below half the campus at ${percent(tip)}. `;
          })}
          Each point is one exact run: reach does not depend on the dice.
        </figcaption>
      )}

      {curve && (
        <details className="mt-3 text-[13px] text-ink-2">
          <summary className="cursor-pointer font-medium text-ink-2 hover:text-ink">Show as a table</summary>
          <div className="scroll-thin mt-2 max-h-64 overflow-auto rounded-control border border-line">
            <table className="w-full text-left font-mono text-[12px] tabular-nums">
              <thead className="sticky top-0 bg-surface-2 font-sans">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Trust lost</th>
                  {ALGORITHMS.map((algorithm) => (
                    <th key={algorithm} className="px-3 py-1.5 font-semibold">
                      {ROUTE_NAMES[algorithm].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curve
                  .filter((_, i) => i % 2 === 0)
                  .map((row) => (
                    <tr key={row.decay} className="border-t border-line">
                      <td className="px-3 py-1">{percent(row.decay)}</td>
                      {ALGORITHMS.map((algorithm) => (
                        <td key={algorithm} className="px-3 py-1">
                          {row.reach[algorithm]}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
