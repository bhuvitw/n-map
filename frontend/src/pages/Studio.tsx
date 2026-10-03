import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { api, type DemoQueries, type MatchResult } from '../lib/api'
import { num, pct } from '../lib/format'
import {
  ConfidenceMeta, DecisionBadge, DnaChips, ErrorNote, Loading, Panel, WhyMatch,
} from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

export default function Studio() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [demo, setDemo] = useState<DemoQueries | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.demoQueries().then(setDemo).catch(() => setDemo(null))
  }, [])

  // Run whenever the ?q= parameter changes (also covers demo-button clicks).
  useEffect(() => {
    const term = params.get('q')
    if (!term) return
    setQuery(term)
    setLoading(true)
    setError(null)
    api.match({ query: term, top_k: 10 })
      .then(setResult)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [params])

  const run = (term: string) => {
    if (!term.trim()) return
    setParams({ q: term.trim() })
  }

  return (
    <div className="space-y-5">
      <Panel>
        <form onSubmit={(event) => { event.preventDefault(); run(query) }}
          className="space-y-3">
          <div>
            <label htmlFor="q" className="label">
              Natural-language material query
            </label>
            <div className="mt-2 flex gap-2">
              <input id="q" ref={inputRef} value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='e.g. "A106 grade B seamless pipe 4 inch"'
                className="input flex-1 !py-3 !text-base font-mono"
                autoComplete="off" />
              <button type="submit" className="btn-primary !px-6"
                disabled={loading || !query.trim()}>
                {loading ? 'Matching…' : 'Match'}
              </button>
            </div>
          </div>

          {demo && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label mr-1">Demo queries</span>
              {demo.queries.map((item) => (
                <button key={item.query} type="button"
                  onClick={() => run(item.query)}
                  className={clsx('rounded-sm border px-2 py-1 text-2xs font-medium',
                    'transition-colors',
                    params.get('q') === item.query
                      ? 'border-accent/60 bg-accent/15 text-accent-bright'
                      : 'border-navy-700 bg-navy-850 text-slate-400 hover:text-slate-200')}>
                  {item.label}
                </button>
              ))}
              <button type="button" onClick={() => run(demo.negative_example.query)}
                className="rounded-sm border border-rose-500/40 bg-rose-500/10 px-2
                           py-1 text-2xs font-semibold text-rose-300
                           hover:bg-rose-500/20"
                title={demo.negative_example.explanation}>
                ⚠ Negative: 6 inch variant
              </button>
            </div>
          )}
        </form>
      </Panel>

      {error ? <ErrorNote error={error} /> : null}
      {loading && !result && <Loading label="Extracting Material DNA" />}

      {result && (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Interpreted query DNA */}
            <Panel title="Interpreted Query — Material DNA"
              subtitle={`Normalised: ${result.query_dna.normalized}`}
              actions={
                <span className="font-mono text-2xs text-slate-500">
                  {result.elapsed_ms.toFixed(0)} ms · pool {result.pool_searched}/{num(result.total_records)}
                </span>
              }>
              <DnaChips dna={result.query_dna}
                emptyNote="No engineering attributes recognised in this query. Try naming a category, standard or size." />
              <div className="mt-4 grid gap-3 border-t border-navy-800 pt-3 sm:grid-cols-2">
                <div>
                  <div className="label">Generated standard description</div>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-slate-200">
                    {result.interpreted_description || '—'}
                  </p>
                </div>
                <div>
                  <div className="label">DNA signature</div>
                  <p className="mt-1 break-all font-mono text-2xs leading-relaxed text-slate-500">
                    {result.query_dna.signature || '—'}
                  </p>
                </div>
              </div>
              {result.query_dna.unmapped.length > 0 && (
                <div className="mt-3 border-t border-navy-800 pt-3">
                  <div className="label">Unmapped tokens</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {result.query_dna.unmapped.map((token) => (
                      <span key={token}
                        className="rounded-sm border border-navy-800 bg-navy-900
                                   px-1.5 py-0.5 font-mono text-2xs text-slate-500">
                        {token}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* National code recommendation */}
            <Panel title="National Code Recommendation">
              <div className="space-y-3">
                <div>
                  <div className="font-mono text-2xl font-bold tracking-tight text-accent-bright">
                    {result.recommendation.national_code}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    {result.recommendation.standard_description}
                  </p>
                </div>

                <div className={clsx('badge w-full justify-center',
                  result.recommendation.status === 'EXISTING_NATIONAL_IDENTITY'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300')}>
                  {result.recommendation.status.replaceAll('_', ' ')}
                </div>

                <dl className="space-y-2 border-t border-navy-800 pt-3 text-xs">
                  <Row label="CPSE coverage"
                    value={`${result.recommendation.cpse_coverage.length} enterprises`} />
                  <Row label="Records under identity"
                    value={num(result.recommendation.record_count)} />
                  <Row label="Legacy identities"
                    value={num(result.recommendation.legacy_identity_count)} />
                  <Row label="Supporting matches"
                    value={num(result.recommendation.supporting_matches)} />
                </dl>

                {result.recommendation.cpse_coverage.length > 0 && (
                  <div className="border-t border-navy-800 pt-3">
                    <div className="label mb-1.5">Held by</div>
                    <div className="flex flex-wrap gap-1">
                      {result.recommendation.cpse_coverage.map((cpse) => (
                        <span key={cpse}
                          className="badge border-navy-700 bg-navy-850 text-slate-300">
                          {cpse}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {result.recommendation.record_count > 0 && (
                  <Link to={`/graph/${result.recommendation.national_code}`}
                    className="btn-ghost w-full">
                    View identity graph
                  </Link>
                )}
              </div>
            </Panel>
          </div>

          <Panel title="Candidate Legacy Materials"
            subtitle={`Top ${result.candidates.length} of ${num(result.total_records)} records, ranked by decision then score`}
            bodyClassName="!p-0">
            <div className="divide-y divide-navy-800">
              {result.candidates.map((candidate, index) => (
                <article key={candidate.record.id ?? index}
                  className="p-4 transition-colors hover:bg-navy-850/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge border-navy-700 bg-navy-850 text-slate-300">
                          {candidate.record.cpse_name}
                        </span>
                        <span className="font-mono text-sm font-semibold text-slate-100">
                          {candidate.record.legacy_material_code}
                        </span>
                        <DecisionBadge decision={candidate.score.decision} />
                        {candidate.national_code && (
                          <span className="font-mono text-2xs text-accent-bright">
                            → {candidate.national_code}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 font-mono text-xs leading-relaxed text-slate-300">
                        {candidate.record.legacy_description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-500">
                        <span>UOM <span className="font-mono text-slate-400">
                          {candidate.record.legacy_uom}</span></span>
                        <span>Group <span className="text-slate-400">
                          {candidate.record.legacy_material_group}</span></span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-start gap-4">
                      <div className="text-right">
                        <div className="label">Final score</div>
                        <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
                          {candidate.score.final_score.toFixed(3)}
                        </div>
                        <div className="mt-0.5 text-2xs text-slate-500">
                          conf {pct(candidate.score.confidence, 0)}
                        </div>
                      </div>
                      {candidate.record.id !== null && (
                        <Link
                          to={`/compare/q/${candidate.record.id}?query=${encodeURIComponent(result.query)}`}
                          className="btn-ghost">
                          Compare
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 border-t border-navy-800 pt-3
                                  lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <div className="label mb-1.5">Why match?</div>
                      <WhyMatch score={candidate.score} compact />
                      <div className="mt-2">
                        <ConfidenceMeta score={candidate.score} />
                      </div>
                    </div>
                    <div>
                      <div className="label mb-1.5">Candidate Material DNA</div>
                      <DnaChips dna={candidate.dna} />
                    </div>
                  </div>

                  {candidate.score.critical_conflicts.length > 0 && (
                    <div className="mt-3 rounded-sm border border-rose-500/40
                                    bg-rose-500/5 px-3 py-2">
                      <div className="text-2xs font-semibold uppercase
                                      tracking-wider text-rose-300">
                        Critical attribute mismatch:{' '}
                        {candidate.score.critical_conflicts.join(', ')}
                      </div>
                      <p className="mt-0.5 text-2xs text-slate-400">
                        Text similarity is high, but merging these would corrupt
                        the national material master.
                      </p>
                    </div>
                  )}
                </article>
              ))}
              {result.candidates.length === 0 && (
                <p className="p-4 text-xs text-slate-500">
                  No candidates retrieved for this query.
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Pipeline Stage">
            <WorkflowStrip active="AI MATCH" />
          </Panel>
        </>
      )}

      {!result && !loading && !error && (
        <Panel title="Material Intelligence Studio">
          <p className="text-xs leading-relaxed text-slate-400">
            Enter any legacy material description or a natural-language query.
            N-MAP normalises the text, extracts structured Material DNA,
            retrieves candidates across every CPSE and explains each decision
            attribute by attribute.
          </p>
        </Panel>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  )
}
