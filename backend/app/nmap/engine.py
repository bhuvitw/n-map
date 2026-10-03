"""The N-MAP harmonisation engine.

Holds the in-memory corpus, the retrieval indexes and the national identity
map. Everything expensive (normalisation, DNA extraction, TF-IDF matrices,
identity clustering) is computed once at startup; a request only does a
sparse dot-product plus scoring over a few dozen candidates.

Pipeline:
    raw description
      -> normalisation
      -> Material DNA extraction
      -> candidate retrieval  (TF-IDF word + char n-gram cosine)
      -> similarity scoring   (semantic + attribute + classification)
      -> engineering rules
      -> decision
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np
from rapidfuzz import fuzz
from sklearn.feature_extraction.text import TfidfVectorizer

from . import scoring
from .dna import MaterialDNA, build_standard_description, extract_dna, _fmt
from .identity import NationalIdentity, build_identities, generate_national_code
from .normalize import normalize, sorted_signature

# Blend of the three text-similarity signals.
W_WORD_COSINE = 0.45
W_CHAR_COSINE = 0.30
W_TOKEN_FUZZ = 0.25


@dataclass
class MaterialRecord:
    """One legacy CPSE material, with its precomputed DNA."""

    id: int
    cpse_name: str
    legacy_material_code: str
    legacy_description: str
    legacy_uom: str
    legacy_material_group: str
    original_legacy_code: str = ""
    normalized: str = ""
    dna: MaterialDNA = field(default_factory=MaterialDNA)
    # Ground truth - held for benchmarking only, never read while matching.
    target_national_code: str | None = None
    target_standard_description: str | None = None

    def public_dict(self, include_dna: bool = True) -> dict:
        """Serialised record. Ground-truth labels are deliberately excluded."""
        data = {
            "id": self.id,
            "cpse_name": self.cpse_name,
            "legacy_material_code": self.legacy_material_code,
            "legacy_description": self.legacy_description,
            "legacy_uom": self.legacy_uom,
            "legacy_material_group": self.legacy_material_group,
            "normalized_description": self.normalized,
        }
        if include_dna:
            data["dna"] = self.dna.to_dict()
            data["generated_standard_description"] = build_standard_description(self.dna)
        return data


class HarmonisationEngine:
    """Builds and serves the material intelligence indexes."""

    def __init__(self, records: list[MaterialRecord]):
        self.records: list[MaterialRecord] = records
        self.by_id: dict[int, MaterialRecord] = {r.id: r for r in records}

        corpus = [r.normalized for r in records]
        # Word n-grams carry the engineering terms; char n-grams absorb
        # leftover abbreviation spelling differences.
        self._word_vec = TfidfVectorizer(
            analyzer="word", ngram_range=(1, 2), sublinear_tf=True,
            min_df=1, token_pattern=r"[^\s]+")
        self._char_vec = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)
        self._word_matrix = self._word_vec.fit_transform(corpus)
        self._char_matrix = self._char_vec.fit_transform(corpus)

        # Order-insensitive signature text, used for the fuzzy signal.
        self._signatures = [sorted_signature(r.legacy_description) for r in records]

        self.identities, self.record_to_code = build_identities(records)

        # Optional embedding signal - only if the model is already present
        # locally. The prototype never blocks on a model download.
        self._embedder = None
        self._embeddings = None
        if os.getenv("NMAP_ENABLE_EMBEDDINGS", "").lower() in {"1", "true", "yes"}:
            self._try_load_embeddings(corpus)

    # --- optional embeddings ---------------------------------------------
    def _try_load_embeddings(self, corpus: list[str]) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except Exception:
            return
        try:
            model_name = os.getenv("NMAP_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
            self._embedder = SentenceTransformer(model_name)
            self._embeddings = self._embedder.encode(
                corpus, normalize_embeddings=True, show_progress_bar=False)
        except Exception:
            self._embedder = None
            self._embeddings = None

    @property
    def embeddings_enabled(self) -> bool:
        return self._embeddings is not None

    # --- retrieval --------------------------------------------------------
    def _semantic_scores(self, text: str, candidate_idx: np.ndarray) -> np.ndarray:
        """Blended text similarity of `text` against the given candidates."""
        normalized = normalize(text)
        word_sim = (self._word_vec.transform([normalized])
                    @ self._word_matrix[candidate_idx].T).toarray()[0]
        char_sim = (self._char_vec.transform([normalized])
                    @ self._char_matrix[candidate_idx].T).toarray()[0]

        query_sig = sorted_signature(text)
        fuzz_sim = np.array([
            fuzz.token_set_ratio(query_sig, self._signatures[i]) / 100.0
            for i in candidate_idx])

        blended = (W_WORD_COSINE * word_sim
                   + W_CHAR_COSINE * char_sim
                   + W_TOKEN_FUZZ * fuzz_sim)

        if self._embeddings is not None:
            query_vec = self._embedder.encode([normalized], normalize_embeddings=True)[0]
            emb_sim = self._embeddings[candidate_idx] @ query_vec
            blended = 0.75 * blended + 0.25 * emb_sim

        return np.clip(blended, 0.0, 1.0)

    def _retrieve(self, text: str, pool: int) -> np.ndarray:
        """Cheap first-stage retrieval: top-`pool` by word+char cosine."""
        normalized = normalize(text)
        word_sim = (self._word_vec.transform([normalized])
                    @ self._word_matrix.T).toarray()[0]
        char_sim = (self._char_vec.transform([normalized])
                    @ self._char_matrix.T).toarray()[0]
        rough = 0.6 * word_sim + 0.4 * char_sim
        pool = min(pool, len(self.records))
        return np.argpartition(-rough, pool - 1)[:pool]

    # --- public API -------------------------------------------------------
    def interpret(self, query: str, uom: str | None = None,
                  material_group: str | None = None) -> MaterialDNA:
        """Material DNA of a free-text query."""
        return extract_dna(query, uom, material_group)

    def search(self, query: str, top_k: int = 10, pool: int = 200,
               uom: str | None = None, material_group: str | None = None,
               exclude_id: int | None = None) -> dict:
        """Natural-language search returning scored, explained candidates."""
        query_dna = self.interpret(query, uom, material_group)
        candidate_idx = self._retrieve(query, pool)
        semantic = self._semantic_scores(query, candidate_idx)

        scored: list[tuple[float, MaterialRecord, scoring.ScoreBreakdown]] = []
        for position, record_idx in enumerate(candidate_idx):
            record = self.records[int(record_idx)]
            if exclude_id is not None and record.id == exclude_id:
                continue
            breakdown = scoring.decide(query_dna, record.dna, float(semantic[position]))
            scored.append((breakdown.final_score, record, breakdown))

        # Mergeable decisions first, then by score - so a confident
        # DO_NOT_MERGE never outranks a genuine match.
        rank = {scoring.IDENTITY_MATCH: 0, scoring.POTENTIAL_EQUIVALENT: 1,
                scoring.REVIEW_REQUIRED: 2, scoring.INSUFFICIENT_EVIDENCE: 3,
                scoring.DO_NOT_MERGE: 4}
        scored.sort(key=lambda t: (rank.get(t[2].decision, 9), -t[0]))

        candidates = []
        for _score, record, breakdown in scored[:top_k]:
            candidates.append({
                "record": record.public_dict(include_dna=False),
                "dna": record.dna.to_dict(),
                "score": breakdown.to_dict(),
                "national_code": self.record_to_code.get(record.id),
            })

        recommendation = self._recommend(query_dna, scored)
        return {
            "query": query,
            "query_dna": query_dna.to_dict(),
            "interpreted_description": build_standard_description(query_dna),
            "candidates": candidates,
            "recommendation": recommendation,
            "pool_searched": int(len(candidate_idx)),
            "total_records": len(self.records),
        }

    def _recommend(self, query_dna: MaterialDNA, scored: list) -> dict:
        """Recommend a national code for the query.

        If the query's DNA matches an already-inferred identity, reuse that
        code; otherwise mint a new deterministic one from the query's DNA.
        """
        mergeable = [(s, r, b) for s, r, b in scored
                     if b.decision in scoring.MERGEABLE]
        proposed_code = generate_national_code(query_dna)
        existing = self.identities.get(proposed_code)

        if mergeable and existing is None:
            # Fall back to the identity of the strongest accepted candidate.
            best_record = mergeable[0][1]
            code = self.record_to_code.get(best_record.id)
            existing = self.identities.get(code) if code else None

        if existing is not None:
            return {
                "national_code": existing.national_code,
                "standard_description": existing.standard_description,
                "status": "EXISTING_NATIONAL_IDENTITY",
                "cpse_coverage": sorted(existing.cpses),
                "record_count": existing.record_count,
                "legacy_identity_count": len(existing.legacy_codes),
                "supporting_matches": len(mergeable),
            }
        return {
            "national_code": proposed_code,
            "standard_description": build_standard_description(query_dna),
            "status": "NEW_NATIONAL_IDENTITY_PROPOSED",
            "cpse_coverage": [],
            "record_count": 0,
            "legacy_identity_count": 0,
            "supporting_matches": len(mergeable),
        }

    def compare_records(self, id_a: int, id_b: int) -> dict:
        """Full side-by-side comparison of two stored records."""
        rec_a, rec_b = self.by_id.get(id_a), self.by_id.get(id_b)
        if rec_a is None or rec_b is None:
            raise KeyError("material not found")
        idx_b = np.array([self.records.index(rec_b)])
        semantic = float(self._semantic_scores(rec_a.legacy_description, idx_b)[0])
        breakdown = scoring.decide(rec_a.dna, rec_b.dna, semantic)
        return self._comparison_payload(
            rec_a.public_dict(), rec_b.public_dict(), breakdown,
            self.record_to_code.get(rec_a.id), self.record_to_code.get(rec_b.id))

    def compare_query(self, query: str, id_b: int, uom: str | None = None,
                      material_group: str | None = None) -> dict:
        """Compare a free-text query against one stored record."""
        rec_b = self.by_id.get(id_b)
        if rec_b is None:
            raise KeyError("material not found")
        query_dna = self.interpret(query, uom, material_group)
        idx_b = np.array([self.records.index(rec_b)])
        semantic = float(self._semantic_scores(query, idx_b)[0])
        breakdown = scoring.decide(query_dna, rec_b.dna, semantic)
        left = {
            "id": None,
            "cpse_name": "QUERY",
            "legacy_material_code": "SEARCH QUERY",
            "legacy_description": query,
            "legacy_uom": uom or "",
            "legacy_material_group": material_group or "",
            "normalized_description": normalize(query),
            "dna": query_dna.to_dict(),
            "generated_standard_description": build_standard_description(query_dna),
        }
        return self._comparison_payload(
            left, rec_b.public_dict(), breakdown,
            generate_national_code(query_dna), self.record_to_code.get(rec_b.id))

    def _comparison_payload(self, left: dict, right: dict,
                            breakdown: scoring.ScoreBreakdown,
                            code_a: str | None, code_b: str | None) -> dict:
        return {
            "material_a": left,
            "material_b": right,
            "score": breakdown.to_dict(),
            "national_code_a": code_a,
            "national_code_b": code_b,
            "same_national_identity": bool(code_a and code_a == code_b),
            "recommended_national_code": (
                code_b if breakdown.decision in scoring.MERGEABLE else None),
        }

    # --- aggregate views --------------------------------------------------
    def identity_list(self) -> list[NationalIdentity]:
        return sorted(self.identities.values(),
                      key=lambda i: i.record_count, reverse=True)

    def identity_graph(self, national_code: str, limit_per_cpse: int = 4) -> dict:
        """Centre node = national identity, leaves = contributing CPSE records."""
        identity = self.identities.get(national_code)
        if identity is None:
            raise KeyError("national code not found")

        grouped: dict[str, list[MaterialRecord]] = {}
        for member_id in identity.member_ids:
            record = self.by_id[member_id]
            grouped.setdefault(record.cpse_name, []).append(record)

        cpse_nodes = []
        for cpse, records in sorted(grouped.items()):
            cpse_nodes.append({
                "cpse_name": cpse,
                "record_count": len(records),
                "materials": [r.public_dict() for r in records[:limit_per_cpse]],
            })

        return {
            "national_code": identity.national_code,
            "standard_description": identity.standard_description,
            "category": identity.category,
            "attributes": identity.attributes,
            "record_count": identity.record_count,
            "legacy_identity_count": len(identity.legacy_codes),
            "cpse_count": len(identity.cpses),
            "cpses": cpse_nodes,
        }
