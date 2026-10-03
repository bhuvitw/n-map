"""Reproducible evaluation of the harmonisation engine.

This is the ONLY module that reads Target_National_Code. The matching engine
never sees it; here it serves purely as held-out ground truth.

Two complementary measurements are reported:

1. Harmonisation (clustering) quality - exact pairwise precision / recall / F1
   over every pair of records, computed analytically from the contingency
   table between inferred national identities and ground-truth codes. No
   sampling, no approximation.

2. Retrieval quality - for a seeded sample of records, the engine searches the
   corpus for the record's best match and we check whether that match really
   belongs to the same national identity.

Nothing is hardcoded: every number below is derived from the live engine.
"""
from __future__ import annotations

import random
from collections import Counter, defaultdict

from . import scoring


def _pairs(n: int) -> int:
    """Number of unordered pairs in a group of n items."""
    return n * (n - 1) // 2


def clustering_metrics(engine) -> dict:
    """Exact pairwise precision/recall/F1 of the inferred national identities.

    A "positive" is a pair of legacy records placed under the same national
    identity. Computing this from the contingency table is exact and covers
    all ~12.5M pairs without enumerating them.
    """
    labelled = [r for r in engine.records if r.target_national_code]
    contingency: dict[tuple[str, str], int] = Counter()
    predicted_sizes: Counter = Counter()
    truth_sizes: Counter = Counter()

    for record in labelled:
        predicted = engine.record_to_code.get(record.id)
        truth = record.target_national_code
        if predicted is None:
            continue
        contingency[(predicted, truth)] += 1
        predicted_sizes[predicted] += 1
        truth_sizes[truth] += 1

    true_positives = sum(_pairs(n) for n in contingency.values())
    predicted_positives = sum(_pairs(n) for n in predicted_sizes.values())
    actual_positives = sum(_pairs(n) for n in truth_sizes.values())

    precision = true_positives / predicted_positives if predicted_positives else 0.0
    recall = true_positives / actual_positives if actual_positives else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    # How each inferred identity lines up with the ground-truth codes.
    by_predicted: dict[str, Counter] = defaultdict(Counter)
    for (predicted, truth), count in contingency.items():
        by_predicted[predicted][truth] = count

    alignment = []
    correct_assignments = 0
    for predicted, truths in sorted(by_predicted.items(),
                                    key=lambda kv: -sum(kv[1].values())):
        dominant, dominant_count = truths.most_common(1)[0]
        total = sum(truths.values())
        correct_assignments += dominant_count
        identity = engine.identities.get(predicted)
        alignment.append({
            "predicted_national_code": predicted,
            "generated_standard_description": (
                identity.standard_description if identity else None),
            "dominant_target_code": dominant,
            "records": total,
            "aligned_records": dominant_count,
            "mixed_records": total - dominant_count,
            "purity": round(dominant_count / total, 4) if total else 0.0,
            "target_breakdown": dict(truths),
        })

    return {
        "evaluated_records": len(labelled),
        "inferred_identities": len(predicted_sizes),
        "ground_truth_identities": len(truth_sizes),
        "pair_true_positives": true_positives,
        "pair_predicted_positives": predicted_positives,
        "pair_actual_positives": actual_positives,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "cluster_purity": round(correct_assignments / len(labelled), 4) if labelled else 0.0,
        "correct_assignments": correct_assignments,
        "incorrect_assignments": len(labelled) - correct_assignments,
        "alignment": alignment,
    }


