import { Panel } from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

/**
 * Deliberately an architecture note, not a fake integration. The prototype
 * does not pretend to talk to SAP; this page states exactly where a real
 * connector would attach.
 */
const STAGES = [
  {
    title: 'Source Systems',
    items: ['SAP MM / S4HANA', 'Oracle EBS', 'Tally / legacy ERP', 'CSV & Excel extracts'],
    note: 'Prototype reads the synthetic CSV extract. Production would add read-only connectors.',
    state: 'prototype: CSV',
  },
  {
    title: 'Ingestion',
    items: ['Schema mapping', 'Delta capture', 'Validation & quarantine', 'Staging store'],
    note: 'One adapter per source normalises into the canonical material record.',
    state: 'implemented (CSV adapter)',
  },
  {
    title: 'Harmonisation Core',
    items: ['Normalisation', 'Material DNA extraction', 'Candidate retrieval',
      'Hybrid scoring', 'Engineering rules'],
    note: 'Source-agnostic. This is the entire engine in this prototype.',
    state: 'implemented',
  },
  {
    title: 'National Master',
    items: ['National identity clustering', 'Deterministic code generation',
      'Standard description synthesis', 'Human approval workflow'],
    note: 'Approved mappings become the national material master of record.',
    state: 'implemented',
  },
  {
    title: 'Mapping Export',
    items: ['Legacy ↔ national crosswalk', 'IDoc / BAPI write-back',
      'REST pull for CPSE systems', 'Audit extract for CVC/CAG'],
    note: 'Export contract is the crosswalk table; no write-back is implemented here.',
    state: 'prototype: REST read-only',
  },
]

const DECISION_STATES = [
  ['IDENTITY_MATCH', 'All critical attributes match and evidence is strong.',
    'Safe to merge under one national code.'],
  ['POTENTIAL_EQUIVALENT', 'Core attributes align; some are less specific or unstated.',
    'Merge after steward confirmation.'],
  ['REVIEW_REQUIRED', 'Partial agreement, no outright conflict.',
    'Route to an engineer.'],
  ['INSUFFICIENT_EVIDENCE', 'Too few attributes stated on both sides to judge.',
    'Enrich the source description first.'],
  ['DO_NOT_MERGE', 'A critical engineering attribute conflicts.',
    'Blocked regardless of text similarity.'],
]

export default function Architecture() {
  return (
    <div className="space-y-5">
      <Panel title="ERP Integration Ready — Architecture Note"
        subtitle="Where a real SAP/ERP connector attaches, and what this prototype actually implements">
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">
          This prototype deliberately ships no simulated SAP integration. The
          harmonisation core is source-agnostic: it consumes a canonical
          material record, so adding a real ERP source means writing one
          ingestion adapter, not changing the engine. Each stage below is
          labelled with what exists today.
        </p>
      </Panel>

      <Panel title="Integration Pipeline" bodyClassName="!p-0">
        <div className="overflow-x-auto">
          <div className="flex min-w-max items-stretch gap-0 p-4">
            {STAGES.map((stage, index) => (
              <div key={stage.title} className="flex items-stretch">
                <div className="w-[260px] rounded-sm border border-navy-700
                                bg-navy-850/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider
                                   text-slate-100">
                      {stage.title}
                    </h3>
                    <span className="font-mono text-[0.6rem] text-slate-600">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {stage.items.map((item) => (
                      <li key={item} className="flex gap-1.5 text-2xs text-slate-400">
                        <span className="text-navy-600">▸</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2.5 border-t border-navy-800 pt-2">
                    <span className="badge border-navy-700 bg-navy-900 text-steel-400">
                      {stage.state}
                    </span>
                    <p className="mt-1.5 text-[0.65rem] leading-snug text-slate-500">
                      {stage.note}
                    </p>
                  </div>
                </div>
                {index < STAGES.length - 1 && (
                  <div className="flex items-center px-2">
                    <span className="font-mono text-lg text-navy-600">→</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Matching Pipeline">
          <WorkflowStrip />
          <ol className="mt-4 space-y-2.5">
            {[
              ['Normalisation', 'Uppercase, strip delimiters, expand ~60 engineering abbreviations (SMLS→SEAMLESS, BRG→BEARING), repair mangled inch marks.'],
              ['Material DNA extraction', 'Resolve category, then claim numeric slots by unit marker and known-value dictionaries — order-independent, because legacy token order is unreliable.'],
              ['Candidate retrieval', 'TF-IDF word (1-2gram) + char_wb (3-5gram) cosine over the precomputed corpus; top 200 pooled.'],
              ['Similarity scoring', '0.40 semantic + 0.40 attribute + 0.20 classification, with RapidFuzz token-set on an order-insensitive signature.'],
              ['Engineering rules', 'Any critical attribute conflict forces DO_NOT_MERGE; thin evidence forces INSUFFICIENT_EVIDENCE.'],
              ['Decision', 'One of five explicit states, with matched / compatible / conflicting / missing attribute lists attached.'],
            ].map(([title, body], index) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center
                                 justify-center rounded-sm border border-navy-700
                                 bg-navy-850 font-mono text-[0.6rem] text-steel-400">
                  {index + 1}
                </span>
                <div>
                  <div className="text-xs font-semibold text-slate-200">{title}</div>
                  <p className="mt-0.5 text-2xs leading-relaxed text-slate-500">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-5">
          <Panel title="Decision States" bodyClassName="!p-0">
            <table className="dtable">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Trigger</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {DECISION_STATES.map(([state, trigger, action]) => (
                  <tr key={state}>
                    <td className="font-mono text-2xs font-semibold text-slate-200">
                      {state}
                    </td>
                    <td className="text-2xs text-slate-400">{trigger}</td>
                    <td className="text-2xs text-slate-500">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Prototype Boundaries">
            <ul className="space-y-2">
              {[
                'No SAP/ERP write-back. Export is a read-only REST crosswalk.',
                'The material master lives in memory and is rebuilt from CSV at startup; only human decisions persist in SQLite.',
                'Opportunity scoring uses coverage, duplication and fragmentation only — the dataset carries no spend or quantity data, so no monetary savings are claimed.',
                'The engineering vocabulary covers the five material families present in this dataset and is a data file, not hardcoded logic.',
                'Embeddings are an optional extra signal, off by default, so the prototype never blocks on a model download.',
              ].map((item) => (
                <li key={item} className="flex gap-2 text-2xs leading-relaxed
                                          text-slate-400">
                  <span className="text-amber-500/70">!</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
