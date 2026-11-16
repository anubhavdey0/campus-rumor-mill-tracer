import type { ReactNode } from 'react';
import type { Campus } from '../sim/campus';
import { originalVersion, type RumorTemplate } from '../sim/rumor';
import { summarize, type Trace } from '../sim/spread';
import type { PlaybackState } from '../playback';
import { RumorText } from './RumorText';
import { percent } from '../format';

interface CaptionProps {
  campus: Campus;
  template: RumorTemplate;
  trace: Trace;
  playback: PlaybackState;
}

/** The line under the map: who is telling whom right now, and what the rumor has become. */
export function Caption({ campus, template, trace, playback }: CaptionProps) {
  const total = trace.ticks.length;
  const completed = Math.min(playback.completed, total);
  const index = playback.moving ? completed : completed - 1;
  const tick = index >= 0 && index < total ? trace.ticks[index] : null;
  const finished = completed >= total && !playback.moving;
  const name = (id: number) => campus.students[id].name;

  let headline: ReactNode;
  let aside: ReactNode = null;
  let body: ReactNode;

  if (finished) {
    const summary = summarize(trace);
    headline = 'The rumor has run its course.';
    body = (
      <span className="text-ink-2">
        {summary.heard} of {summary.students} students believe it. {summary.verbatim} still{' '}
        {summary.verbatim === 1 ? 'has' : 'have'} it word for word.
        {trace.checker !== null && <> The fact-checker set {summary.corrected - 1} straight first.</>}
      </span>
    );
  } else if (!tick) {
    headline =
      trace.checker === null
        ? `${name(trace.source)} knows what really happened.`
        : `${name(trace.source)} starts the rumor. ${name(trace.checker)} knows the truth and will push back.`;
    body = <RumorText template={template} version={originalVersion(template)} />;
  } else if (tick.kind === 'tell' && tick.truth) {
    // The fact-checker's side: the truth never bends, so show who was reached.
    const listeners = tick.listeners.map(name);
    headline =
      listeners.length === 1
        ? `${name(tick.speaker)} sets ${listeners[0]} straight before the rumor gets there.`
        : `${name(tick.speaker)} sets ${listeners.length} friends straight before the rumor gets there.`;
    aside = `Correction, hop ${tick.hop}`;
    body = (
      <span>
        <span className="mr-2 rounded-[4px] bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-ink-2">
          The truth
        </span>
        <RumorText template={template} version={originalVersion(template)} />
      </span>
    );
  } else if (tick.kind === 'backtrack') {
    const deadEnd = tick.path[0];
    const resume = tick.path[tick.path.length - 1];
    // A chain ends either because the last student doubts the rumor or because all their friends know it.
    const reason = trace.hearings[deadEnd]?.repeats ? 'has nobody left to tell' : 'will not pass it on';
    headline = 'Dead end.';
    body = (
      <span className="text-ink-2">
        {name(deadEnd)} {reason}. The chain picks back up with {name(resume)}.
      </span>
    );
  } else if (tick.listeners.length === 1) {
    const hearing = trace.hearings[tick.listeners[0]]!;
    const notes = [
      `${name(tick.speaker)} tells ${name(hearing.student)}.`,
      hearing.bent ? 'One detail slips.' : '',
      hearing.repeats ? '' : `${name(hearing.student)} doubts it and will not pass it on.`,
    ];
    headline = notes.filter(Boolean).join(' ');
    aside = `Hop ${hearing.hop}, ${percent(hearing.credibility)} credible`;
    body = (
      <RumorText
        template={template}
        version={hearing.version}
        previous={hearing.previous}
        bentSegment={hearing.bent ? hearing.bentSegment : null}
      />
    );
  } else {
    const speaker = trace.hearings[tick.speaker]!;
    const bent = tick.listeners.filter((id) => trace.hearings[id]!.bent).length;
    const outcome = bent === 0 ? 'All hear it the same way.' : `${bent} ${bent === 1 ? 'hears' : 'hear'} it bent.`;
    headline = `${name(tick.speaker)} tells ${tick.listeners.length} friends at once. ${outcome}`;
    aside =
      trace.algorithm === 'bfs'
        ? `Wave ${tick.hop}`
        : `Hop ${tick.hop}, ${percent(speaker.credibility)} credible speaker`;
    body = <RumorText template={template} version={speaker.version} />;
  }

  return (
    <div
      className="min-h-[150px] border-t border-line px-4 py-3.5 sm:min-h-[104px] sm:px-5"
      aria-live={playback.playing ? 'off' : 'polite'}
      aria-atomic="true"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 text-[13px] font-medium text-ink-3">{headline}</p>
        {aside && <p className="shrink-0 font-mono text-[12px] tabular-nums text-ink-3">{aside}</p>}
      </div>
      <p className="mt-1.5 text-pretty break-words text-[17px] font-medium leading-snug text-ink sm:text-lg">{body}</p>
    </div>
  );
}
