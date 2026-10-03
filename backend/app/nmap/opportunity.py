"""Opportunity Radar.

Quantifies the rationalisation opportunity behind each inferred national
identity using only evidence the dataset actually contains: CPSE coverage,
how many distinct legacy codes exist for one physical material, and how
fragmented the descriptions are.

Deliberately NO monetary savings estimate - the dataset carries no
procurement spend, price or quantity data, so any rupee figure would be
fabricated.
"""
from __future__ import annotations

# Opportunity score weights.
W_COVERAGE = 0.40      # how many CPSEs independently hold the material
W_DUPLICATION = 0.35   # how many legacy identities describe one material
W_FRAGMENTATION = 0.25 # how inconsistently it is described

HIGH_THRESHOLD = 0.66
MEDIUM_THRESHOLD = 0.40


def _band(score: float) -> str:
    if score >= HIGH_THRESHOLD:
        return "HIGH"
    if score >= MEDIUM_THRESHOLD:
        return "MEDIUM"
    return "LOW"


def build_opportunities(engine) -> dict:
    """Compute the opportunity profile of every inferred national identity."""
    all_cpses = sorted({r.cpse_name for r in engine.records if r.cpse_name})
    total_cpses = len(all_cpses) or 1
    identities = engine.identity_list()
    max_legacy = max((len(i.legacy_codes) for i in identities), default=1) or 1

    items = []
    for identity in identities:
        cpse_count = len(identity.cpses)
        legacy_count = len(identity.legacy_codes)
        variant_count = len(identity.description_variants)
        record_count = identity.record_count

        coverage_ratio = cpse_count / total_cpses
        # Duplication: legacy identities for one material, normalised against
        # the most duplicated identity in the corpus.
        duplication_ratio = min(legacy_count / max_legacy, 1.0)
        # Fragmentation: share of records carrying a distinct description.
        fragmentation_ratio = (variant_count / record_count) if record_count else 0.0

        opportunity_score = (W_COVERAGE * coverage_ratio
                             + W_DUPLICATION * duplication_ratio
                             + W_FRAGMENTATION * fragmentation_ratio)
        # Standardisation level is the inverse of description fragmentation.
        standardisation_level = 1.0 - fragmentation_ratio

        per_cpse = {}
        for member_id in identity.member_ids:
            record = engine.by_id[member_id]
            per_cpse[record.cpse_name] = per_cpse.get(record.cpse_name, 0) + 1

        reasons = []
        if cpse_count > 1:
            reasons.append(
                f"The same standardised material appears across {cpse_count} of "
                f"{total_cpses} CPSEs under {legacy_count} different legacy codes.")
        else:
            reasons.append(
                f"Held by a single CPSE under {legacy_count} legacy code(s).")
        if variant_count > 1:
            reasons.append(
                f"{variant_count} distinct description variants describe one "
                "physical material, blocking automated spend aggregation.")
        if standardisation_level < 0.4:
            reasons.append(
                "Description discipline is low - free-text entry dominates.")

        classification = []
        if cpse_count >= max(2, total_cpses // 2):
            classification.append("Collaborative Procurement Candidate")
        if legacy_count > cpse_count:
            classification.append("Material Rationalization Opportunity")
        if cpse_count > 1:
            classification.append("Cross-CPSE Opportunity")

        items.append({
            "national_code": identity.national_code,
            "standard_description": identity.standard_description,
            "category": identity.category,
            "attributes": identity.attributes,
            "cpse_coverage": cpse_count,
            "cpse_total": total_cpses,
            "cpse_coverage_label": f"{cpse_count}/{total_cpses}",
            "cpses": sorted(identity.cpses),
            "legacy_identity_count": legacy_count,
            "record_count": record_count,
            "description_variants": variant_count,
            "uoms": sorted(identity.uoms),
            "material_groups": sorted(identity.material_groups),
            "standardisation_level": round(standardisation_level, 4),
            "opportunity_score": round(opportunity_score, 4),
            "opportunity": _band(opportunity_score),
            "classifications": classification,
            "reasons": reasons,
            "per_cpse_records": per_cpse,
        })

    items.sort(key=lambda i: i["opportunity_score"], reverse=True)

    # CPSE x national identity heatmap.
    heatmap = {
        "cpses": all_cpses,
        "rows": [
            {
                "national_code": item["national_code"],
                "standard_description": item["standard_description"],
                "cells": [item["per_cpse_records"].get(c, 0) for c in all_cpses],
            }
            for item in items
        ],
    }

    return {
        "opportunities": items,
        "heatmap": heatmap,
        "summary": {
            "total_identities": len(items),
            "high": sum(1 for i in items if i["opportunity"] == "HIGH"),
            "medium": sum(1 for i in items if i["opportunity"] == "MEDIUM"),
            "low": sum(1 for i in items if i["opportunity"] == "LOW"),
            "cross_cpse_identities": sum(1 for i in items if i["cpse_coverage"] > 1),
            "total_legacy_identities": sum(i["legacy_identity_count"] for i in items),
            "note": ("Opportunity is scored on CPSE coverage, legacy-code "
                     "duplication and description fragmentation. The dataset "
                     "contains no spend or quantity data, so no monetary "
                     "savings are estimated."),
        },
    }
