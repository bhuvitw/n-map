import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { api, type Comparison, type MaterialRow } from '../lib/api'
import { DECISION_STYLES, pct } from '../lib/format'
import {
  DecisionBadge, DnaChips, DnaVerdictTable, ErrorNote, Loading, Panel,
  ScorePanel,
} from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

export default function Compare() {
  const { id, candidateId } = useParams()
  const [params] = useSearchParams()
  const query = params.get('query')
  const [data, setData] = useState<Comparison | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!candidateId) return
    setData(null)
    setError(null)
    const candidate = Number(candidateId)
    // `/compare/q/:candidateId?query=...` compares a free-text query instead
    // of a stored record - this is how the 6-inch negative demo is shown.
    const promise = id === 'q' && query
      ? api.compareQuery(query, candidate)
      : api.compareRecords(Number(id), candidate)
    promise.then(setData).catch(setError)
  }, [id, candidateId, query])

  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading label="Comparing Material DNA" />

  const { score } = data
  const style = DECISION_STYLES[score.decision]
  const blocked = score.decision === 'DO_NOT_MERGE'

  return (
    <div className="space-y-5">
      {/* Verdict banner */}
      <section className={clsx('panel border-l-2 p-5',
        blocked ? 'border-l-rose-500' :
          score.decision === 'IDENTITY_MATCH' ? 'border-l-emerald-500'
            : 'border-l-amber-500')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="label">Harmonization verdict</div>
            <h1 className={clsx('mt-1 text-3xl font-bold tracking-tight',
              style.className.split(' ').find((c) => c.startsWith('text-')))}>
              {style.label.toUpperCase()}
            </h1>
            {score.critical_conflicts.length > 0 && (
              <p className="mt-2 font-mono text-sm font-semibold text-rose-300">
                Critical attribute mismatch: {score.critical_conflicts.join(', ')}
              </p>
            )}
            <ul className="mt-2 space-y-0.5">
              {score.reasons.map((reason, index) => (
                <li key={index} className="text-xs text-slate-400">— {reason}</li>
              ))}
            </ul>
          </div>

          <div className="shrink-0 text-right">
            <div className="label">Final score</div>
            <div className="font-mono text-4xl font-bold tabular-nums text-slate-100">
              {score.final_score.toFixed(3)}
            </div>
            <div className="mt-1 text-2xs text-slate-500">
              Confidence {pct(score.confidence)} · Evidence {pct(score.evidence_strength)}
            </div>
          </div>
        </div>

        {blocked && (
          <div className="mt-4 rounded-sm border border-rose-500/40 bg-rose-500/5 p-3">
            <p className="text-xs leading-relaxed text-rose-200/90">
              <strong className="font-semibold">Engineering rule override.</strong>{' '}
              Text similarity for this pair is{' '}
              <span className="font-mono">{score.semantic_score.toFixed(3)}</span>
              {score.semantic_score >= 0.55 && ' — high enough that a text-only matcher would have merged them'}.
              A critical engineering attribute conflicts, so N-MAP blocks the
              merge regardless of wording similarity.
            </p>
          </div>
        )}

        {data.recommended_national_code && !blocked && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-sm
                          border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div>
              <div className="label text-emerald-300">Recommended national code</div>
              <div className="mt-0.5 font-mono text-lg font-bold text-emerald-200">
                {data.recommended_national_code}
              </div>
            </div>
            <Link to="/review" className="btn-approve ml-auto">
              Take to Approval Center
            </Link>
          </div>
        )}
      </section>

      {/* Two material cards */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <MaterialCard material={data.material_a} nationalCode={data.national_code_a}
          side="A" isQuery={data.material_a.id === null} />
        <MaterialCard material={data.material_b} nationalCode={data.national_code_b}
          side="B" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Material DNA Comparison"
          subtitle="Attribute-by-attribute verdict. Critical attributes govern the decision."
          bodyClassName="!p-0">
          <DnaVerdictTable score={score}
            leftLabel={data.material_a.id === null ? 'Query' : `A · ${data.material_a.cpse_name}`}
            rightLabel={`B · ${data.material_b.cpse_name}`} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Score Decomposition">
            <ScorePanel score={score} />
            <p className="mt-3 border-t border-navy-800 pt-3 text-2xs
                          leading-relaxed text-slate-500">
              Final = 0.40 × semantic + 0.40 × attribute + 0.20 × classification,
              then arbitrated by the engineering-rule layer.
            </p>
          </Panel>

          <Panel title="Evidence Summary">
            <dl className="space-y-2 text-xs">
              <EvidenceRow label="Matched" items={score.matched_attributes}
                tone="text-emerald-300" />
              <EvidenceRow label="Compatible" items={score.compatible_attributes}
                tone="text-sky-300" />
              <EvidenceRow label="Conflicting" items={score.conflicting_attributes}
                tone="text-rose-300" />
              <EvidenceRow label="Not stated" items={score.missing_attributes}
                tone="text-slate-400" />
            </dl>
            <div className="mt-3 border-t border-navy-800 pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="label">Same national identity</span>
                <span className={clsx('font-mono text-xs font-semibold',
                  data.same_national_identity ? 'text-emerald-300' : 'text-slate-400')}>
                  {data.same_national_identity ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Pipeline Stage">
        <WorkflowStrip active="ENGINEERING RULES" />
      </Panel>
    </div>
  )
}

function MaterialCard({ material, nationalCode, side, isQuery }: {
  material: MaterialRow
  nationalCode: string | null
  side: 'A' | 'B'
  isQuery?: boolean
}) {
  return (
    <Panel
      title={isQuery ? 'Search Query' : `Material ${side} · ${material.cpse_name}`}
      subtitle={nationalCode ? `National identity ${nationalCode}` : undefined}
      actions={
        <span className="badge border-navy-700 bg-navy-850 text-slate-400">
          {isQuery ? 'QUERY' : material.cpse_name}
        </span>
      }>
      <div className="space-y-3">
        <div>
          <div className="label">Legacy material code</div>
          <div className="mt-0.5 font-mono text-lg font-semibold text-slate-100">
            {material.legacy_material_code}
          </div>
        </div>

        <div>
          <div className="label">Legacy description (as recorded)</div>
          <p className="mt-1 rounded-sm border border-navy-800 bg-navy-900 px-2.5
                        py-2 font-mono text-xs leading-relaxed text-slate-300">
            {material.legacy_description}
          </p>
        </div>

        <div>
          <div className="label">Normalised</div>
          <p className="mt-1 font-mono text-2xs leading-relaxed text-slate-500">
            {material.normalized_description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label">UOM</div>
            <div className="value-mono mt-0.5">{material.legacy_uom || '—'}</div>
          </div>
          <div>
            <div className="label">ERP material group</div>
            <div className="mt-0.5 text-sm text-slate-200">
              {material.legacy_material_group || '—'}
            </div>
          </div>
        </div>

        {material.dna && (
          <div className="border-t border-navy-800 pt-3">
            <div className="label mb-1.5">Material DNA</div>
            <DnaChips dna={material.dna} />
          </div>
        )}

        {material.generated_standard_description && (
          <div className="border-t border-navy-800 pt-3">
            <div className="label">Generated standard description</div>
            <p className="mt-1 font-mono text-xs leading-relaxed text-accent-bright">
              {material.generated_standard_description}
            </p>
          </div>
        )}

        {material.dna?.attributes?.data_quality_flag && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/5
                          px-2.5 py-2">
            <div className="label text-amber-300">Data quality exception</div>
            <p className="mt-0.5 text-2xs text-amber-200/80">
              {material.dna.attributes.data_quality_flag}
            </p>
          </div>
        )}

        {material.id !== null && (
          <Link to={`/graph/${nationalCode ?? ''}`}
            className="btn-ghost w-full">
            Trace in identity graph
          </Link>
        )}
      </div>
    </Panel>
  )
}

function EvidenceRow({ label, items, tone }: {
  label: string
  items: string[]
  tone: string
}) {
  return (
    <div>
      <dt className="label">{label} ({items.length})</dt>
      <dd className={clsx('mt-0.5 text-xs leading-relaxed', tone)}>
        {items.length ? items.join(', ') : <span className="text-slate-600">none</span>}
      </dd>
    </div>
  )
}
