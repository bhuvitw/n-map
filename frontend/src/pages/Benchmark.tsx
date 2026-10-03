import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts'
import { api, type Benchmark as BenchmarkData } from '../lib/api'
import { DECISION_STYLES, num, pct } from '../lib/format'
import {
  DecisionBadge, ErrorNote, Loading, Panel, StatTile,
} from '../components/ui'

const DECISION_COLOURS: Record<string, string> = {
  IDENTITY_MATCH: '#34d399',
  POTENTIAL_EQUIVALENT: '#38bdf8',
  REVIEW_REQUIRED: '#fbbf24',
  INSUFFICIENT_EVIDENCE: '#94a3b8',
  DO_NOT_MERGE: '#fb7185',
  NO_CANDIDATE: '#475569',
}

export default function Benchmark() {
  const [data, setData] = useState<BenchmarkData | null>(null)
  const [sampleSize, setSampleSize] = useState(150)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const run = (size: number) => {
    setLoading(true)
    setError(null)
    api.benchmark(size).then(setData).catch(setError).finally(() => setLoading(false))
  }

  useEffect(() => { run(sampleSize) }, [])

  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading label="Running benchmark against held-out labels" />

  const { harmonisation: harm, retrieval, rule_stress_test: stress } = data
  const decisionData = Object.entries(retrieval.decision_distribution)
    .map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-5">
      <Panel title="Benchmark / Proof Board"
        subtitle="AI predictions evaluated against the held-out Target_National_Code"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="sample" className="label">Retrieval sample</label>
            <select id="sample" value={sampleSize}
              onChange={(event) => {
                const size = Number(event.target.value)
                setSampleSize(size)
                run(size)
              }}
              className="input !w-auto !py-1 !text-xs">
              {[150, 300, 500, 1000].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <button type="button" onClick={() => run(sampleSize)}
              className="btn-ghost !py-1" disabled={loading}>
              {loading ? 'Running…' : 'Re-run'}
            </button>
          </div>
        }>
        <div className="rounded-sm border border-navy-700 bg-navy-850/60 p-3">
          <div className="label mb-1.5">Evaluation integrity</div>
          <p className="text-xs leading-relaxed text-slate-400">
            The matching engine receives only{' '}
            <span className="font-mono text-slate-300">Legacy_Description</span>,{' '}
            <span className="font-mono text-slate-300">Legacy_UOM</span> and{' '}
            <span className="font-mono text-slate-300">Legacy_Material_Group</span>.
            The ground-truth columns{' '}
            {harm && data.methodology.ground_truth_columns.map((column) => (
              <span key={column} className="font-mono text-amber-300">{column} </span>
            ))}
            are read only inside the evaluation module — never as matching
            features. Every metric below is computed live from the engine.
          </p>
        </div>
      </Panel>

      {/* Primary metrics */}
      <div>
        <h3 className="panel-title mb-2">
          Harmonization quality — exact pairwise metrics over all record pairs
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatTile label="Precision" value={harm.precision.toFixed(4)} accent="good" />
          <StatTile label="Recall" value={harm.recall.toFixed(4)} accent="good" />
          <StatTile label="F1 Score" value={harm.f1.toFixed(4)} accent="good" />
          <StatTile label="Evaluated Records" value={num(harm.evaluated_records)} />
          <StatTile label="Correct Assignments" value={num(harm.correct_assignments)}
            accent="good" />
          <StatTile label="Incorrect" value={num(harm.incorrect_assignments)}
            accent={harm.incorrect_assignments ? 'alert' : 'default'} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Pair true positives" value={num(harm.pair_true_positives)} />
          <MiniStat label="Pairs predicted same identity"
            value={num(harm.pair_predicted_positives)} />
          <MiniStat label="Pairs truly same identity"
            value={num(harm.pair_actual_positives)} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Identity Alignment Matrix"
          subtitle="Each inferred identity against the ground-truth code it maps to"
          bodyClassName="!p-0">
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Inferred (generated)</th>
                  <th>Ground Truth</th>
                  <th className="w-20">Records</th>
                  <th className="w-20">Mixed</th>
                  <th className="w-20">Purity</th>
                </tr>
              </thead>
              <tbody>
                {harm.alignment.map((row) => (
                  <tr key={row.predicted_national_code}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-accent-bright">
                        {row.predicted_national_code}
                      </div>
                      <div className="mt-0.5 max-w-[260px] truncate text-2xs text-slate-500">
                        {row.generated_standard_description}
                      </div>
                    </td>
                    <td className="font-mono text-xs text-amber-300">
                      {row.dominant_target_code}
                    </td>
                    <td className="font-mono text-xs text-slate-200">
                      {num(row.records)}
                    </td>
                    <td className={clsx('font-mono text-xs',
                      row.mixed_records ? 'text-rose-300' : 'text-slate-500')}>
                      {num(row.mixed_records)}
                    </td>
                    <td>
                      <span className={clsx('font-mono text-xs font-semibold',
                        row.purity === 1 ? 'text-emerald-300' : 'text-amber-300')}>
                        {pct(row.purity, 1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-navy-800 px-4 py-2.5 text-2xs
                        leading-relaxed text-slate-500">
            National codes are generated deterministically from Material DNA, so
            they intentionally differ from the dataset's label strings. What
            matters is that each inferred identity maps 1:1 onto one ground-truth
            code.
          </p>
        </Panel>

        <Panel title="Retrieval Quality"
          subtitle={`Top-1 match on a seeded sample (seed ${retrieval.seed}, n=${retrieval.sample_size})`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Precision" value={retrieval.precision.toFixed(4)} />
            <StatTile label="Recall" value={retrieval.recall.toFixed(4)} />
            <StatTile label="F1" value={retrieval.f1.toFixed(4)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Correct" value={num(retrieval.correct_matches)} tone="good" />
            <MiniStat label="Incorrect merges" value={num(retrieval.incorrect_matches)}
              tone={retrieval.incorrect_matches ? 'bad' : 'default'} />
            <MiniStat label="Missed merges" value={num(retrieval.missed_matches)}
              tone={retrieval.missed_matches ? 'warn' : 'default'} />
          </div>

          <div className="mt-4 border-t border-navy-800 pt-3">
            <div className="label mb-2">Decision distribution</div>
            <div className="flex items-center gap-4">
              <div className="h-[150px] w-[150px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={decisionData} dataKey="value" nameKey="name"
                      innerRadius={38} outerRadius={70} paddingAngle={2}
                      stroke="#0a1020" strokeWidth={2}>
                      {decisionData.map((entry) => (
                        <Cell key={entry.name}
                          fill={DECISION_COLOURS[entry.name] ?? '#475569'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{
                      background: '#0e1526', border: '1px solid #1d2b48',
                      borderRadius: 2, fontSize: 12,
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {decisionData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-sm"
                      style={{ background: DECISION_COLOURS[entry.name] ?? '#475569' }} />
                    <span className="text-2xs text-slate-400">
                      {DECISION_STYLES[entry.name as keyof typeof DECISION_STYLES]?.label
                        ?? entry.name}
                    </span>
                    <span className="font-mono text-2xs text-slate-200">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* The hard test */}
      <Panel title="Engineering Rule Stress Test"
        subtitle="Hard negatives: one critical attribute altered, wording kept near-identical"
        actions={
          <span className={clsx('badge',
            stress.false_merges === 0
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300')}>
            {stress.correctly_rejected}/{stress.total_probes} correctly rejected
          </span>
        }
        bodyClassName="!p-0">
        <div className="grid gap-3 border-b border-navy-800 p-4 sm:grid-cols-4">
          <MiniStat label="Rejection rate" value={pct(stress.rejection_rate, 1)}
            tone={stress.rejection_rate === 1 ? 'good' : 'warn'} />
          <MiniStat label="False merges" value={num(stress.false_merges)}
            tone={stress.false_merges ? 'bad' : 'good'} />
          <MiniStat label="Mean text similarity of probes"
            value={stress.mean_semantic_score_of_probes.toFixed(3)} tone="warn" />
          <MiniStat label="Probes with high text similarity"
            value={num(stress.probes_with_high_text_similarity)} tone="warn" />
        </div>
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th className="w-12">Result</th>
                <th>Altered Attribute</th>
                <th>Difference</th>
                <th className="w-24">Text Sim.</th>
                <th className="w-24">Final</th>
                <th>Decision</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {stress.results.map((row, index) => (
                <tr key={index}
                  className={clsx(!row.correctly_rejected && 'bg-rose-500/5')}>
                  <td>
                    <span className={clsx('font-mono text-xs font-bold',
                      row.correctly_rejected ? 'text-emerald-300' : 'text-rose-300')}>
                      {row.correctly_rejected ? '✓' : '✕'}
                    </span>
                  </td>
                  <td className="text-xs font-semibold text-slate-200">
                    {row.altered_attribute}
                  </td>
                  <td className="font-mono text-2xs text-slate-400">{row.detail}</td>
                  <td>
                    <span className={clsx('font-mono text-xs',
                      row.semantic_score >= 0.6 ? 'text-amber-300' : 'text-slate-400')}>
                      {row.semantic_score.toFixed(3)}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-300">
                    {row.final_score.toFixed(3)}
                  </td>
                  <td><DecisionBadge decision={row.decision} /></td>
                  <td className="max-w-[280px] text-2xs leading-snug text-slate-400">
                    {row.primary_reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-navy-800 px-4 py-2.5 text-2xs
                      leading-relaxed text-slate-500">
          {stress.note}
        </p>
      </Panel>

      {/* Errors */}
      <Panel title="Error Table"
        subtitle={`${retrieval.error_count} retrieval errors in the sampled set`}
        bodyClassName="!p-0">
        {retrieval.errors.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">
            No false or missed merges in the sampled set. With only{' '}
            {harm.ground_truth_identities} well-separated material concepts in
            this synthetic dataset, a clean sheet here is expected — the rule
            stress test above is the more demanding measurement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Record</th>
                  <th>Matched To</th>
                  <th>Decision</th>
                  <th className="w-20">Score</th>
                  <th>Truth vs Matched</th>
                </tr>
              </thead>
              <tbody>
                {retrieval.errors.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <span className={clsx('badge',
                        row.error_type === 'FALSE_MERGE'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-300')}>
                        {String(row.error_type).replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <div className="font-mono text-2xs text-slate-200">
                        {row.cpse_name} / {row.legacy_material_code}
                      </div>
                      <div className="max-w-[240px] truncate font-mono text-2xs
                                      text-slate-500">
                        {row.legacy_description}
                      </div>
                    </td>
                    <td>
                      <div className="font-mono text-2xs text-slate-200">
                        {row.matched_legacy_code}
                      </div>
                      <div className="max-w-[240px] truncate font-mono text-2xs
                                      text-slate-500">
                        {row.matched_description}
                      </div>
                    </td>
                    <td className="font-mono text-2xs text-slate-400">
                      {row.decision}
                    </td>
                    <td className="font-mono text-2xs text-slate-300">
                      {Number(row.final_score).toFixed(3)}
                    </td>
                    <td className="font-mono text-2xs text-slate-400">
                      {row.target_national_code} → {row.matched_target_national_code}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Material DNA Extraction Coverage"
          subtitle={`Share of ${num(data.dna_coverage.total_records)} records where each attribute was recovered`}>
          <div className="space-y-2">
            {data.dna_coverage.attributes.map((attribute) => (
              <div key={attribute.attribute}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xs uppercase tracking-wider text-slate-400">
                    {attribute.attribute.replaceAll('_', ' ')}
                  </span>
                  <span className="font-mono text-2xs text-slate-300">
                    {pct(attribute.coverage, 1)} · {num(attribute.records)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-navy-800">
                  <div className="h-full bg-accent"
                    style={{ width: `${attribute.coverage * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-navy-800 pt-3 text-2xs
                        leading-relaxed text-slate-500">
            Coverage below 100% is expected and correct: many legacy
            descriptions simply never state a size, grade or standard. Those
            become <span className="font-mono">missing</span> attributes, not
            conflicts.
          </p>
        </Panel>

        <Panel title="Reproducibility">
          <ul className="space-y-2">
            {data.methodology.notes.map((note, index) => (
              <li key={index} className="flex gap-2 text-xs leading-relaxed
                                         text-slate-400">
                <span className="text-slate-600">—</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-navy-800 pt-3">
            <MiniStat label="Random seed" value={String(retrieval.seed)} />
            <MiniStat label="Benchmark runtime"
              value={`${data.elapsed_seconds ?? '—'} s`} />
          </div>
          <p className="mt-3 text-2xs leading-relaxed text-slate-500">
            Reproduce from the CLI:{' '}
            <code className="font-mono text-slate-400">
              curl localhost:8000/api/benchmark?sample_size={sampleSize}
            </code>
          </p>
        </Panel>
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone = 'default' }: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}) {
  const tones = {
    default: 'text-slate-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-rose-300',
  }
  return (
    <div className="rounded-sm border border-navy-800 bg-navy-850/50 px-3 py-2">
      <div className="label">{label}</div>
      <div className={clsx('mt-0.5 font-mono text-lg font-semibold tabular-nums',
        tones[tone])}>
        {value}
      </div>
    </div>
  )
}
