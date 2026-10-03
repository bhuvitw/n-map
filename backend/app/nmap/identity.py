"""National material identity inference and deterministic code generation.

Legacy records are grouped into national identities by their *Material DNA
signature*, never by the ground-truth label. National codes are generated
deterministically from the DNA itself, so the same material always receives
the same code and no hidden label is ever copied.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass, field

from .dna import MaterialDNA, build_standard_description, _fmt
from .scoring import is_compatible

# Short code segment per category, in the style of a national material master.
CATEGORY_CODE = {
    "PIPE": "PIPE", "VALVE": "VLV", "BEARING": "BRG", "CABLE": "CBL",
    "PLATE": "PLT", "FLANGE": "FLG", "FASTENER": "FST", "MOTOR": "MOT",
    "PUMP": "PMP", "BEAM": "BEM",
}


def generate_national_code(dna: MaterialDNA) -> str:
    """Deterministic national code derived from the DNA signature.

    Format: NAT-<CATEGORY>-<3 digit DNA hash>, e.g. NAT-PIPE-417.

    The numeric segment is a stable hash of the attribute signature, NOT the
    dataset's hidden Target_National_Code - identical DNA anywhere in the
    country resolves to the identical code without consulting any label.
    """
    category = _fmt(dna.get("category")) if dna.get("category") else "GEN"
    segment = CATEGORY_CODE.get(category, category[:3].upper() or "GEN")
    digest = hashlib.sha1(dna.signature().encode("utf-8")).hexdigest()
    return f"NAT-{segment}-{int(digest[:6], 16) % 1000:03d}"


@dataclass
class NationalIdentity:
    """One inferred national material identity and its legacy members."""

    national_code: str
    signature: str
    standard_description: str
    category: str | None
    attributes: dict = field(default_factory=dict)
    member_ids: list[int] = field(default_factory=list)
    cpses: set[str] = field(default_factory=set)
    legacy_codes: set[str] = field(default_factory=set)
    description_variants: set[str] = field(default_factory=set)
    uoms: set[str] = field(default_factory=set)
    material_groups: set[str] = field(default_factory=set)

    @property
    def record_count(self) -> int:
        return len(self.member_ids)


def _parse_signature(signature: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in signature.split("|") if "=" in p)


def _absorbable(sig_a: str, sig_b: str) -> bool:
    """True if signature A is a less-specific form of signature B.

    A is absorbable when every attribute it states is either identical to B's
    or a recognised generalisation of it (STEEL vs CARBON STEEL, BALL vs DEEP
    GROOVE, ASTM vs ASTM A106), and B states strictly more. A single genuine
    contradiction disqualifies absorption outright.
    """
    pairs_a = _parse_signature(sig_a)
    pairs_b = _parse_signature(sig_b)
    if not pairs_a or len(pairs_a) > len(pairs_b):
        return False

    generalised = 0
    for key, val in pairs_a.items():
        if key not in pairs_b:
            return False  # A states something B does not - not a subset
        other = pairs_b[key]
        if other == val:
            continue
        if is_compatible(val, other, key):
            generalised += 1
            continue
        return False  # a real conflict - never absorb

    # Either A is a strict subset, or it says the same things less precisely.
    return len(pairs_a) < len(pairs_b) or generalised > 0


def build_identities(records: list) -> tuple[dict[str, NationalIdentity], dict[int, str]]:
    """Cluster records into national identities by DNA signature.

    Degraded descriptions produce *partial* signatures (attributes dropped
    rather than contradicted). Those are absorbed into the richest signature
    they are compatible with, which is what lets six differently-abbreviated
    CPSE records collapse onto one national identity.
    """
    by_signature: dict[str, list] = defaultdict(list)
    for rec in records:
        by_signature[rec.dna.signature()].append(rec)

    # Richest (most attributes, most members) signatures become the anchors.
    ranked = sorted(by_signature.items(),
                    key=lambda kv: (len(kv[0].split("|")), len(kv[1])),
                    reverse=True)
    anchors: list[str] = []
    absorbed: dict[str, str] = {}
    for signature, _members in ranked:
        host = next((a for a in anchors if _absorbable(signature, a)), None)
        if host is not None:
            absorbed[signature] = host
        else:
            anchors.append(signature)

    identities: dict[str, NationalIdentity] = {}
    record_to_code: dict[int, str] = {}

    for signature, members in by_signature.items():
        anchor_sig = absorbed.get(signature, signature)
        anchor_rec = by_signature[anchor_sig][0]
        code = generate_national_code(anchor_rec.dna)

        identity = identities.get(code)
        if identity is None:
            identity = NationalIdentity(
                national_code=code,
                signature=anchor_sig,
                standard_description=build_standard_description(anchor_rec.dna),
                category=(_fmt(anchor_rec.dna.get("category"))
                          if anchor_rec.dna.get("category") else None),
                attributes={k: _fmt(v) for k, v in anchor_rec.dna.attributes.items()
                            if not k.endswith("_source")},
            )
            identities[code] = identity

        for rec in members:
            identity.member_ids.append(rec.id)
            identity.cpses.add(rec.cpse_name)
            identity.legacy_codes.add(rec.legacy_material_code)
            identity.description_variants.add(rec.legacy_description)
            identity.uoms.add(rec.legacy_uom)
            identity.material_groups.add(rec.legacy_material_group)
            record_to_code[rec.id] = code

    return identities, record_to_code
