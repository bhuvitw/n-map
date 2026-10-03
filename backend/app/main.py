"""N-MAP FastAPI application.

On startup: initialise SQLite, load the CSV corpus, precompute normalisation,
Material DNA and the retrieval indexes, infer national identities, then seed
the review queue from real engine output.
"""
from __future__ import annotations

import json
import os
import time
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, seed
from .ingest import load_engine
from .nmap import scoring
from .nmap.benchmark import run_benchmark
from .nmap.opportunity import build_opportunities

STATE: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    started = time.time()
    conn = db.connect()
    db.init_db(conn)

    engine, csv_path = load_engine()
    db.load_materials(conn, engine.records, engine.record_to_code)

    seeded_reviews = seed.seed_reviews(conn, engine)
    seeded_audit = seed.seed_audit(conn, engine)

    STATE.update({
        "engine": engine,
        "conn": conn,
        "csv_path": str(csv_path),
        "startup_seconds": round(time.time() - started, 3),
        "seeded_reviews": seeded_reviews,
        "seeded_audit": seeded_audit,
        "opportunities": build_opportunities(engine),
        "benchmark": None,
    })
    yield
    conn.close()


app = FastAPI(
    title="N-MAP",
    description=("National Material Intelligence & Opportunity Platform - "
                 "AI-driven standardisation and harmonisation of material "
                 "codes across CPSEs."),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("NMAP_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def engine():
    if "engine" not in STATE:
        raise HTTPException(503, "engine still starting")
    return STATE["engine"]


def conn():
    return STATE["conn"]


# --- request models -------------------------------------------------------
class MatchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Natural-language query")
    top_k: int = Field(10, ge=1, le=50)
    uom: str | None = None
    material_group: str | None = None
    exclude_id: int | None = None


class CompareRequest(BaseModel):
    material_id: int | None = None
    candidate_id: int
    query: str | None = Field(
        None, description="Compare a free-text query instead of a stored record")
    uom: str | None = None
    material_group: str | None = None


class ReviewDecisionRequest(BaseModel):
    actor: str = "admin"
    actor_role: str = "Data Steward"
    note: str | None = None


# --- endpoints ------------------------------------------------------------
@app.get("/api/health")
def health():
    eng = STATE.get("engine")
    return {
        "status": "ok" if eng else "starting",
        "records_loaded": len(eng.records) if eng else 0,
        "national_identities": len(eng.identities) if eng else 0,
        "dataset": STATE.get("csv_path"),
        "startup_seconds": STATE.get("startup_seconds"),
        "embeddings_enabled": eng.embeddings_enabled if eng else False,
        "database": str(db.DB_PATH),
    }


@app.get("/api/stats")
def stats():
    eng = engine()
    records = eng.records
    cpses = Counter(r.cpse_name for r in records)
    groups = Counter(r.legacy_material_group for r in records)
    categories = Counter(
        str(r.dna.get("category") or "UNCLASSIFIED") for r in records)
    uoms = Counter(r.legacy_uom for r in records)

    review_rows = conn().execute(
        "SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").fetchall()
    review_counts = {row["status"]: row["n"] for row in review_rows}
    mappings = conn().execute(
        "SELECT COUNT(*) AS n FROM mappings").fetchone()["n"]
    flagged = [r for r in records if r.dna.get("data_quality_flag")]

    # Records whose DNA is too thin to decide automatically.
    thin_dna = sum(
        1 for r in records
        if len([k for k in r.dna.attributes
                if not k.endswith("_source")
                and k not in {"uom", "uom_family", "material_group",
                              "data_quality_flag"}]) < 3)

    return {
        "total_records": len(records),
        "cpse_count": len(cpses),
        "cpses": [{"cpse_name": k, "records": v} for k, v in sorted(cpses.items())],
        "unique_legacy_codes": len({r.legacy_material_code for r in records}),
        "legacy_material_groups": len(groups),
        "material_group_breakdown": [
            {"material_group": k, "records": v} for k, v in groups.most_common()],
        "national_identities": len(eng.identities),
        "category_distribution": [
            {"category": k, "records": v} for k, v in categories.most_common()],
        "uom_distribution": [
            {"uom": k, "records": v} for k, v in uoms.most_common()],
        "records_requiring_review": (
            review_counts.get("Pending", 0) + review_counts.get("Needs Review", 0)),
        "review_status_counts": review_counts,
        "approved_mappings": mappings,
        "data_quality_exceptions": len(flagged),
        "records_with_thin_dna": thin_dna,
        "description_variants": len({r.legacy_description for r in records}),
        "flow": [
            {"stage": "CPSE DATA", "value": len(records)},
            {"stage": "MATERIAL DNA", "value": len(records)},
            {"stage": "AI MATCH", "value": len(records)},
            {"stage": "ENGINEERING RULES", "value": len(records)},
            {"stage": "NATIONAL IDENTITY", "value": len(eng.identities)},
            {"stage": "HUMAN APPROVAL",
             "value": review_counts.get("Approved", 0) + mappings},
            {"stage": "OPPORTUNITY",
             "value": STATE["opportunities"]["summary"]["cross_cpse_identities"]},
        ],
    }


@app.get("/api/materials")
def materials(
    q: str | None = None,
    cpse: str | None = None,
    material_group: str | None = None,
    national_code: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    eng = engine()
    rows = eng.records
    if cpse:
        rows = [r for r in rows if r.cpse_name.upper() == cpse.upper()]
    if material_group:
        rows = [r for r in rows
                if r.legacy_material_group.upper() == material_group.upper()]
    if national_code:
        rows = [r for r in rows
                if eng.record_to_code.get(r.id) == national_code]
    if q:
        needle = q.upper()
        rows = [r for r in rows
                if needle in r.legacy_description.upper()
                or needle in r.legacy_material_code.upper()]

    page = rows[offset:offset + limit]
    return {
        "total": len(rows),
        "limit": limit,
        "offset": offset,
        "materials": [
            {**r.public_dict(include_dna=False),
             "national_code": eng.record_to_code.get(r.id)}
            for r in page],
    }


@app.get("/api/materials/{material_id}")
def material_detail(material_id: int):
    eng = engine()
    record = eng.by_id.get(material_id)
    if record is None:
        raise HTTPException(404, "material not found")
    code = eng.record_to_code.get(record.id)
    identity = eng.identities.get(code) if code else None
    return {
        **record.public_dict(),
        "national_code": code,
        "national_standard_description": (
            identity.standard_description if identity else None),
        "data_quality_flag": record.dna.get("data_quality_flag"),
        "sibling_count": identity.record_count if identity else 0,
        "sibling_cpses": sorted(identity.cpses) if identity else [],
    }


@app.post("/api/match")
def match(request: MatchRequest):
    started = time.time()
    result = engine().search(
        request.query, top_k=request.top_k, uom=request.uom,
        material_group=request.material_group, exclude_id=request.exclude_id)
    result["elapsed_ms"] = round((time.time() - started) * 1000, 2)
    return result


@app.post("/api/compare")
def compare(request: CompareRequest):
    eng = engine()
    try:
        if request.query:
            return eng.compare_query(
                request.query, request.candidate_id,
                uom=request.uom, material_group=request.material_group)
        if request.material_id is None:
            raise HTTPException(400, "material_id or query is required")
        return eng.compare_records(request.material_id, request.candidate_id)
    except KeyError:
        raise HTTPException(404, "material not found")


@app.get("/api/compare/{material_id}/{candidate_id}")
def compare_get(material_id: int, candidate_id: int):
    try:
        return engine().compare_records(material_id, candidate_id)
    except KeyError:
        raise HTTPException(404, "material not found")


@app.get("/api/identities")
def identities():
    eng = engine()
    return {
        "identities": [
            {
                "national_code": i.national_code,
                "standard_description": i.standard_description,
                "category": i.category,
                "attributes": i.attributes,
                "record_count": i.record_count,
                "cpse_count": len(i.cpses),
                "cpses": sorted(i.cpses),
                "legacy_identity_count": len(i.legacy_codes),
                "description_variants": len(i.description_variants),
                "uoms": sorted(i.uoms),
            }
            for i in eng.identity_list()],
    }


@app.get("/api/graph/{national_code}")
def graph(national_code: str, limit_per_cpse: int = Query(4, ge=1, le=25)):
    try:
        return engine().identity_graph(national_code, limit_per_cpse)
    except KeyError:
        raise HTTPException(404, "national code not found")


@app.get("/api/opportunities")
def opportunities():
    return STATE["opportunities"]


@app.get("/api/reviews")
def reviews(status: str | None = None, limit: int = Query(100, ge=1, le=500)):
    sql = ("SELECT id, material_id, candidate_id, national_code, "
           "standard_description, decision, confidence, final_score, "
           "semantic_score, attribute_score, classification_score, status, "
           "is_demo_seed, created_at, updated_at, reviewed_by, review_note "
           "FROM reviews")
    params: list = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY confidence DESC, id ASC LIMIT ?"
    params.append(limit)

    eng = engine()
    rows = []
    for row in conn().execute(sql, params).fetchall():
        item = dict(row)
        record = eng.by_id.get(item["material_id"])
        candidate = eng.by_id.get(item["candidate_id"])
        item["material"] = record.public_dict(include_dna=False) if record else None
        item["candidate"] = (candidate.public_dict(include_dna=False)
                             if candidate else None)
        rows.append(item)

    counts = {r["status"]: r["n"] for r in conn().execute(
        "SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").fetchall()}
    return {"reviews": rows, "status_counts": counts, "total": len(rows)}


@app.get("/api/reviews/{review_id}")
def review_detail(review_id: int):
    row = conn().execute("SELECT * FROM reviews WHERE id = ?",
                         (review_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "review not found")
    item = dict(row)
    item["evidence"] = json.loads(item.pop("evidence_json") or "null")
    return item


def _decide_review(review_id: int, status: str, action: str,
                   request: ReviewDecisionRequest):
    row = conn().execute("SELECT * FROM reviews WHERE id = ?",
                         (review_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "review not found")

    eng = engine()
    record = eng.by_id.get(row["material_id"])
    previous_status = row["status"]
    conn().execute(
        """UPDATE reviews SET status = ?, updated_at = ?, reviewed_by = ?,
               review_note = ? WHERE id = ?""",
        (status, db.utc_now(), request.actor, request.note, review_id))

    mapping_created = False
    if status == "Approved" and record is not None:
        conn().execute(
            """INSERT OR IGNORE INTO mappings (material_id,
                   legacy_material_code, cpse_name, national_code,
                   standard_description, decision, confidence, approved_by,
                   created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (record.id, record.legacy_material_code, record.cpse_name,
             row["national_code"], row["standard_description"], row["decision"],
             row["confidence"], request.actor, db.utc_now()))
        mapping_created = True
    conn().commit()

    db.record_audit(
        conn(), actor=request.actor, actor_role=request.actor_role,
        action=action, material_id=row["material_id"],
        material_label=(f"{record.cpse_name} / {record.legacy_material_code}"
                        if record else None),
        old_mapping=(record.legacy_material_code if record else previous_status),
        new_mapping=row["national_code"],
        decision=row["decision"],
        detail=request.note or f"Status {previous_status} -> {status}")

    return {
        "review_id": review_id,
        "status": status,
        "mapping_created": mapping_created,
        "national_code": row["national_code"],
        "standard_description": row["standard_description"],
        "message": f"Review {review_id} marked {status}",
    }


@app.post("/api/reviews/{review_id}/approve")
def approve_review(review_id: int, request: ReviewDecisionRequest):
    return _decide_review(review_id, "Approved", "MAPPING_APPROVED", request)


@app.post("/api/reviews/{review_id}/reject")
def reject_review(review_id: int, request: ReviewDecisionRequest):
    return _decide_review(review_id, "Rejected", "MAPPING_REJECTED", request)


@app.post("/api/reviews/{review_id}/needs-review")
def flag_review(review_id: int, request: ReviewDecisionRequest):
    return _decide_review(review_id, "Needs Review", "MAPPING_FLAGGED", request)


@app.get("/api/mappings")
def mappings(limit: int = Query(200, ge=1, le=1000)):
    rows = conn().execute(
        "SELECT * FROM mappings ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return {"mappings": [dict(r) for r in rows], "total": len(rows)}


@app.get("/api/audit")
def audit(limit: int = Query(200, ge=1, le=1000), action: str | None = None):
    sql = "SELECT * FROM audit_events"
    params: list = []
    if action:
        sql += " WHERE action = ?"
        params.append(action)
    sql += " ORDER BY timestamp DESC, id DESC LIMIT ?"
    params.append(limit)
    rows = conn().execute(sql, params).fetchall()
    return {"events": [dict(r) for r in rows], "total": len(rows)}


@app.get("/api/benchmark")
def benchmark(sample_size: int = Query(300, ge=20, le=2000),
              seed_value: int = Query(42, alias="seed"),
              refresh: bool = False):
    cached = STATE.get("benchmark")
    key = (sample_size, seed_value)
    if cached and cached.get("_key") == key and not refresh:
        return cached["data"]
    started = time.time()
    report = run_benchmark(engine(), sample_size=sample_size, seed=seed_value)
    report["elapsed_seconds"] = round(time.time() - started, 2)
    STATE["benchmark"] = {"_key": key, "data": report}
    return report


@app.get("/api/demo-queries")
def demo_queries():
    """Curated queries for the Material Intelligence Studio."""
    return {
        "queries": [
            {"label": "A106 B 4 inch seamless pipe",
             "query": "A106 grade B seamless pipe 4 inch"},
            {"label": "SKF 6205 bearing", "query": "SKF 6205 bearing"},
            {"label": "IS 2062 10mm steel plate",
             "query": "IS 2062 10mm mild steel plate"},
            {"label": "Class 150 WCB gate valve 2 inch",
             "query": "class 150 WCB gate valve 2 inch"},
            {"label": "3 core 2.5 sqmm copper armoured cable",
             "query": "3 core 2.5 sqmm copper armoured cable"},
        ],
        "negative_example": {
            "label": "A106 B 6 inch seamless pipe (should NOT merge with 4 inch)",
            "query": "A106 grade B 6 inch seamless pipe",
            "explanation": ("Wording is nearly identical to the 4 inch pipe, "
                            "but the nominal size conflicts - the engineering "
                            "rule layer must return DO_NOT_MERGE."),
        },
    }


# --- Frontend (single-origin deployment) ---------------------------------
# In production the built React console is copied to backend/static by the
# Docker build and served from this same origin, so no CORS or API base URL
# configuration is needed. In local development the directory does not exist
# and these routes are skipped - the Vite dev server proxies /api instead.
#
# Declared last on purpose: the catch-all only matches when no API route did.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"

if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"),
              name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """Serve the console, falling back to index.html for client-side routes."""
        # Unknown API paths must still fail as JSON, not as the HTML shell.
        if full_path.startswith("api/"):
            raise HTTPException(404, "not found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
