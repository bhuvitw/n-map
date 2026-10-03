import type { Decision } from './api'

/** Visual treatment per decision state. */
export const DECISION_STYLES: Record<Decision, { label: string; className: string; dot: string }> = {
  IDENTITY_MATCH: {
    label: 'Identity Match',
    className: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  POTENTIAL_EQUIVALENT: {
    label: 'Potential Equivalent',
    className: 'bg-sky-500/10 border-sky-500/40 text-sky-300',
    dot: 'bg-sky-400',
  },
  REVIEW_REQUIRED: {
    label: 'Review Required',
    className: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
    dot: 'bg-amber-400',
  },
  INSUFFICIENT_EVIDENCE: {
    label: 'Insufficient Evidence',
    className: 'bg-slate-500/10 border-slate-500/40 text-slate-300',
    dot: 'bg-slate-400',
  },
  DO_NOT_MERGE: {
    label: 'Do Not Merge',
    className: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
    dot: 'bg-rose-400',
  },
}

export const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-sky-500/10 border-sky-500/40 text-sky-300',
  Approved: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
  Rejected: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
  'Needs Review': 'bg-amber-500/10 border-amber-500/40 text-amber-300',
}

export const ATTRIBUTE_STATUS_STYLES: Record<string, { className: string; mark: string; label: string }> = {
  matched: { className: 'text-emerald-300', mark: '✓', label: 'Match' },
  compatible: { className: 'text-sky-300', mark: '≈', label: 'Compatible' },
  conflicting: { className: 'text-rose-300', mark: '✕', label: 'Conflict' },
  missing: { className: 'text-slate-500', mark: '–', label: 'Not stated' },
}

export const OPPORTUNITY_STYLES: Record<string, string> = {
  HIGH: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
  MEDIUM: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  LOW: 'bg-slate-500/10 border-slate-500/40 text-slate-300',
}

export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`

export const num = (value: number) => value.toLocaleString('en-IN')

/** Attribute keys that are provenance/context rather than engineering DNA. */
const NON_DNA_KEYS = new Set([
  'uom', 'uom_family', 'material_group', 'data_quality_flag', 'body_spec',
])

export function dnaEntries(attributes: Record<string, string>) {
  return Object.entries(attributes).filter(
    ([key]) => !key.endsWith('_source') && !NON_DNA_KEYS.has(key),
  )
}

export const ATTRIBUTE_LABELS: Record<string, string> = {
  category: 'Category',
  material: 'Material',
  standard: 'Standard',
  grade: 'Grade',
  construction: 'Construction',
  valve_type: 'Valve Type',
  size_inch: 'Nominal Size',
  thickness_mm: 'Thickness',
  pressure_class: 'Pressure Class',
  cores: 'Cores',
  cross_section_sqmm: 'Cross Section',
  model: 'Model',
  manufacturer: 'Manufacturer',
  end_connection: 'End Connection',
}

/** Render an attribute value with its engineering unit. */
export function attributeValue(key: string, value: string) {
  switch (key) {
    case 'size_inch':
      return `${value}"`
    case 'thickness_mm':
      return `${value} mm`
    case 'cross_section_sqmm':
      return `${value} sq mm`
    case 'cores':
      return `${value} core`
    default:
      return value
  }
}

export const formatTimestamp = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
