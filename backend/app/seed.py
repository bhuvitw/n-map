"""Seed the review queue and audit trail.

Review records are generated from REAL engine output (actual AI
recommendations over the loaded corpus), so the Approval Center shows genuine
scores and evidence. Audit entries that describe past human activity are
synthetic and are flagged is_demo_seed=1 everywhere they surface.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone

from .db import record_audit, utc_now
from .nmap import scoring

DEMO_ACTORS = [
    ("a.narayanan", "Data Steward"),
    ("r.mehta", "Engineer"),
    ("s.kulkarni", "Engineer"),
    ("admin", "Admin"),
]


def seed_reviews(conn, engine, per_identity: int = 3, seed: int = 7) -> int:
    """Create pending review items from real cross-CPSE match evidence.

    For each inferred national identity we take records from different CPSEs
    and score them against the identity's richest member - exactly the
    recommendation a reviewer would receive in production.
    """
    existing = conn.execute("SELECT COUNT(*) AS n FROM reviews").fetchone()["n"]
    if existing:
        return 0

    rng = random.Random(seed)
    rows = []
    for identity in engine.identity_list():
        members = [engine.by_id[m] for m in identity.member_ids]
        if len(members) < 2:
            continue
        # One representative per CPSE keeps the queue visibly cross-CPSE.
        by_cpse: dict[str, list] = {}
        for member in members:
            by_cpse.setdefault(member.cpse_name, []).append(member)

        anchor = max(members, key=lambda r: len(r.dna.signature()))
        picks = []
        for cpse, cpse_members in sorted(by_cpse.items()):
            candidate = rng.choice(cpse_members)
            if candidate.id != anchor.id:
                picks.append(candidate)
        rng.shuffle(picks)

        for record in picks[:per_identity]:
            comparison = engine.compare_records(record.id, anchor.id)
            score = comparison["score"]
            rows.append((
                record.id, anchor.id, identity.national_code,
                identity.standard_description, score["decision"],
                score["confidence"], score["final_score"],
                score["semantic_score"], score["attribute_score"],
                score["classification_score"],
                _status_for(score["decision"]),
                json.dumps(comparison), 1, utc_now()))

    # A realistic queue is not uniform: add the hard cases a reviewer has to
    # adjudicate - cross-identity near-misses, and records whose ERP material
    # group contradicts their engineering attributes.
    rows.extend(_cross_identity_rows(engine, rng))
    rows.extend(_data_quality_rows(engine))

    conn.executemany(
        """INSERT INTO reviews (material_id, candidate_id, national_code,
               standard_description, decision, confidence, final_score,
               semantic_score, attribute_score, classification_score, status,
               evidence_json, is_demo_seed, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    conn.commit()
    return len(rows)


def _cross_identity_rows(engine, rng) -> list[tuple]:
    """Pairs drawn from DIFFERENT national identities.

    These are the merges the engine must refuse. Seeding them means the
    Approval Center shows real rejected recommendations rather than an
    all-green queue.
    """
    identities = engine.identity_list()
    rows: list[tuple] = []
    for index, identity in enumerate(identities):
        other = identities[(index + 1) % len(identities)]
        if other.national_code == identity.national_code:
            continue
        if not identity.member_ids or not other.member_ids:
            continue
        left = engine.by_id[rng.choice(identity.member_ids)]
        right = engine.by_id[rng.choice(other.member_ids)]
        comparison = engine.compare_records(left.id, right.id)
        score = comparison["score"]
        rows.append((
            left.id, right.id, other.national_code,
            other.standard_description, score["decision"], score["confidence"],
            score["final_score"], score["semantic_score"],
            score["attribute_score"], score["classification_score"],
            _status_for(score["decision"]), json.dumps(comparison), 1,
            utc_now()))
    return rows


def _data_quality_rows(engine) -> list[tuple]:
    """Records whose ERP material group contradicts their DNA."""
    flagged = [r for r in engine.records if r.dna.get("data_quality_flag")]
    rows: list[tuple] = []
    for record in flagged:
        code = engine.record_to_code.get(record.id)
        identity = engine.identities.get(code) if code else None
        if identity is None:
            continue
        anchor = next((engine.by_id[m] for m in identity.member_ids
                       if m != record.id), None)
        if anchor is None:
            continue
        comparison = engine.compare_records(record.id, anchor.id)
        score = comparison["score"]
        rows.append((
            record.id, anchor.id, identity.national_code,
            identity.standard_description, score["decision"],
            score["confidence"], score["final_score"], score["semantic_score"],
            score["attribute_score"], score["classification_score"],
            "Needs Review", json.dumps(comparison), 1, utc_now()))
    return rows


def _status_for(decision: str) -> str:
    """Initial queue status implied by the AI decision."""
    if decision == scoring.DO_NOT_MERGE:
        return "Rejected"
    if decision in {scoring.REVIEW_REQUIRED, scoring.INSUFFICIENT_EVIDENCE}:
        return "Needs Review"
    return "Pending"


def seed_audit(conn, engine, seed: int = 11) -> int:
    """Write a short, clearly-labelled synthetic history of past activity."""
    existing = conn.execute(
        "SELECT COUNT(*) AS n FROM audit_events").fetchone()["n"]
    if existing:
        return 0

    rng = random.Random(seed)
    identities = engine.identity_list()
    now = datetime.now(timezone.utc)
    written = 0

    record_audit(
        conn, actor="system", actor_role="Admin", action="CORPUS_INGESTED",
        detail=(f"{len(engine.records)} legacy records ingested, "
                f"{len(engine.identities)} national identities inferred"),
        timestamp=(now - timedelta(hours=9)).isoformat(timespec="seconds"))
    written += 1

    for offset, identity in enumerate(identities[:5]):
        actor, role = rng.choice(DEMO_ACTORS)
        members = [engine.by_id[m] for m in identity.member_ids[:40]]
        if not members:
            continue
        record = rng.choice(members)
        stamp = now - timedelta(hours=8 - offset, minutes=rng.randint(0, 50))
        record_audit(
            conn, actor=actor, actor_role=role, action="NATIONAL_CODE_APPROVED",
            material_id=record.id,
            material_label=f"{record.cpse_name} / {record.legacy_material_code}",
            old_mapping=record.legacy_material_code,
            new_mapping=identity.national_code,
            decision=scoring.IDENTITY_MATCH,
            detail=f"Approved mapping to {identity.standard_description}",
            is_demo_seed=True, timestamp=stamp.isoformat(timespec="seconds"))
        written += 1

    flagged = [r for r in engine.records if r.dna.get("data_quality_flag")]
    for record in flagged[:3]:
        actor, role = rng.choice(DEMO_ACTORS)
        stamp = now - timedelta(hours=2, minutes=rng.randint(0, 50))
        record_audit(
            conn, actor=actor, actor_role=role, action="DATA_QUALITY_FLAGGED",
            material_id=record.id,
            material_label=f"{record.cpse_name} / {record.legacy_material_code}",
            decision=scoring.REVIEW_REQUIRED,
            detail=str(record.dna.get("data_quality_flag")),
            is_demo_seed=True, timestamp=stamp.isoformat(timespec="seconds"))
        written += 1

    return written
