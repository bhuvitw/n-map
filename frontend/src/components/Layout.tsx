import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { api, type Health } from '../lib/api'

const NAV = [
  { to: '/', label: 'National Overview', short: 'Overview' },
  { to: '/match', label: 'Material Intelligence', short: 'Studio' },
  { to: '/graph', label: 'Identity Graph', short: 'Graph' },
  { to: '/review', label: 'Approval Center', short: 'Review' },
  { to: '/opportunities', label: 'Opportunity Radar', short: 'Radar' },
  { to: '/audit', label: 'Audit Trail', short: 'Audit' },
  { to: '/benchmark', label: 'Benchmark', short: 'Benchmark' },
  { to: '/architecture', label: 'ERP Integration', short: 'Architecture' },
]

/** The harmonisation pipeline, shown as a persistent context strip. */
export const WORKFLOW = [
  'CPSE DATA', 'MATERIAL DNA', 'AI MATCH', 'ENGINEERING RULES',
  'NATIONAL IDENTITY', 'HUMAN APPROVAL', 'OPPORTUNITY',
]

export function WorkflowStrip({ active }: { active?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-2xs font-medium
                    tracking-[0.1em] uppercase">
      {WORKFLOW.map((stage, index) => (
        <span key={stage} className="flex items-center gap-1">
          <span className={clsx(
            'rounded-sm border px-2 py-1',
            stage === active
              ? 'border-accent/60 bg-accent/15 text-accent-bright'
              : 'border-navy-700 bg-navy-850/70 text-slate-500',
          )}>
            {stage}
          </span>
          {index < WORKFLOW.length - 1 && (
            <span className="text-navy-600">›</span>
          )}
        </span>
      ))}
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null)
  const location = useLocation()

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-navy-700/70
                         bg-navy-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            {/* Mark: six CPSE nodes converging on one national identity */}
            <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden
              className="shrink-0">
              <circle cx="17" cy="17" r="15.5" fill="none"
                stroke="#1d2b48" strokeWidth="1" />
              {[0, 60, 120, 180, 240, 300].map((deg) => {
                const rad = (deg * Math.PI) / 180
                return (
                  <line key={deg} x1="17" y1="17"
                    x2={17 + 11 * Math.cos(rad)} y2={17 + 11 * Math.sin(rad)}
                    stroke="#27395c" strokeWidth="1" />
                )
              })}
              {[0, 60, 120, 180, 240, 300].map((deg) => {
                const rad = (deg * Math.PI) / 180
                return (
                  <circle key={deg} cx={17 + 11 * Math.cos(rad)}
                    cy={17 + 11 * Math.sin(rad)} r="1.9" fill="#4b86d4" />
                )
              })}
              <circle cx="17" cy="17" r="4" fill="#0a1020"
                stroke="#5d9bea" strokeWidth="1.5" />
            </svg>
            <div className="leading-tight">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-bold tracking-[0.18em] text-slate-50">
                  N-MAP
                </span>
                <span className="hidden text-2xs uppercase tracking-[0.14em] text-slate-500 lg:inline">
                  National Material Intelligence &amp; Opportunity Platform
                </span>
              </div>
              <div className="text-2xs text-slate-500">
                One identity. Many CPSE systems. Explainable harmonization.
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-4 text-2xs text-slate-500 xl:flex">
              <span>
                Records{' '}
                <span className="font-mono text-slate-300">
                  {health ? health.records_loaded.toLocaleString('en-IN') : '—'}
                </span>
              </span>
              <span>
                Identities{' '}
                <span className="font-mono text-slate-300">
                  {health ? health.national_identities : '—'}
                </span>
              </span>
            </div>
            <span className="badge border-navy-700 bg-navy-850 text-slate-400">
              <span className={clsx('h-1.5 w-1.5 rounded-full',
                health?.status === 'ok' ? 'bg-emerald-400' : 'bg-rose-400')} />
              {health?.status === 'ok' ? 'Engine Online' : 'Engine Offline'}
            </span>
          </div>
        </div>

        <nav className="mx-auto max-w-[1600px] overflow-x-auto px-5">
          <ul className="flex items-stretch gap-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.to === '/'}
                  className={({ isActive }) => clsx(
                    'block whitespace-nowrap border-b-2 px-3 py-2 text-2xs font-semibold',
                    'uppercase tracking-[0.1em] transition-colors',
                    isActive
                      ? 'border-accent text-slate-100'
                      : 'border-transparent text-slate-500 hover:text-steel-300',
                  )}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>

      <footer className="mx-auto max-w-[1600px] px-5 pb-8 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3
                        border-t border-navy-800 pt-4 text-2xs text-slate-600">
          <span>
            N-MAP prototype · SIH PS 26099 · AI-driven standardization and
            harmonization of material codes across CPSEs
          </span>
          <span className="font-mono">
            {health?.dataset ? health.dataset.split('/').slice(-1)[0] : 'dataset'}
            {health?.embeddings_enabled ? ' · embeddings on' : ' · tf-idf + rapidfuzz'}
          </span>
        </div>
      </footer>
    </div>
  )
}
