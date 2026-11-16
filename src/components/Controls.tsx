import { useEffect, useId, useState } from 'react';
import { ArrowCounterClockwiseIcon, CheckIcon, LinkIcon, ShuffleIcon } from '@phosphor-icons/react';
import { MAX_STUDENTS, MIN_STUDENTS, type Campus } from '../sim/campus';
import { CUSTOM_MAX_LENGTH, PRESETS, originalVersion, renderVersion, type RumorTemplate } from '../sim/rumor';
import { ROUTE_NAMES, type Algorithm } from '../sim/spread';
import { percent, plural } from '../format';
import { Segmented, SelectField, SliderField } from './ui';

export interface Settings {
  rumorId: string;
  algorithm: Algorithm;
  decay: number;
  distortion: number;
  cutoff: number;
  size: number;
}

export type LinkStatus = 'idle' | 'copied' | 'failed';

const LINK_LABEL: Record<LinkStatus, string> = {
  idle: 'Copy link',
  copied: 'Link copied',
  failed: 'Copy blocked',
};

interface ControlsProps {
  campus: Campus;
  template: RumorTemplate;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  source: number;
  onSourceChange: (id: number) => void;
  checker: number | null;
  onCheckerChange: (id: number | null) => void;
  lead: number;
  maxLead: number;
  onLeadChange: (lead: number) => void;
  customDraft: string;
  customValid: boolean;
  onCustomChange: (text: string) => void;
  maxSeed: number;
  onCampusChange: (seed: number) => void;
  onShuffle: () => void;
  dialsChanged: boolean;
  onResetDials: () => void;
  onCopyLink: () => void;
  linkStatus: LinkStatus;
}

const SECONDARY_BUTTON =
  'inline-flex h-9 items-center gap-2 rounded-control border border-line-strong px-3 text-[13px] font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]';

const ALGORITHM_HELP: Record<Algorithm, string> = {
  bfs: 'Breadth-first search. Everyone who hears it tells all of their friends before the next wave starts.',
  dfs: 'Depth-first search. Each student tells their closest friend who has not heard it, and so on down the chain.',
  best: 'Best-first search. Whoever holds the most credible version speaks next and tells all of their friends.',
};