def retrieval_metrics(engine, sample_size: int = 300, seed: int = 42,
                      top_k: int = 1) -> dict:
    """Top-1 match quality on a reproducible random sample.

    For each sampled record the engine searches the rest of the corpus. The
    prediction is "merge" when the best candidate's decision is an identity
    match or potential equivalent.
    """
    labelled = [r for r in engine.records if r.target_national_code]
    rng = random.Random(seed)
    sample = rng.sample(labelled, min(sample_size, len(labelled)))

    true_positives = false_positives = false_negatives = 0
    decisions: Counter = Counter()
    errors: list[dict] = []

    for record in sample:
        result = engine.search(record.legacy_description, top_k=top_k, pool=120,
                               uom=record.legacy_uom,
                               material_group=record.legacy_material_group,
                               exclude_id=record.id)
        candidates = result["candidates"]
        if not candidates:
            false_negatives += 1
            decisions["NO_CANDIDATE"] += 1
            continue

        best = candidates[0]
        decision = best["score"]["decision"]
        decisions[decision] += 1
        matched_record = engine.by_id[best["record"]["id"]]
        same_identity = (matched_record.target_national_code
                         == record.target_national_code)
        predicted_merge = decision in scoring.MERGEABLE

        if predicted_merge and same_identity:
            true_positives += 1
        elif predicted_merge and not same_identity:
            false_positives += 1
            errors.append({
                "cpse_name": record.cpse_name,
                "legacy_material_code": record.legacy_material_code,
                "legacy_description": record.legacy_description,
                "matched_legacy_code": matched_record.legacy_material_code,
                "matched_description": matched_record.legacy_description,
                "decision": decision,
                "final_score": best["score"]["final_score"],
                "error_type": "FALSE_MERGE",
                "target_national_code": record.target_national_code,
                "matched_target_national_code": matched_record.target_national_code,
            })
        else:
            # A same-identity record exists in the corpus but was not accepted.
            false_negatives += 1
            errors.append({
                "cpse_name": record.cpse_name,
                "legacy_material_code": record.legacy_material_code,
                "legacy_description": record.legacy_description,
                "matched_legacy_code": matched_record.legacy_material_code,
                "matched_description": matched_record.legacy_description,
                "decision": decision,
                "final_score": best["score"]["final_score"],
                "error_type": "MISSED_MERGE",
                "target_national_code": record.target_national_code,
                "matched_target_national_code": matched_record.target_national_code,
            })

    precision = (true_positives / (true_positives + false_positives)
                 if (true_positives + false_positives) else 0.0)
    recall = (true_positives / (true_positives + false_negatives)
              if (true_positives + false_negatives) else 0.0)
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return {
        "sample_size": len(sample),
        "seed": seed,
        "correct_matches": true_positives,
        "incorrect_matches": false_positives,
        "missed_matches": false_negatives,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "decision_distribution": dict(decisions),
        "errors": errors[:40],
        "error_count": len(errors),
    }


def dna_coverage(engine) -> dict:
    """How much structured DNA the extractor recovers from the raw corpus."""
    counts: Counter = Counter()
    total = len(engine.records)
    for record in engine.records:
        for key, value in record.dna.attributes.items():
            if key.endswith("_source") or key in {
                    "uom", "uom_family", "material_group", "data_quality_flag"}:
                continue
            if value not in (None, ""):
                counts[key] += 1
    return {
        "total_records": total,
        "attributes": [
            {"attribute": key, "records": count,
             "coverage": round(count / total, 4) if total else 0.0}
            for key, count in counts.most_common()
        ],
    }


# Engineered hard negatives: each probe is a near-identical description with
# exactly ONE critical engineering attribute altered. Text similarity stays
# very high, so only the rule layer can reject them. This measures the
# property that matters most in a material master: not merging things that
# must stay separate.
HARD_NEGATIVES: list[dict] = [
    {"probe": "SEAMLESS CARBON STEEL ASTM A106 GRADE B 6 INCH PIPE",
     "against": {"category": "PIPE", "size_inch": 4.0},
     "altered_attribute": "Nominal Size", "detail": "6 inch vs 4 inch"},
    {"probe": "SEAMLESS CARBON STEEL ASTM A106 GRADE C 4 INCH PIPE",
     "against": {"category": "PIPE", "size_inch": 4.0},
     "altered_attribute": "Grade", "detail": "Grade C vs Grade B"},
    {"probe": "WELDED CARBON STEEL ASTM A106 GRADE B 4 INCH PIPE",
     "against": {"category": "PIPE", "size_inch": 4.0},
     "altered_attribute": "Construction", "detail": "Welded vs Seamless"},
    {"probe": "GATE VALVE FLANGED CLASS 300 WCB 2 INCH",
     "against": {"category": "VALVE", "size_inch": 2.0},
     "altered_attribute": "Pressure Class", "detail": "Class 300 vs Class 150"},
    {"probe": "GATE VALVE FLANGED CLASS 150 WCB 4 INCH",
     "against": {"category": "VALVE", "size_inch": 2.0},
     "altered_attribute": "Nominal Size", "detail": "4 inch vs 2 inch"},
    {"probe": "GLOBE VALVE FLANGED CLASS 150 WCB 2 INCH",
     "against": {"category": "VALVE", "size_inch": 2.0},
     "altered_attribute": "Valve Type", "detail": "Globe vs Gate"},
    {"probe": "BALL BEARING DEEP GROOVE SKF 6305",
     "against": {"category": "BEARING", "model": "6205"},
     "altered_attribute": "Model", "detail": "6305 vs 6205"},
    {"probe": "CABLE 4 CORE 2.5 SQMM COPPER ARMOURED",
     "against": {"category": "CABLE", "cores": 3.0},
     "altered_attribute": "Cores", "detail": "4 core vs 3 core"},
    {"probe": "CABLE 3 CORE 4 SQMM COPPER ARMOURED",
     "against": {"category": "CABLE", "cores": 3.0},
     "altered_attribute": "Cross Section", "detail": "4 sqmm vs 2.5 sqmm"},
    {"probe": "CABLE 3 CORE 2.5 SQMM ALUMINIUM ARMOURED",
     "against": {"category": "CABLE", "cores": 3.0},
     "altered_attribute": "Material", "detail": "Aluminium vs Copper"},
    {"probe": "STEEL PLATE MILD STEEL IS 2062 12MM THICKNESS",
     "against": {"category": "PLATE", "thickness_mm": 10.0},
     "altered_attribute": "Thickness", "detail": "12mm vs 10mm"},
    {"probe": "STEEL PLATE STAINLESS STEEL IS 2062 10MM THICKNESS",
     "against": {"category": "PLATE", "thickness_mm": 10.0},
     "altered_attribute": "Material", "detail": "Stainless vs Mild Steel"},
]


