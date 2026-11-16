import { partsOf, type RumorTemplate, type Version } from '../sim/rumor';

interface RumorTextProps {
  template: RumorTemplate;
  version: Version;
  /** The teller's version. With `bentSegment`, shows exactly what just changed. */
  previous?: Version | null;
  bentSegment?: number | null;
}

/** Renders one version of the rumor, highlighting every detail that no longer matches the truth. */
export function RumorText({ template, version, previous = null, bentSegment = null }: RumorTextProps) {
  return (
    <>
      {partsOf(template, version).map((part) => {
        if (!part.changed) return <span key={part.segment}>{part.text}</span>;

        const fresh = previous !== null && part.segment === bentSegment;
        const before = fresh ? template.segments[part.segment].variants[previous[part.segment]] : '';
        const origin = part.original.trim() === '' ? 'Added along the way' : `Originally: ${part.original}`;
        return (
          <span key={part.segment}>
            {before.trim() !== '' && <del className="rumor-del">{before}</del>}
            <mark className={fresh ? 'rumor-mark rumor-mark-new' : 'rumor-mark'} title={origin}>
              {part.text}
            </mark>
          </span>
        );
      })}
    </>
  );
}
