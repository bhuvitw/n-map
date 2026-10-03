# N-MAP — National Material Intelligence & Opportunity Platform

**One identity. Many CPSE systems. Explainable harmonization.**

A working prototype for **SIH Problem Statement 26099** — AI-driven
standardization and harmonization of material codes across CPSEs.

Six public-sector enterprises each record the same physical material in their
own words. The same seamless carbon steel pipe is `CARBON SMLS IN ASTM GRADE
A106 4 B PIPE STEEL` in one system and `PIPE, SEAMLESS, CARBON, STEEL, ASTM,
A106, GR, B, 4, ''` in another. N-MAP resolves these into a single national
material identity — and, critically, explains and defends every decision it
makes.

---

## Project overview

N-MAP ingests legacy CPSE material-master records and produces:

- **Material DNA** — a structured engineering fingerprint for every description
- **A national material identity** per distinct physical material, with a
  deterministic national code and a synthesised standard description
- **An explainable decision** for every match, with the attribute evidence
  behind it
- **A human approval workflow** that writes mappings and an audit trail
- **An opportunity view** showing where cross-CPSE rationalisation is possible

### Results on the supplied dataset

| Measure | Result |
|---|---|
| Legacy records ingested | 5,000 across 6 CPSEs |
| Distinct free-text descriptions | 3,408 |
| National identities inferred | **5** (ground truth: 5) |
| Harmonisation precision / recall / F1 | **1.000 / 1.000 / 1.000** |
| Cluster purity | 100% across all 5,000 records |
| Hard-negative rejection rate | **12/12 (100%)** |
| Data-quality exceptions detected | 4 mis-filed source records |
| Search latency | ~35 ms over 5,000 records |
| Cold start | ~2.4 s |

Precision/recall/F1 are **exact pairwise metrics over all ~12.5M record pairs**,
computed from the contingency table between inferred identities and the
held-out labels — not sampled, not hardcoded.

> **Read the perfect score honestly.** This dataset contains five
> well-separated material concepts, so a clean clustering sheet is the expected
> outcome, not proof of production accuracy. The **engineering-rule stress
> test** is the demanding measurement — see below.

---

## Architecture

```
CSV / API / SAP  →  ingestion  →  harmonization core  →  national master  →  mapping export
                                        │
                     ┌──────────────────┴──────────────────┐
                     │  normalization                      │
                     │  Material DNA extraction            │
                     │  candidate retrieval (TF-IDF)       │
                     │  hybrid similarity scoring          │
                     │  engineering rules                  │
                     └─────────────────────────────────────┘
```

```
backend/
  app/
    main.py            FastAPI app and all endpoints
    ingest.py          CSV loading + startup precomputation
    db.py              SQLite schema (materials, mappings, reviews, audit_events)
    seed.py            Review queue + audit seeding (from real engine output)
    nmap/
      vocab.py         Engineering vocabulary (abbreviations, standards, criticality)
      normalize.py     Text normalization
      dna.py           Material DNA extraction
      scoring.py       Explainable scoring + engineering-rule decision layer
      identity.py      National identity clustering + code generation
      engine.py        Retrieval indexes and orchestration
      opportunity.py   Opportunity Radar scoring
      benchmark.py     Reproducible evaluation (the only module reading labels)
  data/                Dataset CSVs + SQLite database
frontend/
  src/
    pages/             Overview, Studio, Compare, Graph, Review, Opportunities,
                       Audit, Benchmark, Architecture
    components/        Layout + shared UI primitives
    lib/               Typed API client and formatters
```

The material master is held **in memory** and rebuilt from CSV on startup.
SQLite persists what must survive a restart: human decisions, mappings and the
audit trail.

---

## The Material DNA concept

Text matching alone cannot safely harmonise a material master. `4 inch pipe`
and `6 inch pipe` are ~95% similar as text and must never be merged. So N-MAP
converts every description into a structured engineering fingerprint first:

```
"CARBON SMLS IN ASTM GRADE A106 4 B PIPE STEEL"
   ↓
category     PIPE
material     CARBON STEEL
standard     ASTM A106
grade        B
construction SEAMLESS
size_inch    4
```

### Why extraction is order-independent

Legacy descriptions in this dataset arrive with their **token order shuffled**,
delimiters swapped, abbreviations applied (`SMLS`, `BRG`, `VLV`, `THK`, `ARMD`,
`COPR`), the inch symbol mangled into `''` or `"`, and attributes silently
dropped. Positional regex (`"4 INCH"` as adjacent words) fails on all of it.

Instead the extractor treats the description as a **bag of tokens** and resolves
numeric slots by pairing them with unit markers and known engineering value
dictionaries, consuming each number once in order of decreasing specificity:

