"""SQLite persistence for mappings, reviews and audit events.

The material master itself stays in memory (rebuilt from CSV on startup); the
database holds the *decisions* a human made, which is what must survive a
restart in a harmonisation workflow.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.getenv(
    "NMAP_DB_PATH",
    Path(__file__).resolve().parent.parent / "data" / "nmap.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY,
    cpse_name TEXT NOT NULL,
    legacy_material_code TEXT NOT NULL,
    legacy_description TEXT NOT NULL,
    legacy_uom TEXT,
    legacy_material_group TEXT,
    normalized_description TEXT,
    dna_json TEXT,
    inferred_national_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_materials_cpse ON materials(cpse_name);
CREATE INDEX IF NOT EXISTS idx_materials_code ON materials(legacy_material_code);
CREATE INDEX IF NOT EXISTS idx_materials_national ON materials(inferred_national_code);

CREATE TABLE IF NOT EXISTS mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    legacy_material_code TEXT NOT NULL,
    cpse_name TEXT,
    national_code TEXT NOT NULL,
    standard_description TEXT,
    decision TEXT NOT NULL,
    confidence REAL,
    approved_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(material_id, national_code)
);
CREATE INDEX IF NOT EXISTS idx_mappings_national ON mappings(national_code);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    candidate_id INTEGER,
    national_code TEXT,
    standard_description TEXT,
    decision TEXT NOT NULL,
    confidence REAL,
    final_score REAL,
    semantic_score REAL,
    attribute_score REAL,
    classification_score REAL,
    status TEXT NOT NULL DEFAULT 'Pending',
    evidence_json TEXT,
    is_demo_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    reviewed_by TEXT,
    review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_role TEXT,
    action TEXT NOT NULL,
    material_id INTEGER,
    material_label TEXT,
    old_mapping TEXT,
    new_mapping TEXT,
    decision TEXT,
    detail TEXT,
    is_demo_seed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(timestamp DESC);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def materials_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM materials").fetchone()["n"]


def load_materials(conn: sqlite3.Connection, records, record_to_code) -> None:
    """Populate the materials table. Skipped when already loaded."""
    if materials_count(conn) == len(records):
        return
    conn.execute("DELETE FROM materials")
    conn.executemany(
        """INSERT INTO materials (id, cpse_name, legacy_material_code,
               legacy_description, legacy_uom, legacy_material_group,
               normalized_description, dna_json, inferred_national_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [(r.id, r.cpse_name, r.legacy_material_code, r.legacy_description,
          r.legacy_uom, r.legacy_material_group, r.normalized,
          json.dumps(r.dna.to_dict()), record_to_code.get(r.id))
         for r in records])
    conn.commit()


def record_audit(conn: sqlite3.Connection, *, actor: str, actor_role: str,
                 action: str, material_id: int | None = None,
                 material_label: str | None = None,
                 old_mapping: str | None = None, new_mapping: str | None = None,
                 decision: str | None = None, detail: str | None = None,
                 is_demo_seed: bool = False, timestamp: str | None = None) -> int:
    cursor = conn.execute(
        """INSERT INTO audit_events (timestamp, actor, actor_role, action,
               material_id, material_label, old_mapping, new_mapping, decision,
               detail, is_demo_seed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (timestamp or utc_now(), actor, actor_role, action, material_id,
         material_label, old_mapping, new_mapping, decision, detail,
         1 if is_demo_seed else 0))
    conn.commit()
    return int(cursor.lastrowid)
