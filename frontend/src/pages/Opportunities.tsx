import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api, type OpportunityPayload } from '../lib/api'
import { OPPORTUNITY_STYLES, num, pct } from '../lib/format'
import { ErrorNote, Loading, Panel, StatTile } from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

export default function Opportunities() {
  const [data, setData] = useState<OpportunityPayload | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    api.opportunities().then(setData).catch(setError)
  }, [])

  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading label="Scoring rationalisation opportunities" />

  const maxCell = Math.max(
    1, ...data.heatmap.rows.flatMap((row) => row.cells))

  return (
    <div className="space-y-5">
      <Panel title="Opportunity Radar"
        subtitle="Cross-CPSE rationalisation and collaborative procurement candidates">
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">
          Each inferred national identity is scored on how widely it is held
          across CPSEs, how many duplicate legacy codes describe it, and how
          fragmented those descriptions are. These are the three levers that
          block national spend aggregation today.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="National Identities" value={data.summary.total_identities} />
        <StatTile label="High Opportunity" value={data.summary.high} accent="alert" />
        <StatTile label="Medium" value={data.summary.medium} accent="warn" />
        <StatTile label="Cross-CPSE" value={data.summary.cross_cpse_identities}
          hint="Held by more than one enterprise" accent="good" />
        <StatTile label="Legacy Identities"
          value={num(data.summary.total_legacy_identities)}
          hint="Codes eligible for rationalisation" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.opportunities.map((item) => (
          <article key={item.national_code}
            className="panel flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-base font-bold text-accent-bright">
                  {item.national_code}
                </div>
                <p className="mt-1 text-xs leading-snug text-slate-300">
                  {item.standard_description}
                </p>
              </div>
              <span className={clsx('badge', OPPORTUNITY_STYLES[item.opportunity])}>
                {item.opportunity}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2
                            border-t border-navy-800 pt-3">
              <Metric label="CPSE Coverage" value={item.cpse_coverage_label} />
              <Metric label="Legacy Identities" value={num(item.legacy_identity_count)} />
              <Metric label="Records" value={num(item.record_count)} />
              <Metric label="Description Variants" value={num(item.description_variants)} />
            </div>

            {/* Standardisation level meter */}
            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className="label">Standardisation level</span>
                <span className="font-mono text-xs text-slate-200">
                  {pct(item.standardisation_level, 0)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-navy-800">
                <div className={clsx('h-full',
                  item.standardisation_level < 0.4 ? 'bg-rose-500'
                    : item.standardisation_level < 0.7 ? 'bg-amber-500'
                      : 'bg-emerald-500')}
                  style={{ width: `${item.standardisation_level * 100}%` }} />
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className="label">Opportunity score</span>
                <span className="font-mono text-xs font-semibold text-slate-100">
                  {item.opportunity_score.toFixed(3)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-navy-800">
                <div className="h-full bg-accent"
                  style={{ width: `${item.opportunity_score * 100}%` }} />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {item.classifications.map((label) => (
                <span key={label}
                  className="badge border-navy-700 bg-navy-850 text-steel-400">
                  {label}
                </span>
              ))}
            </div>

            <ul className="mt-3 space-y-1 border-t border-navy-800 pt-3">
              {item.reasons.map((reason, index) => (
                <li key={index} className="flex gap-1.5 text-2xs leading-relaxed
                                           text-slate-400">
                  <span className="text-slate-600">—</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap gap-1">
              {item.cpses.map((cpse) => (
                <span key={cpse}
                  className="rounded-sm border border-navy-700 bg-navy-850 px-1.5
                             py-0.5 font-mono text-2xs text-slate-300">
                  {cpse}
                </span>
              ))}
            </div>

            <Link to={`/graph/${item.national_code}`}
              className="btn-ghost mt-4 w-full">
              Trace identity
            </Link>
          </article>
        ))}
      </div>

      <Panel title="CPSE × National Identity Heatmap"
        subtitle="Legacy record count per enterprise. Dense rows are collaborative procurement candidates."
        bodyClassName="!p-0">
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th className="min-w-[240px]">National Identity</th>
                {data.heatmap.cpses.map((cpse) => (
                  <th key={cpse} className="text-center">{cpse}</th>
                ))}
                <th className="text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.heatmap.rows.map((row) => {
                const total = row.cells.reduce((sum, value) => sum + value, 0)
                return (
                  <tr key={row.national_code}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-accent-bright">
                        {row.national_code}
                      </div>
                      <div className="mt-0.5 max-w-[320px] truncate text-2xs text-slate-500">
                        {row.standard_description}
                      </div>
                    </td>
                    {row.cells.map((cell, index) => {
                      const intensity = cell / maxCell
                      return (
                        <td key={index} className="text-center">
                          <div className="mx-auto flex h-9 w-16 items-center
                                          justify-center rounded-sm border
                                          border-navy-800 font-mono text-xs
                                          font-semibold tabular-nums"
                            style={{
                              background: cell
                                ? `rgba(75, 134, 212, ${0.10 + intensity * 0.55})`
                                : 'transparent',
                              color: cell ? '#e2e8f0' : '#3b4a66',
                            }}>
                            {cell || '·'}
                          </div>
                        </td>
                      )
                    })}
                    <td className="text-center font-mono text-xs font-semibold
                                   text-slate-200">
                      {num(total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Methodology Note">
        <p className="text-xs leading-relaxed text-slate-400">
          {data.summary.note}
        </p>
      </Panel>

      <Panel title="Pipeline Stage">
        <WorkflowStrip active="OPPORTUNITY" />
      </Panel>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">
        {value}
      </div>
    </div>
  )
}
