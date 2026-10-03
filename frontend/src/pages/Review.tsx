import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api, type Comparison, type Review as ReviewRow } from '../lib/api'
import { STATUS_STYLES, formatTimestamp, num, pct } from '../lib/format'
import {
  DecisionBadge, DnaVerdictTable, ErrorNote, Loading, Panel, ScorePanel,
  WhyMatch,
} from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

const ROLES = ['Data Steward', 'Engineer', 'Admin'] as const
const STATUSES = ['All', 'Pending', 'Needs Review', 'Approved', 'Rejected'] as const

export default function Review() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('All')
  const [selected, setSelected] = useState<ReviewRow | null>(null)
  const [evidence, setEvidence] = useState<Comparison | null>(null)
  const [actor, setActor] = useState('a.narayanan')
  const [role, setRole] = useState<(typeof ROLES)[number]>('Data Steward')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    api.reviews(filter === 'All' ? undefined : filter)
      .then((data) => {
        setRows(data.reviews)
        setCounts(data.status_counts)
      })
      .catch(setError)
  }, [filter])

  useEffect(() => { load() }, [load])

  // Load the comparison evidence for the selected row.
  useEffect(() => {
    if (!selected?.material_id || !selected?.candidate_id) {
      setEvidence(null)
      return
    }
    setEvidence(null)
    api.compareRecords(selected.material_id, selected.candidate_id)
      .then(setEvidence)
      .catch(() => setEvidence(null))
  }, [selected])

  const decide = async (action: 'approve' | 'reject' | 'needs-review') => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await api.reviewDecision(selected.id, action, {
        actor, actor_role: role, note: note || undefined,
      })
      setToast(
        action === 'approve'
          ? `Approved · ${result.national_code} mapping created and audit event written`
          : result.message,
      )
      setNote('')
      setSelected(null)
      load()
      setTimeout(() => setToast(null), 6000)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorNote error={error} />

  return (
    <div className="space-y-5">
      <Panel title="Approval Center"
        subtitle="AI recommendations awaiting human adjudication. Approving writes a mapping and an audit event."
        actions={
          <div className="flex items-center gap-2">
            <input value={actor} onChange={(event) => setActor(event.target.value)}
              className="input !w-36 !py-1 !text-xs font-mono" aria-label="Reviewer" />
            <select value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
              className="input !w-auto !py-1 !text-xs" aria-label="Role">
              {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        }>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((status) => {
            const count = status === 'All'
              ? Object.values(counts).reduce((sum, value) => sum + value, 0)
              : counts[status] ?? 0
            return (
              <button key={status} type="button" onClick={() => setFilter(status)}
                className={clsx('rounded-sm border px-2.5 py-1 text-2xs font-semibold',
                  'uppercase tracking-wider transition-colors',
                  filter === status
                    ? 'border-accent/60 bg-accent/15 text-accent-bright'
                    : 'border-navy-700 bg-navy-850 text-slate-400 hover:text-slate-200')}>
                {status}
                <span className="ml-1.5 font-mono text-slate-500">{count}</span>
              </button>
            )
          })}
        </div>
      </Panel>

      {toast && (
        <div className="panel border-emerald-500/50 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-emerald-300">✓</span>
            <p className="text-xs font-semibold text-emerald-200">{toast}</p>
            <Link to="/audit" className="btn-ghost ml-auto !py-1">View audit trail</Link>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title="Recommendation Queue" subtitle={`${rows.length} items`}
          bodyClassName="!p-0">
          <div className="max-h-[640px] overflow-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Proposed Identity</th>
                  <th className="w-20">Conf.</th>
                  <th>Decision</th>
                  <th className="w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}
                    onClick={() => setSelected(row)}
                    className={clsx('cursor-pointer',
                      selected?.id === row.id && '!bg-accent/10')}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-slate-200">
                        {row.material?.cpse_name} / {row.material?.legacy_material_code}
                      </div>
                      <div className="mt-0.5 max-w-[220px] truncate font-mono
                                      text-2xs text-slate-500"
                        title={row.material?.legacy_description}>
                        {row.material?.legacy_description}
                      </div>
                    </td>
                    <td>
                      <div className="font-mono text-xs text-accent-bright">
                        {row.national_code}
                      </div>
                      <div className="mt-0.5 max-w-[200px] truncate text-2xs text-slate-500">
                        {row.standard_description}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs tabular-nums text-slate-200">
                        {pct(row.confidence, 0)}
                      </span>
                    </td>
                    <td><DecisionBadge decision={row.decision} /></td>
                    <td>
                      <span className={clsx('badge', STATUS_STYLES[row.status])}>
                        {row.status}
                      </span>
                      {row.is_demo_seed === 1 && (
                        <div className="mt-1 text-[0.6rem] uppercase tracking-wider
                                        text-slate-600">
                          demo seed
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="!py-6 text-center text-xs text-slate-500">
                      No recommendations with this status.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Evidence Panel"
          subtitle={selected
            ? `Review #${selected.id} · ${selected.material?.cpse_name}`
            : 'Select a recommendation to inspect its evidence'}>
          {!selected ? (
            <p className="text-xs leading-relaxed text-slate-400">
              Every recommendation in this queue was produced by the live engine
              over the loaded corpus — the scores and attribute evidence shown
              here are the engine's actual output, not stored sample text.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-sm border border-navy-800 bg-navy-850/50 p-3">
                  <div className="label">Legacy material</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-slate-100">
                    {selected.material?.cpse_name} / {selected.material?.legacy_material_code}
                  </div>
                  <p className="mt-1 font-mono text-2xs leading-relaxed text-slate-400">
                    {selected.material?.legacy_description}
                  </p>
                </div>
                <div className="rounded-sm border border-navy-800 bg-navy-850/50 p-3">
                  <div className="label">Matched against</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-slate-100">
                    {selected.candidate?.cpse_name} / {selected.candidate?.legacy_material_code}
                  </div>
                  <p className="mt-1 font-mono text-2xs leading-relaxed text-slate-400">
                    {selected.candidate?.legacy_description}
                  </p>
                </div>
              </div>

              <div className="rounded-sm border border-navy-800 bg-navy-850/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="label">Proposed national identity</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-accent-bright">
                      {selected.national_code}
                    </div>
                    <p className="text-2xs text-slate-400">
                      {selected.standard_description}
                    </p>
                  </div>
                  <DecisionBadge decision={selected.decision} large />
                </div>
              </div>

              {evidence ? (
                <>
                  <ScorePanel score={evidence.score} />
                  <div>
                    <div className="label mb-1.5">Why this decision?</div>
                    <WhyMatch score={evidence.score} />
                  </div>
                  <div className="-mx-4 border-y border-navy-800">
                    <DnaVerdictTable score={evidence.score}
                      leftLabel={`A · ${evidence.material_a.cpse_name}`}
                      rightLabel={`B · ${evidence.material_b.cpse_name}`} />
                  </div>
                  {selected.material_id && selected.candidate_id && (
                    <Link
                      to={`/compare/${selected.material_id}/${selected.candidate_id}`}
                      className="btn-ghost w-full">
                      Open full comparison view
                    </Link>
                  )}
                </>
              ) : <Loading label="Loading evidence" />}

              <div className="border-t border-navy-800 pt-3">
                <label htmlFor="note" className="label">
                  Reviewer note (written to the audit trail)
                </label>
                <input id="note" value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Verified against ASTM A106 datasheet"
                  className="input mt-1.5 !text-xs" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" disabled={busy}
                    onClick={() => decide('approve')} className="btn-approve">
                    Approve
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => decide('reject')} className="btn-reject">
                    Reject
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => decide('needs-review')} className="btn-flag">
                    Needs Review
                  </button>
                </div>
                <p className="mt-2 text-2xs text-slate-500">
                  Acting as <span className="font-mono text-slate-400">{actor}</span>{' '}
                  ({role}). Approval creates a mapping record in SQLite and an
                  immutable audit event.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Pipeline Stage">
        <WorkflowStrip active="HUMAN APPROVAL" />
      </Panel>
    </div>
  )
}
