import type { ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';
import type { Campus } from '../sim/campus';
import type { RumorTemplate } from '../sim/rumor';
import type { Trace } from '../sim/spread';
import { depthOf, type VersionNode, type VersionTree } from '../sim/versions';
import { bendColor, type Mode } from '../theme';
import { listNames, plural } from '../format';
import { RumorText } from './RumorText';

interface VersionsPanelProps {
  campus: Campus;
  template: RumorTemplate;
  trace: Trace;
  tree: VersionTree;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  mode: Mode;
  /** Students the fact-checker reached first, so far. */
  corrected: number;
}

/** The rumor's family tree: every wording in circulation, and which wording it was bent from. */
export function VersionsPanel(props: VersionsPanelProps) {
  const { campus, template, trace, tree, selectedKey, onSelect, mode, corrected } = props;
  const holders = tree.nodes.reduce((sum, node) => sum + node.holders.length, 0);
  const selected = tree.nodes.find((node) => node.key === selectedKey) ?? null;
  const name = (id: number) => campus.students[id].name;

  if (holders <= 1) {
    return (
      <p className="text-sm leading-relaxed text-ink-3">
        Only {name(trace.source)} knows the rumor so far. Every new wording shows up here, branching from the one it was
        bent from, as soon as someone retells it.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-[13px] leading-snug text-ink-3">
        {plural(tree.nodes.length, 'version')} of the rumor among {plural(holders, 'student')}. Each line shows the one
        detail that changed from the version above it. Select a version to light up who holds it.
        {corrected > 0 && ` ${plural(corrected, 'student')} heard the fact-checker first and are not counted here.`}
      </p>

      {selected && (
        <div className="rounded-control bg-surface-2 px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium text-ink-3">
              {selected.parent === null ? 'The original' : `${plural(selected.bends, 'detail')} bent`}, held by{' '}
              {plural(selected.holders.length, 'student')}
            </p>
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-label="Clear the selected version"
              className="-mr-1.5 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-surface hover:text-ink"
            >
              <XIcon size={14} weight="bold" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-pretty break-words text-[15px] font-medium leading-snug text-ink">
            <RumorText template={template} version={selected.version} />
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-2">
            {selected.holders.length > 0
              ? listNames(selected.holders.map(name), 6)
              : 'Nobody holds exactly this version any more.'}
          </p>
        </div>
      )}

      {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from unstyled lists without it. */}
      <ul role="list" className="scroll-thin -mx-2 max-h-[480px] overflow-y-auto">
        {tree.nodes.map((node) => (
          <VersionRow
            key={node.key}
            node={node}
            template={template}
            campus={campus}
            selected={node.key === selectedKey}
            onSelect={() => onSelect(node.key === selectedKey ? null : node.key)}
            mode={mode}
          />
        ))}
      </ul>
    </div>
  );
}

interface VersionRowProps {
  node: VersionNode;
  template: RumorTemplate;
  campus: Campus;
  selected: boolean;
  onSelect: () => void;
  mode: Mode;
}

function VersionRow({ node, template, campus, selected, onSelect, mode }: VersionRowProps) {
  const depth = depthOf(node);
  const indent = Math.min(depth, 8) * 14;
  const count = node.holders.length;

  let change: ReactNode;
  let detail: string;
  if (node.parent === null || node.changedSegment === null) {
    change = <span className="text-ink">What really happened</span>;
    detail = `Started by ${campus.students[node.originator].name}`;
  } else {
    const variants = template.segments[node.changedSegment].variants;
    const before = variants[node.parent.version[node.changedSegment]].trim();
    const after = variants[node.version[node.changedSegment]].replace(/^,\s*/, '').trim();
    change = before ? (
      <>
        <del className="rumor-del">{before}</del>
        <span className="sr-only"> became </span>
        <mark className="rumor-mark">{after}</mark>
      </>
    ) : (
      <>
        <span className="text-ink-3">Added </span>
        <mark className="rumor-mark">{after}</mark>
      </>
    );
    detail = `First told this way to ${campus.students[node.originator].name}`;
  }

  return (
    <li className="relative">
      {depth > 0 && (
        <span aria-hidden className="absolute bottom-0 top-0 border-l border-line" style={{ left: 8 + indent - 8 }} />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`grid w-full grid-cols-[12px_28px_minmax(0,1fr)] items-baseline gap-x-2 rounded-control py-1.5 pr-2 text-left transition-colors ${
          selected ? 'bg-accent-soft' : 'hover:bg-surface-2'
        }`}
        style={{ paddingLeft: 8 + indent }}
      >
        <span
          aria-hidden
          className="size-2.5 translate-y-[1px] self-center rounded-full"
          style={{ background: bendColor(mode, node.bends) }}
        />
        <span className="font-mono text-[12px] tabular-nums text-ink-2" title={plural(count, 'student')}>
          {count}
          <span className="sr-only"> {count === 1 ? 'student holds' : 'students hold'} this version.</span>
        </span>
        <span className="min-w-0 text-[13px] leading-snug">
          <span className="break-words">{change}</span>
          <span className="block text-[12px] text-ink-3">{detail}</span>
        </span>
      </button>
    </li>
  );
}