export function StudentOptions({ campus, exclude = null }: { campus: Campus; exclude?: number | null }) {
  return (
    <>
      {campus.groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.members
            .filter((id) => id !== exclude)
            .map((id) => (
              <option key={id} value={id}>
                {campus.students[id].name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export function Controls(props: ControlsProps) {
  const { campus, template, settings, onChange, source, onSourceChange, customDraft, customValid } = props;
  const customId = useId();
  const isCustom = settings.rumorId === 'custom';
  const leadUnit = settings.algorithm === 'bfs' ? 'wave' : 'retelling';

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <SelectField label="Rumor" value={settings.rumorId} onChange={(rumorId) => onChange({ rumorId })}>
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title}
            </option>
          ))}
          <option value="custom">Write your own</option>
        </SelectField>

        {isCustom ? (
          <div className="grid gap-2">
            <label htmlFor={customId} className="text-[13px] font-semibold text-ink">
              What really happened
            </label>
            <textarea
              id={customId}
              name="rumor-text"
              autoComplete="off"
              value={customDraft}
              onChange={(event) => props.onCustomChange(event.target.value)}
              maxLength={CUSTOM_MAX_LENGTH}
              rows={3}
              spellCheck
              aria-invalid={!customValid}
              aria-describedby={`${customId}-help`}
              className={`w-full resize-none rounded-control border bg-surface px-3 py-2 text-sm leading-relaxed text-ink transition-colors ${
                customValid ? 'border-line-strong hover:border-ink-3' : 'border-accent'
              }`}
            />
            <p id={`${customId}-help`} aria-live="polite" className="text-[13px] leading-snug text-ink-3">
              {customValid ? (
                'Hedges, quantities, days, and numbers give the mill the most to bend: might, a few, on Friday, 20.'
              ) : (
                <span className="font-medium text-accent">
                  Write a sentence of at least two words. Until then the map keeps your last rumor.
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-2">
            {renderVersion(template, originalVersion(template))}
          </p>
        )}
      </div>

      <SelectField
        label="Starts with"
        value={String(source)}
        onChange={(value) => onSourceChange(Number(value))}
        helper="The one student who knows what really happened."
      >
        <StudentOptions campus={campus} />
      </SelectField>

      <Segmented
        label="Travels by"
        name="algorithm"
        value={settings.algorithm}
        onChange={(algorithm) => onChange({ algorithm })}
        options={(['bfs', 'dfs', 'best'] as const).map((value) => ({ value, label: ROUTE_NAMES[value].name }))}
        helper={ALGORITHM_HELP[settings.algorithm]}
      />

      <div className="grid gap-4">
        <SelectField
          label="Fact-checker"
          value={props.checker === null ? '' : String(props.checker)}
          onChange={(value) => props.onCheckerChange(value === '' ? null : Number(value))}
          helper="Someone who knows the truth and spreads it the same way. Whoever reaches a student first wins them over."
        >
          <option value="">Nobody</option>
          <StudentOptions campus={campus} exclude={source} />
        </SelectField>
        {props.checker !== null && (
          <SliderField
            label="Rumor's head start"
            value={props.lead}
            min={0}
            max={props.maxLead}
            step={1}
            onChange={props.onLeadChange}
            format={(value) => plural(value, leadUnit)}
            helper="How long the rumor spreads before the fact-checker starts talking."
          />
        )}
      </div>

      <div className="grid gap-4">
        <SliderField
          label="Trust lost per hop"
          value={settings.decay}
          min={0}
          max={0.4}
          step={0.01}
          onChange={(decay) => onChange({ decay })}
          format={percent}
          helper="Credibility drained by each retelling. Close friends lose less."
        />
        <SliderField
          label="Chance a retelling bends it"
          value={settings.distortion}
          min={0}
          max={0.9}
          step={0.05}
          onChange={(distortion) => onChange({ distortion })}
          format={percent}
          helper="How often one detail slips a notch toward the dramatic."
        />
        <SliderField
          label="Stops repeating below"
          value={settings.cutoff}
          min={0.05}
          max={0.6}
          step={0.01}
          onChange={(cutoff) => onChange({ cutoff })}
          format={percent}
          helper="Under this credibility a student hears it but keeps it to themselves."
        />
        {props.dialsChanged && (
          <button type="button" onClick={props.onResetDials} className={`${SECONDARY_BUTTON} justify-self-start`}>
            <ArrowCounterClockwiseIcon size={15} weight="bold" aria-hidden />
            Reset dials
          </button>
        )}
        <SliderField
          label="Students"
          value={settings.size}
          min={MIN_STUDENTS}
          max={MAX_STUDENTS}
          step={4}
          onChange={(size) => onChange({ size })}
          format={String}
          helper="Size of the campus. Changing it draws a new set of friendships."
        />
      </div>

      <div className="grid gap-3 border-t border-line pt-4">
        <CampusNumber seed={campus.seed} max={props.maxSeed} onChange={props.onCampusChange} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={props.onShuffle} className={SECONDARY_BUTTON}>
            <ShuffleIcon size={15} weight="bold" aria-hidden />
            New campus
          </button>
          <button type="button" onClick={props.onCopyLink} className={SECONDARY_BUTTON}>
            {props.linkStatus === 'copied' ? (
              <CheckIcon size={15} weight="bold" aria-hidden />
            ) : (
              <LinkIcon size={15} weight="bold" aria-hidden />
            )}
            <span aria-live="polite">{LINK_LABEL[props.linkStatus]}</span>
          </button>
        </div>
        {props.linkStatus === 'failed' && (
          <p className="text-[13px] leading-snug text-ink-2">
            Your browser blocked the clipboard. The address bar already holds the same link, so you can copy it from
            there.
          </p>
        )}
      </div>
    </div>
  );
}

/** Type a campus number to load that exact campus. Applied on Enter or when the field loses focus. */
function CampusNumber({ seed, max, onChange }: { seed: number; max: number; onChange: (seed: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(String(seed));
  useEffect(() => setDraft(String(seed)), [seed]);

  const value = Number(draft);
  const valid = /^\d+$/.test(draft) && value >= 1 && value <= max;
  const apply = () => {
    if (valid && value !== seed) onChange(value);
    else if (!valid) setDraft(String(seed));
  };

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        Campus number
      </label>
      <input
        id={id}
        name="campus"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
          if (event.key === 'Escape') setDraft(String(seed));
        }}
        aria-invalid={!valid}
        aria-describedby={`${id}-help`}
        className={`h-10 w-36 rounded-control border bg-surface px-3 font-mono text-sm tabular-nums text-ink transition-colors ${
          valid ? 'border-line-strong hover:border-ink-3' : 'border-accent'
        }`}
      />
      <p id={`${id}-help`} className="text-[13px] leading-snug text-ink-3">
        {valid
          ? 'Every number from 1 to 999999 is its own campus. Press Enter to load it. The link reopens this exact setup.'
          : 'Use a whole number from 1 to 999999.'}
      </p>
    </div>
  );
}
