import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Identity, type Stats } from '../lib/api'
import { num } from '../lib/format'
import { ErrorNote, Loading, Panel, StatTile } from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

const CATEGORY_COLOURS = ['#4b86d4', '#5fb3a1', '#c99a4b', '#a77ac9', '#c9705f']

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    Promise.all([api.stats(), api.identities()])
      .then(([s, i]) => {
        setStats(s)
        setIdentities(i.identities)
      })
      .catch(setError)
  }, [])

  if (error) return <ErrorNote error={error} />
  if (!stats) return <Loading label="Loading national overview" />

  const totalCategoryRecords = stats.category_distribution.reduce(
    (sum, c) => sum + c.records, 0) || 1
  // Bars are scaled to the largest category so differences stay visible; the
  // true share of the corpus is labelled alongside.
  const maxCategoryRecords = Math.max(
    1, ...stats.category_distribution.map((c) => c.records))

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-50">
              National Material Harmonization Console
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              {num(stats.total_records)} legacy material records from{' '}
              {stats.cpse_count} CPSEs, carrying {num(stats.description_variants)}{' '}
              distinct free-text descriptions, resolved into{' '}
              {stats.national_identities} national material identities by
              structured Material DNA rather than text similarity alone.
            </p>
          </div>
          <Link to="/match" className="btn-primary">Open Intelligence Studio</Link>
        </div>
        <div className="mt-4 border-t border-navy-800 pt-4">
          <WorkflowStrip />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total Records" value={num(stats.total_records)}
          hint="Legacy CPSE material master rows" />
        <StatTile label="CPSEs" value={stats.cpse_count}
          hint="Contributing enterprises" />
        <StatTile label="Unique Legacy Codes" value={num(stats.unique_legacy_codes)}
          hint="Distinct codes to rationalise" />
        <StatTile label="Legacy Material Groups" value={stats.legacy_material_groups}
          hint="ERP groups in source data" />
        <StatTile label="National Identities" value={stats.national_identities}
          hint="Inferred from Material DNA" accent="good" />
        <StatTile label="Requiring Review" value={num(stats.records_requiring_review)}
          hint="Pending + needs review" accent="warn" />
      </div>

      {/* CPSE -> legacy codes -> national identity traceability */}
      <Panel title="Harmonization Funnel"
        subtitle="CPSEs → legacy material codes → one national material identity"
        actions={<Link to="/graph" className="btn-ghost">Open Identity Graph</Link>}>
        <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div>
            <div className="label mb-2">Source CPSE Systems</div>
            <div className="space-y-1.5">
              {stats.cpses.map((cpse) => (
                <div key={cpse.cpse_name}
                  className="flex items-center justify-between gap-3 rounded-sm
                             border border-navy-700 bg-navy-850 px-2.5 py-1.5">
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    {cpse.cpse_name}
                  </span>
                  <span className="font-mono text-2xs text-slate-500">
                    {num(cpse.records)} records
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Arrow />

          <div>
            <div className="label mb-2">Legacy Identities</div>
            <div className="panel bg-navy-850/60 p-4 text-center">
              <div className="font-mono text-3xl font-bold tabular-nums text-slate-100">
                {num(stats.unique_legacy_codes)}
              </div>
              <div className="mt-1 text-2xs uppercase tracking-wider text-slate-500">
                distinct legacy codes
              </div>
              <div className="mt-3 border-t border-navy-800 pt-3 text-2xs text-slate-500">
                {num(stats.description_variants)} description variants
              </div>
            </div>
          </div>

          <Arrow />

          <div>
            <div className="label mb-2">National Material Identity</div>
            <div className="space-y-1.5">
              {identities.map((identity) => (
                <Link key={identity.national_code}
                  to={`/graph/${identity.national_code}`}
                  className="block rounded-sm border border-navy-700 bg-navy-850
                             px-2.5 py-1.5 transition-colors hover:border-accent/50
                             hover:bg-navy-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-accent-bright">
                      {identity.national_code}
                    </span>
                    <span className="font-mono text-2xs text-slate-500">
                      {identity.cpse_count}/{stats.cpse_count} CPSE
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-slate-400">
                    {identity.standard_description}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Category Distribution"
          subtitle="Derived from extracted Material DNA, not the ERP group field">
          <div className="space-y-3">
            {stats.category_distribution.map((entry, index) => {
              const share = entry.records / totalCategoryRecords
              return (
                <div key={entry.category}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {entry.category}
                    </span>
                    <span className="font-mono text-2xs tabular-nums text-slate-400">
                      {num(entry.records)}
                      <span className="ml-2 text-slate-600">
                        {(share * 100).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 w-full overflow-hidden rounded-sm
                                  bg-navy-850">
                    <div className="h-full rounded-sm transition-all"
                      style={{
                        width: `${(entry.records / maxCategoryRecords) * 100}%`,
                        background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length],
                      }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 border-t border-navy-800 pt-3">
            <div className="label mb-2">Unit of measure spread</div>
            <div className="flex flex-wrap gap-1.5">
              {stats.uom_distribution.map((entry) => (
                <span key={entry.uom}
                  className="badge border-navy-700 bg-navy-850 text-slate-400">
                  {entry.uom}
                  <span className="font-mono text-slate-300">{num(entry.records)}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Data Quality & Pipeline Yield"
          subtitle="What the engine could and could not resolve">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricRow label="Description variants collapsed"
              value={`${num(stats.description_variants)} → ${stats.national_identities}`}
              note="Distinct free-text descriptions reduced to national identities" />
            <MetricRow label="Legacy codes per identity"
              value={(stats.unique_legacy_codes / Math.max(stats.national_identities, 1)).toFixed(0)}
              note="Average duplicate legacy identities per material" />
            <MetricRow label="ERP group contradictions"
              value={num(stats.data_quality_exceptions)}
              note="Material group conflicts with engineering attributes"
              tone={stats.data_quality_exceptions ? 'warn' : 'default'} />
            <MetricRow label="Records with thin DNA"
              value={num(stats.records_with_thin_dna)}
              note="Fewer than 3 attributes extractable"
              tone={stats.records_with_thin_dna ? 'warn' : 'default'} />
            <MetricRow label="Approved mappings"
              value={num(stats.approved_mappings)}
              note="Human-confirmed national code assignments" tone="good" />
            <MetricRow label="Review queue"
              value={num(stats.records_requiring_review)}
              note="Awaiting steward decision" tone="warn" />
          </div>

          <div className="mt-4 border-t border-navy-800 pt-3">
            <div className="label mb-2">Legacy Material Groups (source ERP)</div>
            <div className="flex flex-wrap gap-1.5">
              {stats.material_group_breakdown.map((group) => (
                <span key={group.material_group}
                  className="badge border-navy-700 bg-navy-850 text-slate-400">
                  {group.material_group}
                  <span className="font-mono text-slate-300">{num(group.records)}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <div className="hidden justify-center lg:flex">
      <span className="font-mono text-xl text-navy-600">→</span>
    </div>
  )
}

function MetricRow({ label, value, note, tone = 'default' }: {
  label: string
  value: string
  note: string
  tone?: 'default' | 'good' | 'warn'
}) {
  const tones = {
    default: 'text-slate-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
  }
  return (
    <div className="rounded-sm border border-navy-800 bg-navy-850/50 px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 font-mono text-base font-semibold ${tones[tone]}`}>
        {value}
      </div>
      <div className="mt-0.5 text-2xs leading-snug text-slate-500">{note}</div>
    </div>
  )
}
