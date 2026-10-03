"""Explainable similarity scoring and the engineering-rule decision layer.

Produces a fully transparent score object for every comparison: each sub-score,
plus the matched / conflicting / missing attribute lists that justify it.

The central rule: text similarity alone never authorises a merge. If a
critical engineering attribute conflicts - a 4 inch pipe against a 6 inch pipe
- the decision is DO_NOT_MERGE no matter how similar the wording is.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

from . import vocab
from .dna import MaterialDNA, _fmt

# Decision states
IDENTITY_MATCH = "IDENTITY_MATCH"
POTENTIAL_EQUIVALENT = "POTENTIAL_EQUIVALENT"
DO_NOT_MERGE = "DO_NOT_MERGE"
INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
REVIEW_REQUIRED = "REVIEW_REQUIRED"

# Score blend weights.
W_SEMANTIC = 0.40
W_ATTRIBUTE = 0.40
W_CLASSIFICATION = 0.20

# Decision thresholds.
T_IDENTITY = 0.90
T_POTENTIAL = 0.72
T_REVIEW = 0.55
MIN_EVIDENCE = 0.45

# A broader term that legitimately subsumes a more specific one. Treated as
# compatible (partial credit), never as a conflict.
GENERALISATIONS: dict[str, set[str]] = {
    "STEEL": {"CARBON STEEL", "MILD STEEL", "STAINLESS STEEL", "ALLOY STEEL",
              "CAST CARBON STEEL"},
    "CARBON STEEL": {"CAST CARBON STEEL"},
    "STAINLESS STEEL": {"CAST STAINLESS STEEL"},
    "BALL": {"DEEP GROOVE"},
    "BEARING": {"BALL BEARING"},
}
COMPATIBLE_CREDIT = 0.7


@dataclass
class AttributeVerdict:
    """Per-attribute comparison outcome, rendered directly in the UI."""

    key: str
    label: str
    value_a: str | None
    value_b: str | None
    status: str  # matched | compatible | conflicting | missing
    critical: bool
    weight: float
    note: str | None = None


@dataclass
class ScoreBreakdown:
    """The transparent score object returned by /api/match and /api/compare."""

    semantic_score: float = 0.0
    attribute_score: float = 0.0
    classification_score: float = 0.0
    final_score: float = 0.0
    confidence: float = 0.0
    evidence_strength: float = 0.0
    decision: str = INSUFFICIENT_EVIDENCE
    matched_attributes: list[str] = field(default_factory=list)
    conflicting_attributes: list[str] = field(default_factory=list)
    missing_attributes: list[str] = field(default_factory=list)
    compatible_attributes: list[str] = field(default_factory=list)
    critical_conflicts: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    attribute_verdicts: list[AttributeVerdict] = field(default_factory=list)

    def to_dict(self) -> dict:
        data = asdict(self)
        data["attribute_verdicts"] = [asdict(v) for v in self.attribute_verdicts]
        return data


# Attributes where a shorter value is a legitimate prefix-generalisation of a
# longer one ("ASTM" stated without the number vs "ASTM A106").
_PREFIX_SUBSUMING_KEYS = {"standard"}


def is_compatible(val_a: str, val_b: str, key: str | None = None) -> bool:
    """True if one value is a recognised generalisation of the other.

    Compatible values are *less specific*, not contradictory, so they earn
    partial credit instead of blocking a merge.
    """
    if val_b in GENERALISATIONS.get(val_a, set()):
        return True
    if val_a in GENERALISATIONS.get(val_b, set()):
        return True
    if key in _PREFIX_SUBSUMING_KEYS:
        short, long = sorted((val_a, val_b), key=len)
        if long.startswith(short + " "):
            return True
    return False


# Backwards-compatible alias used inside this module.
_is_compatible = is_compatible


def critical_keys(category: str | None) -> list[str]:
    return vocab.CRITICAL_ATTRIBUTES.get(
        category or "", vocab.CRITICAL_ATTRIBUTES["_DEFAULT"])


def compare_attributes(dna_a: MaterialDNA, dna_b: MaterialDNA
                       ) -> tuple[list[AttributeVerdict], float, float]:
    """Compare two DNA profiles attribute by attribute.

    Returns the per-attribute verdicts, the attribute similarity score and an
    evidence-strength ratio (how much of the comparable DNA was actually
    present on both sides).
    """
    category = dna_a.get("category") or dna_b.get("category")
    criticals = set(critical_keys(_fmt(category) if category else None))

    verdicts: list[AttributeVerdict] = []
    earned = 0.0
    comparable_weight = 0.0
    union_weight = 0.0

    for key, label in vocab.ATTRIBUTE_LABELS:
        raw_a = dna_a.get(key)
        raw_b = dna_b.get(key)
        if raw_a is None and raw_b is None:
            continue

        val_a = _fmt(raw_a) if raw_a is not None else None
        val_b = _fmt(raw_b) if raw_b is not None else None
        weight = vocab.ATTRIBUTE_WEIGHTS.get(key, 1.0)
        is_critical = key in criticals and key not in vocab.SOFT_ATTRIBUTES
        union_weight += weight
        note = None

        if val_a is not None and val_b is not None:
            if val_a == val_b:
                status = "matched"
                earned += weight
                comparable_weight += weight
            elif is_compatible(val_a, val_b, key):
                status = "compatible"
                earned += weight * COMPATIBLE_CREDIT
                comparable_weight += weight
                note = "One description is less specific but not contradictory"
            else:
                status = "conflicting"
                comparable_weight += weight
                note = ("Critical engineering attribute differs"
                        if is_critical else "Differs, commercially reviewable")
        else:
            status = "missing"
            note = "Not stated in one of the two descriptions"

        verdicts.append(AttributeVerdict(
            key=key, label=label, value_a=val_a, value_b=val_b,
            status=status, critical=is_critical, weight=weight, note=note))

    attribute_score = earned / comparable_weight if comparable_weight else 0.0
    evidence_strength = comparable_weight / union_weight if union_weight else 0.0
    return verdicts, attribute_score, evidence_strength


def classification_similarity(dna_a: MaterialDNA, dna_b: MaterialDNA) -> tuple[float, list[str]]:
    """Agreement of the structured ERP context: category, group, UOM family."""
    notes: list[str] = []
    components: list[float] = []

    cat_a, cat_b = dna_a.get("category"), dna_b.get("category")
    if cat_a and cat_b:
        same = _fmt(cat_a) == _fmt(cat_b)
        components.append(1.0 if same else 0.0)
        if not same:
            notes.append(f"Category differs: {_fmt(cat_a)} vs {_fmt(cat_b)}")

    grp_a, grp_b = dna_a.get("material_group"), dna_b.get("material_group")
    if grp_a and grp_b:
        if _fmt(grp_a) == _fmt(grp_b):
            components.append(1.0)
        else:
            # Different CPSEs legitimately file the same item under different
            # group names, so this is a weak signal rather than a blocker.
            components.append(0.5)
            notes.append(f"ERP material group differs: {_fmt(grp_a)} vs {_fmt(grp_b)}")

    fam_a, fam_b = dna_a.get("uom_family"), dna_b.get("uom_family")
    if fam_a and fam_b:
        if _fmt(fam_a) == _fmt(fam_b):
            components.append(1.0)
        else:
            components.append(0.4)
            notes.append(
                f"UOM family differs: {_fmt(dna_a.get('uom'))} vs {_fmt(dna_b.get('uom'))}")

    score = sum(components) / len(components) if components else 0.5
    return score, notes


def decide(dna_a: MaterialDNA, dna_b: MaterialDNA, semantic_score: float
           ) -> ScoreBreakdown:
    """Full scoring + engineering-rule decision for one candidate pair."""
    verdicts, attribute_score, evidence_strength = compare_attributes(dna_a, dna_b)
    classification_score, class_notes = classification_similarity(dna_a, dna_b)

    matched = [v.label for v in verdicts if v.status == "matched"]
    compatible = [v.label for v in verdicts if v.status == "compatible"]
    conflicting = [v.label for v in verdicts if v.status == "conflicting"]
    missing = [v.label for v in verdicts if v.status == "missing"]
    critical_conflicts = [v.label for v in verdicts
                          if v.status == "conflicting" and v.critical]
    soft_conflicts = [v.label for v in verdicts
                      if v.status == "conflicting" and v.key in vocab.SOFT_ATTRIBUTES]

    final_score = (W_SEMANTIC * semantic_score
                   + W_ATTRIBUTE * attribute_score
                   + W_CLASSIFICATION * classification_score)

    reasons: list[str] = []
    criticals = set(critical_keys(_fmt(dna_a.get("category")) if dna_a.get("category") else None))
    comparable_criticals = [v for v in verdicts
                            if v.key in criticals and v.status != "missing"]

    # --- Engineering rules, applied in order of authority ----------------
    if critical_conflicts:
        # Hard block: no amount of text similarity can merge these.
        decision = DO_NOT_MERGE
        reasons.append("Critical attribute mismatch: " + ", ".join(critical_conflicts))
        for v in verdicts:
            if v.status == "conflicting" and v.critical:
                reasons.append(f"{v.label}: {v.value_a} vs {v.value_b}")
    elif evidence_strength < MIN_EVIDENCE or len(comparable_criticals) < 2:
        decision = INSUFFICIENT_EVIDENCE
        reasons.append(
            "Too few engineering attributes are stated on both sides to decide "
            f"({len(comparable_criticals)} critical attribute(s) comparable)")
        if missing:
            reasons.append("Not stated on one side: " + ", ".join(missing))
    elif final_score >= T_IDENTITY and not conflicting:
        decision = IDENTITY_MATCH
        reasons.append("All critical engineering attributes match")
    elif final_score >= T_POTENTIAL:
        decision = POTENTIAL_EQUIVALENT
        reasons.append("Core engineering attributes align; "
                       "secondary attributes incomplete or less specific")
    elif final_score >= T_REVIEW:
        decision = REVIEW_REQUIRED
        reasons.append("Partial attribute agreement - human confirmation needed")
    else:
        decision = DO_NOT_MERGE
        reasons.append("Insufficient overall similarity")

    # A substitutable-attribute clash cannot claim strict identity.
    if decision == IDENTITY_MATCH and soft_conflicts:
        decision = POTENTIAL_EQUIVALENT
        reasons.append("Substitutable attribute differs: " + ", ".join(soft_conflicts))

    if compatible:
        reasons.append("Less specific but compatible: " + ", ".join(compatible))
    reasons.extend(class_notes)

    # Confidence reflects how well-evidenced the decision is, not just score.
    confidence = final_score * (0.6 + 0.4 * evidence_strength)
    if critical_conflicts:
        # High confidence that these must NOT be merged.
        confidence = max(confidence, 0.9)

    return ScoreBreakdown(
        semantic_score=round(semantic_score, 4),
        attribute_score=round(attribute_score, 4),
        classification_score=round(classification_score, 4),
        final_score=round(final_score, 4),
        confidence=round(min(confidence, 0.99), 4),
        evidence_strength=round(evidence_strength, 4),
        decision=decision,
        matched_attributes=matched,
        conflicting_attributes=conflicting,
        missing_attributes=missing,
        compatible_attributes=compatible,
        critical_conflicts=critical_conflicts,
        reasons=reasons,
        attribute_verdicts=verdicts,
    )


MERGEABLE = {IDENTITY_MATCH, POTENTIAL_EQUIVALENT}
