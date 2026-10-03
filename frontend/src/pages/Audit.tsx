import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { api, type AuditEvent } from '../lib/api'
import { formatTimestamp, num } from '../lib/format'
import { ErrorNote, Loading, Panel, StatTile } from '../components/ui'

const ACTION_STYLES: Record<string, string> = {
  MAPPING_APPROVED: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
  NATIONAL_CODE_APPROVED: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
  MAPPING_REJECTED: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
  MAPPING_FLAGGED: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  DATA_QUALITY_FLAGGED: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  CORPUS_INGESTED: 'bg-sky-500/10 border-sky-500/40 text-sky-300',
}

export default function Audit() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [mappings, setMappings] = useState<Record<string, string | number>[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    Promise.all([api.audit(300), api.mappings()])
      .then(([auditData, mappingData]) => {
        setEvents(auditData.events)
        setMappings(mappingData.mappings)
      })
      .catch(setError)
  }, [])

  if (error) return <ErrorNote error={error} />
  if (!events.length && !mappings.length) return <Loading label="Loading audit trail" />

  const actors = new Set(events.map((event) => event.actor))
  const approvals = events.filter((event) =>
    event.action === 'MAPPING_APPROVED' || event.action === 'NATIONAL_CODE_APPROVED')

  return (
    <div className="space-y-5">
      <Panel title="Audit Trail"
        subtitle="Immutable record of every harmonization decision. Required for CVC/CAG traceability.">
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">
          Each approval, rejection and data-quality flag is written to SQLite with
          the actor, their role, the previous legacy mapping and the new national
          code. Entries marked{' '}
          <span className="font-mono text-slate-500">demo seed</span> are
          generated sample history; everything else was produced by actions taken
          in this session.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Audit Events" value={num(events.length)} />
        <StatTile label="Approved Mappings" value={num(mappings.length)} accent="good" />
        <StatTile label="Approval Actions" value={num(approvals.length)} />
        <StatTile label="Distinct Actors" value={actors.size} />
      </div>

      <Panel title="Event Log" subtitle={`${events.length} events, newest first`}
        bodyClassName="!p-0">
        <div className="max-h-[560px] overflow-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th className="w-40">Timestamp</th>
                <th className="w-36">User</th>
                <th className="w-44">Action</th>
                <th>Material</th>
                <th className="w-32">Old Mapping</th>
                <th className="w-32">New Mapping</th>
                <th className="w-40">Decision</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="font-mono text-2xs text-slate-400">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td>
                    <div className="font-mono text-xs text-slate-200">{event.actor}</div>
                    <div className="text-2xs text-slate-500">{event.actor_role}</div>
                  </td>
                  <td>
                    <span className={clsx('badge',
                      ACTION_STYLES[event.action]
                      ?? 'border-navy-700 bg-navy-850 text-slate-400')}>
                      {event.action.replaceAll('_', ' ')}
                    </span>
                    {event.is_demo_seed === 1 && (
                      <div className="mt-1 text-[0.6rem] uppercase tracking-wider
                                      text-slate-600">
                        demo seed
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="font-mono text-2xs text-slate-300">
                      {event.material_label ?? '—'}
                    </div>
                    {event.detail && (
                      <div className="mt-0.5 max-w-[320px] text-2xs leading-snug
                                      text-slate-500">
                        {event.detail}
                      </div>
                    )}
                  </td>
                  <td className="font-mono text-2xs text-slate-400">
                    {event.old_mapping ?? '—'}
                  </td>
                  <td className="font-mono text-2xs text-accent-bright">
                    {event.new_mapping ?? '—'}
                  </td>
                  <td className="font-mono text-2xs text-slate-400">
                    {event.decision ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="National Mapping Register"
        subtitle="Approved legacy code → national code assignments, exportable to ERP"
        bodyClassName="!p-0">
        {mappings.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">
            No mappings approved yet. Approve a recommendation in the Approval
            Center to create the first register entry.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>CPSE</th>
                  <th>Legacy Code</th>
                  <th>National Code</th>
                  <th>Standard Description</th>
                  <th>Decision</th>
                  <th>Approved By</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={String(mapping.id)}>
                    <td className="font-mono text-xs text-slate-200">
                      {mapping.cpse_name}
                    </td>
                    <td className="font-mono text-xs text-slate-300">
                      {mapping.legacy_material_code}
                    </td>
                    <td className="font-mono text-xs font-semibold text-accent-bright">
                      {mapping.national_code}
                    </td>
                    <td className="text-2xs text-slate-400">
                      {mapping.standard_description}
                    </td>
                    <td className="font-mono text-2xs text-slate-400">
                      {mapping.decision}
                    </td>
                    <td className="font-mono text-2xs text-slate-300">
                      {mapping.approved_by}
                    </td>
                    <td className="font-mono text-2xs text-slate-500">
                      {formatTimestamp(String(mapping.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
