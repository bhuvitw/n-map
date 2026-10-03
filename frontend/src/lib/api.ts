/** Typed client for the N-MAP FastAPI backend. */

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText} ${detail}`.trim())
  }
  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

// --- shared types --------------------------------------------------------
export type Decision =
  | 'IDENTITY_MATCH'
  | 'POTENTIAL_EQUIVALENT'
  | 'DO_NOT_MERGE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'REVIEW_REQUIRED'

export interface Dna {
  attributes: Record<string, string>
  normalized: string
  tokens: string[]
  unmapped: string[]
  signature: string
}

export interface AttributeVerdict {
  key: string
  label: string
  value_a: string | null
  value_b: string | null
  status: 'matched' | 'compatible' | 'conflicting' | 'missing'
  critical: boolean
  weight: number
  note: string | null
}

export interface Score {
  semantic_score: number
  attribute_score: number
  classification_score: number
  final_score: number
  confidence: number
  evidence_strength: number
  decision: Decision
  matched_attributes: string[]
  conflicting_attributes: string[]
  missing_attributes: string[]
  compatible_attributes: string[]
  critical_conflicts: string[]
  reasons: string[]
  attribute_verdicts: AttributeVerdict[]
}

export interface MaterialRow {
  id: number | null
  cpse_name: string
  legacy_material_code: string
  legacy_description: string
  legacy_uom: string
  legacy_material_group: string
  normalized_description: string
  dna?: Dna
  generated_standard_description?: string
  national_code?: string | null
}

export interface Candidate {
  record: MaterialRow
  dna: Dna
  score: Score
  national_code: string | null
}

export interface Recommendation {
  national_code: string
  standard_description: string
  status: string
  cpse_coverage: string[]
  record_count: number
  legacy_identity_count: number
  supporting_matches: number
}

export interface MatchResult {
  query: string
  query_dna: Dna
  interpreted_description: string
  candidates: Candidate[]
  recommendation: Recommendation
  pool_searched: number
  total_records: number
  elapsed_ms: number
}

export interface Comparison {
  material_a: MaterialRow
  material_b: MaterialRow
  score: Score
  national_code_a: string | null
  national_code_b: string | null
  same_national_identity: boolean
  recommended_national_code: string | null
}

export interface Stats {
  total_records: number
  cpse_count: number
  cpses: { cpse_name: string; records: number }[]
  unique_legacy_codes: number
  legacy_material_groups: number
  material_group_breakdown: { material_group: string; records: number }[]
  national_identities: number
  category_distribution: { category: string; records: number }[]
  uom_distribution: { uom: string; records: number }[]
  records_requiring_review: number
  review_status_counts: Record<string, number>
  approved_mappings: number
  data_quality_exceptions: number
  records_with_thin_dna: number
  description_variants: number
  flow: { stage: string; value: number }[]
}

export interface Identity {
  national_code: string
  standard_description: string
  category: string | null
  attributes: Record<string, string>
  record_count: number
  cpse_count: number
  cpses: string[]
  legacy_identity_count: number
  description_variants: number
  uoms: string[]
}

export interface GraphPayload {
  national_code: string
  standard_description: string
  category: string | null
  attributes: Record<string, string>
  record_count: number
  legacy_identity_count: number
  cpse_count: number
  cpses: {
    cpse_name: string
    record_count: number
    materials: MaterialRow[]
  }[]
}

export interface Review {
  id: number
  material_id: number
  candidate_id: number | null
  national_code: string | null
  standard_description: string | null
  decision: Decision
  confidence: number
  final_score: number
  semantic_score: number
  attribute_score: number
  classification_score: number
  status: 'Pending' | 'Approved' | 'Rejected' | 'Needs Review'
  is_demo_seed: number
  created_at: string
  updated_at: string | null
  reviewed_by: string | null
  review_note: string | null
  material: MaterialRow | null
  candidate: MaterialRow | null
}

export interface Opportunity {
  national_code: string
  standard_description: string
  category: string | null
  attributes: Record<string, string>
  cpse_coverage: number
  cpse_total: number
  cpse_coverage_label: string
  cpses: string[]
  legacy_identity_count: number
  record_count: number
  description_variants: number
  uoms: string[]
  material_groups: string[]
  standardisation_level: number
  opportunity_score: number
  opportunity: 'HIGH' | 'MEDIUM' | 'LOW'
  classifications: string[]
  reasons: string[]
  per_cpse_records: Record<string, number>
}

export interface OpportunityPayload {
  opportunities: Opportunity[]
  heatmap: {
    cpses: string[]
    rows: { national_code: string; standard_description: string; cells: number[] }[]
  }
  summary: {
    total_identities: number
    high: number
    medium: number
    low: number
    cross_cpse_identities: number
    total_legacy_identities: number
    note: string
  }
}

export interface AuditEvent {
  id: number
  timestamp: string
  actor: string
  actor_role: string | null
  action: string
  material_id: number | null
  material_label: string | null
  old_mapping: string | null
  new_mapping: string | null
  decision: string | null
  detail: string | null
  is_demo_seed: number
}

export interface Benchmark {
  harmonisation: {
    evaluated_records: number
    inferred_identities: number
    ground_truth_identities: number
    pair_true_positives: number
    pair_predicted_positives: number
    pair_actual_positives: number
    precision: number
    recall: number
    f1: number
    cluster_purity: number
    correct_assignments: number
    incorrect_assignments: number
    alignment: {
      predicted_national_code: string
      generated_standard_description: string | null
      dominant_target_code: string
      records: number
      aligned_records: number
      mixed_records: number
      purity: number
      target_breakdown: Record<string, number>
    }[]
  }
  retrieval: {
    sample_size: number
    seed: number
    correct_matches: number
    incorrect_matches: number
    missed_matches: number
    precision: number
    recall: number
    f1: number
    decision_distribution: Record<string, number>
    errors: Record<string, string | number>[]
    error_count: number
  }
  rule_stress_test: {
    total_probes: number
    correctly_rejected: number
    false_merges: number
    rejection_rate: number
    mean_semantic_score_of_probes: number
    probes_with_high_text_similarity: number
    results: {
      probe: string
      altered_attribute: string
      detail: string
      reference_cpse: string
      reference_legacy_code: string
      reference_description: string
      semantic_score: number
      final_score: number
      decision: Decision
      critical_conflicts: string[]
      correctly_rejected: boolean
      primary_reason: string | null
    }[]
    note: string
  }
  dna_coverage: {
    total_records: number
    attributes: { attribute: string; records: number; coverage: number }[]
  }
  methodology: {
    ground_truth_columns: string[]
    used_as_features: boolean
    notes: string[]
  }
  elapsed_seconds?: number
}

export interface Health {
  status: string
  records_loaded: number
  national_identities: number
  dataset: string
  startup_seconds: number
  embeddings_enabled: boolean
  database: string
}

export interface DemoQueries {
  queries: { label: string; query: string }[]
  negative_example: { label: string; query: string; explanation: string }
}

// --- endpoints -----------------------------------------------------------
export const api = {
  health: () => request<Health>('/api/health'),
  stats: () => request<Stats>('/api/stats'),
  demoQueries: () => request<DemoQueries>('/api/demo-queries'),
  identities: () => request<{ identities: Identity[] }>('/api/identities'),

  materials: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') search.set(k, String(v))
    })
    return request<{ total: number; limit: number; offset: number; materials: MaterialRow[] }>(
      `/api/materials?${search}`,
    )
  },
  material: (id: number) => request<MaterialRow & Record<string, unknown>>(`/api/materials/${id}`),

  match: (body: { query: string; top_k?: number; uom?: string; material_group?: string }) =>
    post<MatchResult>('/api/match', body),

  compareRecords: (id: number, candidateId: number) =>
    request<Comparison>(`/api/compare/${id}/${candidateId}`),
  compareQuery: (query: string, candidateId: number) =>
    post<Comparison>('/api/compare', { query, candidate_id: candidateId }),

  graph: (nationalCode: string, limitPerCpse = 4) =>
    request<GraphPayload>(`/api/graph/${nationalCode}?limit_per_cpse=${limitPerCpse}`),

  reviews: (status?: string) =>
    request<{ reviews: Review[]; status_counts: Record<string, number>; total: number }>(
      `/api/reviews${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  reviewDecision: (
    id: number,
    action: 'approve' | 'reject' | 'needs-review',
    body: { actor: string; actor_role: string; note?: string },
  ) => post<{ review_id: number; status: string; mapping_created: boolean; national_code: string; standard_description: string; message: string }>(
    `/api/reviews/${id}/${action}`, body),

  opportunities: () => request<OpportunityPayload>('/api/opportunities'),
  audit: (limit = 200) => request<{ events: AuditEvent[]; total: number }>(`/api/audit?limit=${limit}`),
  mappings: () => request<{ mappings: Record<string, string | number>[]; total: number }>('/api/mappings'),
  benchmark: (sampleSize = 300) => request<Benchmark>(`/api/benchmark?sample_size=${sampleSize}`),
}
