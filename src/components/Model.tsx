import { Fragment, memo } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { PRESETS } from '../sim/rumor';
import { BEND_RAMP, type Mode } from '../theme';

const RULES = [
  {
    title: 'First version sticks',
    body: 'Once a student has heard the rumor, later versions bounce off. In graph terms this is the visited set, and it is why each student appears in the spread exactly once.',
  },
  {
    title: 'Every hop costs trust',
    body: 'Each retelling keeps only part of its credibility. Close friends lose less, loose acquaintances lose more, and skeptics discount whatever arrives.',
  },
  {
    title: 'Retellings bend the story',
    body: 'With some probability, one detail slips one step up its ladder toward the dramatic. Embellishers slip twice as often. Sticklers never do.',
  },
  {
    title: 'Weak rumors stop',
    body: 'Below the cutoff a student still hears the rumor but keeps it to themselves. Every route treats that student as a dead end.',
  },
];

const RETELL = `retell(speaker, friend):
  kept = 1 - decay * (1.5 - closeness)
  credibility = speaker.credibility * kept
  if friend is a skeptic:
    credibility = credibility * 0.7

  chance = distortion
  if speaker is an embellisher: chance = chance * 2
  if speaker is a stickler:     chance = 0

  version = speaker.version
  if roll(speaker, friend) < chance:
    version = bend one detail of version

  friend.repeats = credibility >= cutoff`;

const BROADCAST = `queue = [source]
while queue is not empty:
  speaker = queue.removeFirst()
  if not speaker.repeats: continue

  for friend in speaker.friends:   # closest first
    if friend has heard it: continue
    retell(speaker, friend)
    queue.addLast(friend)`;

const WHISPER = `stack = [source]
while stack is not empty:
  speaker = stack.top()
  friend = closest friend of speaker
           who has not heard it

  if friend exists and speaker.repeats:
    retell(speaker, friend)
    stack.push(friend)             # keep going deeper
  else:
    stack.pop()                    # dead end, back up`;

const TRUSTED = `waiting = [source]
while waiting is not empty:
  speaker = most credible in waiting
  waiting.remove(speaker)
  if not speaker.repeats: continue

  for friend in speaker.friends:
    if friend has heard it: continue
    retell(speaker, friend)
    waiting.add(friend)`;

const EXTRAS = [
  {
    title: 'The fact-checker',
    body: 'Pick a fact-checker and the truth spreads too, by the same route and the same rules, except it never bends. It starts after the rumor’s head start. Whoever reaches a student first wins them over, because the first version sticks.',
  },
  {
    title: 'Bridges and cuts',
    body: 'The network view finds bridges with Tarjan’s algorithm: friendships that are the only link to part of the campus. Cut one and everyone beyond it is out of reach, on every route.',
  },
  {
    title: 'The most believable route',
    body: 'For any student, the Trace tab runs Dijkstra’s algorithm on the product of trust kept per hop, to find the route that would have kept the rumor most credible, and compares it with the route it really took.',
  },
];

/** Pseudocode. Browsers make the scrolling block keyboard-focusable on their own. */
function Code({ label, children }: { label: string; children: string }) {
  return (
    <pre
      translate="no"
      title={label}
      className="scroll-thin overflow-x-auto rounded-control bg-surface-2 px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] text-ink-2"
    >
      <code>{children}</code>
    </pre>
  );
}

/** Static explainer. Memoised so playback never re-renders it. */
export const Model = memo(function Model({ mode }: { mode: Mode }) {
  const ladder = PRESETS[0].segments[2].variants;
  const ramp = BEND_RAMP[mode];

  return (
    <section id="model" className="border-t border-line">
      <div className="mx-auto max-w-[1500px] px-4 py-16 md:px-6 md:py-20 lg:px-8">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">The rules of the mill</h2>
        <p className="mt-4 max-w-[62ch] text-pretty leading-relaxed text-ink-2">
          Nothing here is real data. The campus is generated from a seed, and four rules decide what happens to the
          rumor each time it changes hands.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-12">
          <dl className="grid grid-cols-1 content-start gap-7 sm:grid-cols-2 sm:gap-x-10 lg:col-span-7">
            {RULES.map((rule) => (
              <div key={rule.title}>
                <dt className="text-lg font-semibold tracking-tight">{rule.title}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{rule.body}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-[13px] font-semibold text-ink">One detail climbing its ladder</dt>
              <dd className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
                {ladder.map((variant, i) => (
                  <Fragment key={variant}>
                    {i > 0 && <ArrowRightIcon size={13} weight="bold" className="text-ink-3" aria-hidden />}
                    <span className="inline-flex items-center gap-2 rounded-full border border-line-strong py-1 pl-2 pr-3 text-ink">
                      <span className="size-2.5 rounded-full" style={{ background: ramp[i] }} aria-hidden />
                      {variant}
                    </span>
                  </Fragment>
                ))}
              </dd>
            </div>
          </dl>

          <div className="min-w-0 lg:col-span-5">
            <h3 className="mb-2.5 text-[13px] font-semibold text-ink">One retelling</h3>
            <Code label="Pseudocode for one retelling">{RETELL}</Code>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight">Broadcast is breadth-first search</h3>
            <p className="mb-4 mt-2 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
              A queue. Everyone who heard the rumor in one wave tells all of their friends before the next wave starts.
              Paths stay as short as the graph allows, so the story arrives early and mostly intact.
            </p>
            <Code label="Pseudocode for broadcast">{BROADCAST}</Code>
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight">A whisper chain is depth-first search</h3>
            <p className="mb-4 mt-2 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
              A stack. Each student tells one friend, who tells one friend. Chains run long, so trust drains and details
              pile up before the chain doubles back to try another branch.
            </p>
            <Code label="Pseudocode for the whisper chain">{WHISPER}</Code>
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight">Trusted first is best-first search</h3>
            <p className="mb-4 mt-2 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
              A priority queue. Whoever holds the most credible version speaks next, so the most believable chains
              spread first and weak ones wait their turn.
            </p>
            <Code label="Pseudocode for trusted first">{TRUSTED}</Code>
          </div>
        </div>

        <dl className="mt-16 grid grid-cols-1 gap-x-12 gap-y-8 border-t border-line pt-12 md:grid-cols-3">
          {EXTRAS.map((extra) => (
            <div key={extra.title}>
              <dt className="text-lg font-semibold tracking-tight">{extra.title}</dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{extra.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
});