1. category (text → attribute evidence → ERP group, in that order of trust)
2. standard — matched from a dictionary of known standard numbers, because
   `ASTM` and `A106` are frequently separated by shuffling
3. pressure class → 4. cores → 5. cross-section → 6. thickness →
   7. bearing model → 8. nominal size

Order matters: cores are claimed before cross-section so that a shuffled
`SQMM 3 CORE 2.5` cannot read the core count as the conductor area. Standard
conductor sizes exclude `3`, which disambiguates the pair even when the `CORE`
marker is missing.

Attributes recovered without an explicit marker are tagged
`*_source: "inferred"` so the UI can stay honest about provenance.

### Data-quality detection

When the ERP material group contradicts the engineering evidence, N-MAP trusts
the description and raises an exception. On this dataset it flags 4 records
filed under *Structural Steel* whose descriptions read `SEAMLESS … ASTM A106 …
4 IN` and whose UOM is `MTR` — all four are genuinely pipes, and the held-out
label agrees.

---

## AI matching approach

Local, lightweight, no external APIs, no mandatory model download.

**Candidate retrieval** — TF-IDF over the precomputed corpus:
- word 1–2 grams (engineering terms)
- `char_wb` 3–5 grams (absorbs residual spelling/abbreviation drift)
- top 200 pooled per query

**Similarity scoring** — three transparent components:

| Component | Weight | What it measures |
|---|---|---|
| `semantic_score` | 0.40 | word cosine (0.45) + char cosine (0.30) + RapidFuzz `token_set_ratio` on an order-insensitive signature (0.25) |
| `attribute_score` | 0.40 | weighted agreement across Material DNA attributes |
| `classification_score` | 0.20 | category, ERP material group and UOM-family agreement |

```
final_score = 0.40·semantic + 0.40·attribute + 0.20·classification
```

**Subsumption, not conflict.** `STEEL` vs `CARBON STEEL`, `BALL` vs `DEEP
GROOVE`, and `ASTM` vs `ASTM A106` are *generalisations* — one side is less
specific, not contradictory. These earn partial credit (0.7) and are reported
as `compatible`. This is what lets degraded descriptions collapse onto the
richest signature instead of fragmenting into spurious identities.

**Optional embeddings.** If `sentence-transformers` is installed and
`NMAP_ENABLE_EMBEDDINGS=true`, embedding cosine is blended in as a fourth
signal. Off by default — the prototype never blocks on a model download.

---

## Decision logic

Scoring proposes; **engineering rules decide.** Rules are applied in order of
authority, and a critical conflict overrides any score:

| State | Trigger | Meaning |
|---|---|---|
| `IDENTITY_MATCH` | score ≥ 0.90, no conflicts, strong evidence | Safe to merge |
| `POTENTIAL_EQUIVALENT` | score ≥ 0.72 | Merge after steward confirmation |
| `REVIEW_REQUIRED` | score ≥ 0.55 | Route to an engineer |
| `INSUFFICIENT_EVIDENCE` | evidence < 0.45 or < 2 comparable critical attributes | Enrich the source description first |
| `DO_NOT_MERGE` | **any critical attribute conflicts**, or score too low | Blocked regardless of text similarity |

Critical attributes are defined per category — for a pipe: size, standard,
grade, construction, material; for a cable: cores, cross-section, material.
Substitutable attributes (manufacturer, end connection) downgrade confidence
instead of blocking.

Every comparison returns a transparent score object:

```json
{
  "semantic_score": 0.569, "attribute_score": 0.770,
  "classification_score": 1.000, "final_score": 0.736,
  "confidence": 0.900, "evidence_strength": 0.829,
  "decision": "DO_NOT_MERGE",
  "matched_attributes": ["Category", "Standard", "Grade", "Construction / Type"],
  "conflicting_attributes": ["Nominal Size"],
  "critical_conflicts": ["Nominal Size"],
  "missing_attributes": ["Material"],
  "reasons": ["Critical attribute mismatch: Nominal Size", "Nominal Size: 6 vs 4"]
}
```

### National codes

Approved identities receive a deterministic code derived from the DNA
signature: `NAT-<CATEGORY>-<3-digit SHA1 hash>`, e.g. `NAT-PIPE-407`.

The hidden `Target_National_Code` is **never** copied into a recommendation.
Codes are generated from engineering attributes alone, so identical DNA
anywhere in the country resolves to the identical code. The benchmark page
shows the inferred codes mapping 1:1 onto the ground-truth codes — different
strings, same partition.

