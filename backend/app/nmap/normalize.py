"""Text normalisation for legacy CPSE material descriptions.

Legacy descriptions in the dataset are the same material written six different
ways - token order shuffled, delimiters swapped, abbreviations applied and the
inch symbol mangled into '' or ". Normalisation produces a canonical token
stream so that downstream text similarity and DNA extraction see the same
material as the same material.
"""
from __future__ import annotations

import re

from .vocab import ABBREVIATIONS, STOPWORDS

# Separators used by the various legacy systems: comma, pipe, slash, and the
# " - " dash style. Collapsed to whitespace.
_SEPARATORS = re.compile(r"[,;|/\\–—]+|(?<=\s)-(?=\s)|^-|-$")
# Inch marks: straight quote, double apostrophe, unicode prime/quote.
_INCH_MARKS = re.compile(r"(\"|''|″|”|′)")
_MULTISPACE = re.compile(r"\s+")
# Split a fused number+unit token: 10MM -> 10 MM, 2.5SQMM -> 2.5 SQMM, 4IN.
_FUSED_UNIT = re.compile(
    r"^(\d+(?:\.\d+)?)(MM|CM|M|INCH|IN|SQMM|MM2|KG|MT|NB|DN|C|CORE|#)$"
)
# A trailing period on an abbreviation: GR. -> GR
_TRAILING_DOT = re.compile(r"\.$")


def _clean(text: str) -> str:
    text = (text or "").upper()
    text = _INCH_MARKS.sub(" INCH ", text)
    text = _SEPARATORS.sub(" ", text)
    # Keep alphanumerics, dot (decimals / B16.5), hash (150#) and hyphen.
    text = re.sub(r"[^A-Z0-9.#\- ]+", " ", text)
    return _MULTISPACE.sub(" ", text).strip()


def tokenize(text: str) -> list[str]:
    """Split a description into raw (uppercased, de-delimited) tokens."""
    cleaned = _clean(text)
    if not cleaned:
        return []
    tokens: list[str] = []
    for raw in cleaned.split(" "):
        tok = _TRAILING_DOT.sub("", raw).strip("-")
        if not tok:
            continue
        # Split fused number+unit tokens so "10MM" and "10 MM" agree.
        fused = _FUSED_UNIT.match(tok)
        if fused:
            tokens.extend([fused.group(1), fused.group(2)])
            continue
        tokens.append(tok)
    return tokens


def expand(tokens: list[str]) -> list[str]:
    """Expand abbreviations to canonical engineering words."""
    out: list[str] = []
    for tok in tokens:
        expansion = ABBREVIATIONS.get(tok)
        if expansion:
            out.extend(expansion.split(" "))
        else:
            out.append(tok)
    return out


def canonical_tokens(text: str) -> list[str]:
    """Full pipeline: clean -> tokenize -> expand -> drop stopwords."""
    tokens = expand(tokenize(text))
    return [t for t in tokens if t not in STOPWORDS]


def normalize(text: str) -> str:
    """Canonical normalised string used for TF-IDF and fuzzy matching."""
    return " ".join(canonical_tokens(text))


def sorted_signature(text: str) -> str:
    """Order-insensitive signature - defeats pure token shuffling."""
    return " ".join(sorted(set(canonical_tokens(text))))
