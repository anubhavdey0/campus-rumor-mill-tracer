import { useState } from 'react';
import { XIcon } from '@phosphor-icons/react';

const STORAGE_KEY = 'rumor-mill-intro-done';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** A short first-visit guide. Once dismissed it stays away on this browser. */
export function Intro() {
  const [hidden, setHidden] = useState(wasDismissed);
  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Storage can be blocked. The tips just come back next visit.
    }
    setHidden(true);
  };

  return (
    <section aria-labelledby="intro-title" className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="intro-title" className="text-[15px] font-semibold tracking-tight text-ink">
          New here? Four things to try
        </h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the tips"
          className="-mr-1.5 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <XIcon size={15} weight="bold" aria-hidden />
        </button>
      </div>
      <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[14px] leading-snug text-ink-2 marker:font-mono marker:text-ink-3">
        <li>
          Press <span className="font-semibold text-ink">Spread it</span> and watch the queue under the map.
        </li>
        <li>Click any student to trace their version back to the source.</li>
        <li>
          Switch to <span className="font-semibold text-ink">Whisper chain</span>, then scroll down and race all three
          routes.
        </li>
        <li>
          Open the <span className="font-semibold text-ink">Network</span> view to find the best spreaders and cut
          friendships.
        </li>
      </ol>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 inline-flex h-8 items-center rounded-control border border-line-strong px-3 text-[13px] font-semibold text-ink transition-[border-color,transform] hover:border-ink-3 active:scale-[0.97]"
      >
        Got it
      </button>
    </section>
  );
}