---

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Engine status, record count, dataset in use |
| `GET /api/stats` | National overview metrics and pipeline funnel |
| `GET /api/materials` | Browse/filter legacy records |
| `GET /api/materials/{id}` | One record with DNA and national identity |
| `POST /api/match` | Natural-language search → interpreted DNA + scored candidates |
| `POST /api/compare` | Compare two records, or a free-text query against a record |
| `GET /api/compare/{id}/{candidateId}` | Record-to-record comparison |
| `GET /api/identities` | All inferred national identities |
| `GET /api/graph/{nationalCode}` | Identity → CPSE → legacy material graph |
| `GET /api/reviews` | Recommendation queue |
| `POST /api/reviews/{id}/approve` | Approve → creates mapping + audit event |
| `POST /api/reviews/{id}/reject` | Reject → audit event |
| `POST /api/reviews/{id}/needs-review` | Flag for engineering review |
| `GET /api/mappings` | Approved legacy → national crosswalk |
| `GET /api/opportunities` | Opportunity Radar + CPSE heatmap |
| `GET /api/audit` | Audit trail |
| `GET /api/benchmark` | Reproducible evaluation report |
| `GET /api/demo-queries` | Curated demo queries |

Interactive docs: `http://localhost:8000/docs`

---

## Setup

Requires Python 3.10+ and Node 18+.

**Backend**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

On first start it initialises SQLite, loads the CSV, precomputes normalisation
and Material DNA for all 5,000 records, builds the TF-IDF indexes, infers
national identities and seeds the review queue from real engine output
(~2.4 s).

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to port 8000.

Copy `.env.example` to `.env` in either directory to override defaults; the
prototype runs with no configuration.

---

## Deployment

The production image is **single-origin**: the React console is built and then
served by FastAPI itself, so there is one URL, no CORS configuration and no API
base URL to set. The API client already falls back to same-origin requests
(`frontend/src/lib/api.ts`), so nothing needs rewiring.

```
https://<your-service>.onrender.com
  ├─ /          → React console
  ├─ /api/*     → FastAPI
  └─ /docs      → Swagger
```

### Run the production image locally

```bash
docker build -t n-map .
docker run --rm -p 8080:8000 n-map
```

Open <http://localhost:8080>.

### Deploy to Render

1. Push this repository to GitHub.
2. <https://render.com> → **New → Web Service** → connect the repo.
3. Render detects the `Dockerfile` (or use **Blueprint**, which reads
   `render.yaml`). Runtime **Docker**, plan **Free**, health check
   **`/api/health`**.
4. **Create Web Service.** The first build takes roughly 5–8 minutes; later
   pushes to `main` auto-deploy.

No environment variables are required — the defaults are correct for a
single-origin deployment.

### Two things to know before a live demo

- **Free instances sleep after ~15 minutes idle**, and the next request takes
  roughly 50 seconds to wake the service. Open the URL a couple of minutes
  before presenting, keep it warm with a free cron pinger against
  `/api/health`, or use a paid instance type to disable sleeping.
- **SQLite is ephemeral** on Render's filesystem. Approvals made during a
  session are lost on restart or redeploy, and the review queue and audit trail
  re-seed from the engine at startup. For a demo this is desirable — every
  visitor gets a clean queue. Durable decisions would need a Render Disk or
  Postgres.

Free-tier CPU is shared, so `/api/benchmark` and search are slower than the
~4 s / ~50 ms measured locally.

---

## Demo flow (under 3 minutes)

1. **National Overview** (`/`) — 5,000 records, 6 CPSEs, 3,408 description
   variants reduced to 5 national identities.
2. **Material Intelligence Studio** (`/match`) — search
   `A106 grade B seamless pipe 4 inch`.
3. **Material DNA** — the interpreted query resolves to category `PIPE`,
   standard `ASTM A106`, grade `B`, construction `SEAMLESS`, size `4"`.
4. **Top CPSE matches** — candidates from BHEL, CIL, GAIL, NTPC, ONGC, SAIL,
   each with a decision and a "why match?" attribute breakdown.
5. **Comparison** — click **Compare** on any candidate for the full
   side-by-side DNA table.
6. **National code recommendation** — `NAT-PIPE-407`, held by 6/6 CPSEs.
7. **Approve it** — Approval Center → Approve → a mapping and audit event are
   written to SQLite.
8. **Identity Graph** (`/graph`) — trace the national code back to each CPSE's
   legacy code and original wording.
9. **Opportunity Radar** (`/opportunities`) — cross-CPSE coverage,
   duplicate legacy identities and the CPSE heatmap.
