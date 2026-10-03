import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { Decision, Dna, Score } from '../lib/api'
import {
  ATTRIBUTE_LABELS, ATTRIBUTE_STATUS_STYLES, DECISION_STYLES,
  attributeValue, dnaEntries, pct,
} from '../lib/format'

export function Panel({
  title, subtitle, actions, children, className, bodyClassName,
}: {
  title?: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx('panel', className)}>
      {title && (
        <header className="panel-header">
          <div className="min-w-0">
            <h2 className="panel-title">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-2xs text-slate-500 truncate">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function StatTile({
  label, value, hint, accent,
}: {
  label: string
  value: ReactNode
  hint?: string
  accent?: 'default' | 'warn' | 'good' | 'alert'
}) {
  const accents = {
    default: 'text-slate-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    alert: 'text-rose-300',
  }
  return (
    <div className="panel px-4 py-3">
      <div className="label">{label}</div>
      <div className={clsx('mt-1.5 font-mono text-2xl font-semibold tabular-nums',
        accents[accent ?? 'default'])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-2xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function DecisionBadge({ decision, large }: { decision: Decision; large?: boolean }) {
  const style = DECISION_STYLES[decision]
  if (!style) return null
  return (
    <span className={clsx('badge', style.className,
      large && 'px-3 py-1.5 text-xs tracking-[0.1em]')}>
      <span className={clsx('inline-block rounded-full',
        large ? 'h-2 w-2' : 'h-1.5 w-1.5', style.dot)} />
      {style.label}
    </span>
  )
}

/** Horizontal score meter with the numeric value alongside. */
export function ScoreBar({
  label, value, tone = 'accent',
}: {
  label: string
  value: number
  tone?: 'accent' | 'good' | 'warn' | 'bad'
}) {
  const tones = {
    accent: 'bg-accent',
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-rose-500',
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-mono text-xs font-semibold text-slate-200
                         tabular-nums">
          {value.toFixed(3)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-navy-800">
        <div className={clsx('h-full rounded-sm transition-all', tones[tone])}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
    </div>
  )
}

/** The four sub-scores of a comparison, shown together. */
export function ScorePanel({ score }: { score: Score }) {
  return (
    <div className="grid gap-2.5">
      <ScoreBar label="Semantic / Text" value={score.semantic_score} />
      <ScoreBar label="Attribute (DNA)" value={score.attribute_score} />
      <ScoreBar label="Classification" value={score.classification_score} />
      <ScoreBar
        label="Final Score"
        value={score.final_score}
        tone={score.decision === 'DO_NOT_MERGE' ? 'bad'
          : score.decision === 'IDENTITY_MATCH' ? 'good' : 'warn'}
      />
    </div>
  )
}

/** Material DNA rendered as attribute chips. */
export function DnaChips({ dna, emptyNote }: { dna: Dna; emptyNote?: string }) {
  const entries = dnaEntries(dna.attributes)
  if (!entries.length) {
    return (
      <p className="text-xs text-slate-500">
        {emptyNote ?? 'No engineering attributes could be extracted.'}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span key={key}
          className="inline-flex items-baseline gap-1.5 rounded-sm border
                     border-navy-700 bg-navy-850 px-2 py-1">
          <span className="text-2xs uppercase tracking-wider text-slate-500">
            {ATTRIBUTE_LABELS[key] ?? key}
          </span>
          <span className="font-mono text-xs font-semibold text-slate-100">
            {attributeValue(key, value)}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Side-by-side DNA comparison table with per-field verdicts. */
export function DnaVerdictTable({ score, leftLabel, rightLabel }: {
  score: Score
  leftLabel: string
  rightLabel: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="dtable">
        <thead>
          <tr>
            <th className="w-[22%]">Attribute</th>
            <th className="w-[29%]">{leftLabel}</th>
            <th className="w-[29%]">{rightLabel}</th>
            <th className="w-[20%]">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {score.attribute_verdicts.map((verdict) => {
            const style = ATTRIBUTE_STATUS_STYLES[verdict.status]
            return (
              <tr key={verdict.key}
                className={clsx(verdict.status === 'conflicting' && verdict.critical
                  && 'bg-rose-500/5')}>
                <td>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-300">{verdict.label}</span>
                    {verdict.critical && (
                      <span className="rounded-sm border border-navy-600 bg-navy-800
                                       px-1 text-[0.6rem] font-semibold uppercase
                                       tracking-wider text-steel-400"
                        title="Critical engineering attribute">
                        crit
                      </span>
                    )}
                  </div>
                </td>
                <td className="font-mono text-xs text-slate-200">
                  {verdict.value_a
                    ? attributeValue(verdict.key, verdict.value_a)
                    : <span className="text-slate-600">not stated</span>}
                </td>
                <td className="font-mono text-xs text-slate-200">
                  {verdict.value_b
                    ? attributeValue(verdict.key, verdict.value_b)
                    : <span className="text-slate-600">not stated</span>}
                </td>
                <td>
                  <span className={clsx('flex items-center gap-1.5 text-xs font-semibold',
                    style.className)}>
                    <span className="font-mono">{style.mark}</span>
                    {style.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** "Why match?" evidence block. */
export function WhyMatch({ score, compact }: { score: Score; compact?: boolean }) {
  const matched = score.attribute_verdicts.filter((v) => v.status === 'matched')
  const compatible = score.attribute_verdicts.filter((v) => v.status === 'compatible')
  const conflicting = score.attribute_verdicts.filter((v) => v.status === 'conflicting')
  const missing = score.attribute_verdicts.filter((v) => v.status === 'missing')

  const Group = ({ items, status }: { items: typeof matched; status: string }) => {
    if (!items.length) return null
    const style = ATTRIBUTE_STATUS_STYLES[status]
    return (
      <>
        {items.map((v) => (
          <span key={v.key}
            className={clsx('inline-flex items-center gap-1 text-2xs font-medium',
              style.className)}>
            <span className="font-mono">{style.mark}</span>
            {v.label}
            {status === 'conflicting' && (
              <span className="font-mono text-slate-400">
                ({v.value_a} vs {v.value_b})
              </span>
            )}
          </span>
        ))}
      </>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Group items={matched} status="matched" />
        <Group items={compatible} status="compatible" />
        <Group items={conflicting} status="conflicting" />
        {!compact && <Group items={missing} status="missing" />}
      </div>
      {!compact && score.reasons.length > 0 && (
        <ul className="mt-3 space-y-1">
          {score.reasons.map((reason, index) => (
            <li key={index}
              className={clsx('flex gap-2 text-xs leading-relaxed',
                index === 0 && score.critical_conflicts.length
                  ? 'font-semibold text-rose-300' : 'text-slate-400')}>
              <span className="text-slate-600">—</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-xs uppercase tracking-widest text-slate-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-navy-600
                       border-t-accent" />
      {label}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="panel border-rose-500/40 bg-rose-500/5 p-4">
      <div className="label text-rose-300">Request failed</div>
      <p className="mt-1 font-mono text-xs text-rose-200/90">{message}</p>
      <p className="mt-2 text-2xs text-slate-400">
        Confirm the backend is running: <code className="font-mono">uvicorn app.main:app --reload</code>
      </p>
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="p-4 text-xs text-slate-500">{children}</p>
}

/** Confidence / evidence readout used on cards. */
export function ConfidenceMeta({ score }: { score: Score }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-slate-500">
      <span>Confidence <span className="font-mono text-slate-300">{pct(score.confidence)}</span></span>
      <span>Evidence <span className="font-mono text-slate-300">{pct(score.evidence_strength)}</span></span>
      <span>Final <span className="font-mono text-slate-300">{score.final_score.toFixed(3)}</span></span>
    </div>
  )
}