def rule_stress_test(engine) -> dict:
    """Check the engine refuses merges that differ by one critical attribute.

    Each probe is matched against a real corpus record of the same category.
    A correct outcome is DO_NOT_MERGE; anything mergeable is a false merge.
    """
    results: list[dict] = []
    correct = 0

    for case in HARD_NEGATIVES:
        wanted = case["against"]
        reference = next(
            (r for r in engine.records
             if all(str(r.dna.get(k)) == str(v) for k, v in wanted.items())),
            None)
        if reference is None:
            continue

        comparison = engine.compare_query(case["probe"], reference.id,
                                          uom=reference.legacy_uom)
        score = comparison["score"]
        rejected = score["decision"] not in scoring.MERGEABLE
        if rejected:
            correct += 1

        results.append({
            "probe": case["probe"],
            "altered_attribute": case["altered_attribute"],
            "detail": case["detail"],
            "reference_cpse": reference.cpse_name,
            "reference_legacy_code": reference.legacy_material_code,
            "reference_description": reference.legacy_description,
            "semantic_score": score["semantic_score"],
            "final_score": score["final_score"],
            "decision": score["decision"],
            "critical_conflicts": score["critical_conflicts"],
            "correctly_rejected": rejected,
            "primary_reason": score["reasons"][0] if score["reasons"] else None,
        })

    total = len(results)
    high_text_similarity = [r for r in results if r["semantic_score"] >= 0.6]
    return {
        "total_probes": total,
        "correctly_rejected": correct,
        "false_merges": total - correct,
        "rejection_rate": round(correct / total, 4) if total else 0.0,
        "mean_semantic_score_of_probes": (
            round(sum(r["semantic_score"] for r in results) / total, 4)
            if total else 0.0),
        "probes_with_high_text_similarity": len(high_text_similarity),
        "results": results,
        "note": ("Each probe alters exactly one critical attribute while "
                 "keeping the wording almost identical. A text-similarity-only "
                 "matcher would merge these; the engineering-rule layer must "
                 "reject them."),
    }


def run_benchmark(engine, sample_size: int = 300, seed: int = 42) -> dict:
    """Full reproducible benchmark report."""
    return {
        "harmonisation": clustering_metrics(engine),
        "retrieval": retrieval_metrics(engine, sample_size=sample_size, seed=seed),
        "rule_stress_test": rule_stress_test(engine),
        "dna_coverage": dna_coverage(engine),
        "methodology": {
            "ground_truth_columns": ["Target_National_Code",
                                     "Target_Standard_Description"],
            "used_as_features": False,
            "notes": [
                "Target_National_Code is read only in this evaluation module.",
                "The matching engine receives description, UOM and material "
                "group only.",
                "Harmonisation precision/recall/F1 are exact pairwise metrics "
                "computed from the contingency table over all record pairs.",
                "Retrieval metrics use a fixed random seed so runs are "
                "reproducible.",
                "The dataset contains 5 well-separated material concepts, so "
                "high clustering scores are expected. The rule stress test is "
                "the harder measurement.",
            ],
        },
    }