10. **The negative example** — back in the Studio, click
    **⚠ Negative: 6 inch variant**, then Compare. Text similarity is 0.569 and
    the standard, grade and construction all match — but nominal size is 6"
    vs 4", so the verdict is **DO NOT MERGE**:
    *"Critical attribute mismatch: Nominal Size."*
11. **Benchmark** (`/benchmark`) — precision/recall/F1, the identity alignment
    matrix, and the 12/12 engineering-rule stress test.

---

## Benchmark methodology

The matching engine receives only `Legacy_Description`, `Legacy_UOM` and
`Legacy_Material_Group`. `Target_National_Code` and
`Target_Standard_Description` are read **only** inside `app/nmap/benchmark.py`.

Three measurements:

1. **Harmonisation quality** — exact pairwise precision/recall/F1 over every
   record pair, from the contingency table of inferred identities vs
   ground-truth codes. No sampling.
2. **Retrieval quality** — for a seeded random sample, each record searches the
   rest of the corpus; the top-1 match is checked against the labels. Fixed
   seed (42) makes runs reproducible.
3. **Engineering-rule stress test** — 12 engineered hard negatives, each
   altering exactly one critical attribute while keeping the wording nearly
   identical (6" vs 4" pipe, Class 300 vs 150 valve, 6305 vs 6205 bearing,
   4-core vs 3-core cable, 12mm vs 10mm plate, aluminium vs copper). Mean text
   similarity of these probes is **0.728** — a text-similarity-only matcher
   would merge them. N-MAP rejects **12 of 12**.

Reproduce from the CLI:

```bash
curl "localhost:8000/api/benchmark?sample_size=300&seed=42"
```

This stress test earned its place during development: it caught a real bug
where the abbreviation map expanded a bare `C` to `CORE`, destroying the grade
letter in `ASTM A106 Grade C` and causing a false merge.

---

## Limitations

This is a hackathon prototype, and these boundaries are deliberate:

- **No SAP/ERP integration.** No simulated connector, no write-back. Export is
  a read-only REST crosswalk. See `/architecture` for where a real adapter
  attaches.
- **No monetary savings estimates.** The dataset contains no spend, price or
  quantity data, so any rupee figure would be fabricated. Opportunity is scored
  on CPSE coverage, legacy-code duplication and description fragmentation only.
- **Vocabulary coverage.** The engineering vocabulary covers the five material
  families in this dataset (pipes, valves, bearings, cables, plates). It is a
  data file (`nmap/vocab.py`), not hardcoded logic, and extends without
  touching the engine — but a national rollout needs a far larger, curated
  taxonomy.
- **Benchmark optimism.** Five well-separated concepts make perfect clustering
  achievable. Real material masters have thousands of overlapping categories,
  near-duplicate grades and genuinely ambiguous records.
- **In-memory master.** The corpus is rebuilt from CSV at startup; it is not a
  durable system of record. Only human decisions persist.
- **Single-node.** No authentication, no RBAC, no concurrency control. The
  reviewer identity is typed into the UI rather than authenticated.
- **Synthetic data.** Descriptions are generated variants, not real CPSE
  extracts.

---

## Future SAP / ERP integration approach

1. **Ingestion adapters.** The harmonisation core consumes a canonical material
   record, so each source needs only an adapter: SAP MM/S4HANA via OData or
   RFC/BAPI (`BAPI_MATERIAL_GET_DETAIL`), Oracle EBS via its item master
   tables, or scheduled flat-file extracts. The engine does not change.
2. **Delta capture.** Move from a full CSV load to change-data-capture on
   material-master updates, re-running DNA extraction only for changed records.
3. **Classification alignment.** Map Material DNA onto UNSPSC / NIC / a national
   material taxonomy so national codes carry an official classification.
4. **Write-back.** Publish approved mappings to source systems as a classified
   characteristic or cross-reference table (SAP IDoc or BAPI), keeping legacy
   codes valid while the national code becomes the reporting key.
5. **Governance.** Replace the prototype's typed reviewer identity with SSO and
   RBAC (Data Steward / Engineer / Admin), and retain the audit trail as the
   CVC/CAG evidence record.
6. **Scale.** Swap the in-memory TF-IDF index for a vector store (FAISS,
   pgvector) with approximate nearest-neighbour search, and the in-memory
   master for Postgres, once the corpus reaches millions of records.

---

## Tech stack

**Backend** — Python 3.12, FastAPI, Uvicorn, scikit-learn (TF-IDF), RapidFuzz,
NumPy, SQLite. Optional sentence-transformers.

**Frontend** — React 18, Vite, TypeScript, Tailwind CSS, React Flow
(`@xyflow/react`), Recharts, React Router.

No external AI APIs. Everything runs locally.
