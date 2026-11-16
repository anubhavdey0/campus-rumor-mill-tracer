import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';

const LABEL = 'text-[13px] font-semibold text-ink';
const HELPER = 'text-[13px] leading-snug text-ink-3';

/** "Starts with" -> "starts-with" */
const fieldName = (label: string) => label.toLowerCase().replace(/\s+/g, '-');

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  helper?: ReactNode;
}

export function SelectField({ label, value, onChange, children, helper }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={fieldName(label)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={helper ? `${id}-help` : undefined}
          className="h-10 w-full cursor-pointer appearance-none rounded-control border border-line-strong bg-surface pl-3 pr-9 text-sm text-ink transition-colors hover:border-ink-3"
        >
          {children}
        </select>
        <CaretDownIcon
          aria-hidden
          size={14}
          weight="bold"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
        />
      </div>
      {helper && (
        <p id={`${id}-help`} className={HELPER}>
          {helper}
        </p>
      )}
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  helper: string;
}

export function SliderField({ label, value, min, max, step, onChange, format, helper }: SliderFieldProps) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[13px] tabular-nums text-ink-2">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        name={fieldName(label)}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-describedby={`${id}-help`}
        aria-valuetext={format(value)}
        style={{ '--fill': `${fill}%` } as CSSProperties}
      />
      <p id={`${id}-help`} className={HELPER}>
        {helper}
      </p>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  helper?: string;
}

/** A two-way switch built on native radio inputs, so arrow keys and screen readers work for free. */
export function Segmented<T extends string>({ label, name, value, options, onChange, helper }: SegmentedProps<T>) {
  return (
    <fieldset className="grid gap-2">
      <legend className={`${LABEL} mb-2`}>{label}</legend>
      <div
        className="grid gap-1 rounded-control border border-line-strong bg-surface-2 p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex min-h-9 items-center justify-center rounded-[5px] px-1 text-center text-[13px] font-medium leading-tight text-ink-2 transition-colors peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink hover:text-ink sm:text-sm">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {helper && <p className={HELPER}>{helper}</p>}
    </fieldset>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  children: ReactNode;
}

export function IconButton({ label, onClick, disabled = false, shortcut, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="inline-flex size-10 items-center justify-center rounded-control text-ink-2 transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

interface TabsProps<T extends string> {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  idBase: string;
}

export function Tabs<T extends string>({ label, tabs, value, onChange, idBase }: TabsProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`${idBase}-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-5 border-b border-line">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.id}`}
            aria-selected={active}
            // Only the open panel is in the page, so only its tab can point at it.
            aria-controls={active ? `${idBase}-panel-${tab.id}` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`-mb-px h-11 border-b-2 text-sm font-semibold transition-colors ${
              active ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
