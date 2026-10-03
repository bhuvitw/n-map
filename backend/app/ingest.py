"""CSV ingestion and startup precomputation."""
from __future__ import annotations

import csv
import os
from pathlib import Path

from .nmap.dna import extract_dna
from .nmap.engine import HarmonisationEngine, MaterialRecord
from .nmap.normalize import normalize

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PREFERRED = ["cpse_synthetic_cleaned.csv", "cpse_synthetic_material_master.csv"]


def resolve_csv_path() -> Path:
    """Locate the dataset, preferring the cleaned file."""
    override = os.getenv("NMAP_CSV_PATH")
    if override:
        path = Path(override).expanduser()
        if path.is_file():
            return path
        raise FileNotFoundError(f"NMAP_CSV_PATH does not exist: {path}")
    for name in PREFERRED:
        candidate = DATA_DIR / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"No dataset CSV found in {DATA_DIR}")


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def build_records(rows: list[dict]) -> list[MaterialRecord]:
    """Precompute normalisation + Material DNA for every row."""
    records: list[MaterialRecord] = []
    for index, row in enumerate(rows, start=1):
        description = (row.get("Legacy_Description") or "").strip()
        uom = (row.get("Legacy_UOM") or "").strip()
        group = (row.get("Legacy_Material_Group") or "").strip()
        records.append(MaterialRecord(
            id=index,
            cpse_name=(row.get("CPSE_Name") or "").strip(),
            legacy_material_code=(row.get("Legacy_Material_Code") or "").strip(),
            legacy_description=description,
            legacy_uom=uom,
            legacy_material_group=group,
            original_legacy_code=(row.get("Original_Legacy_Code") or "").strip(),
            normalized=normalize(description),
            dna=extract_dna(description, uom, group),
            # Ground truth is attached but never used as a matching feature.
            target_national_code=(row.get("Target_National_Code") or "").strip() or None,
            target_standard_description=(
                row.get("Target_Standard_Description") or "").strip() or None,
        ))
    return records


def load_engine() -> tuple[HarmonisationEngine, Path]:
    path = resolve_csv_path()
    records = build_records(read_rows(path))
    return HarmonisationEngine(records), path
