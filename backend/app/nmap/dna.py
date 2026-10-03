"""Material DNA extraction.

A legacy description is turned into a structured, comparable fingerprint:

    "CARBON SMLS IN ASTM GRADE A106 4 B PIPE STEEL"
      -> category=PIPE, material=CARBON STEEL, standard=ASTM A106,
         grade=B, construction=SEAMLESS, size_inch=4.0

Design note: legacy CPSE descriptions arrive with their token order shuffled,
so positional regex ("4 INCH" as adjacent words) is unreliable. Instead we
treat the description as a *bag of tokens* and resolve numeric slots by
pairing them with unit markers and known engineering value dictionaries,
consuming each number once in order of decreasing specificity.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import vocab
from .normalize import canonical_tokens

_NUMBER = re.compile(r"^\d+(?:\.\d+)?$")
_HASH_CLASS = re.compile(r"^(\d+)#$")

# Nominal pipe/valve sizes in inches that we accept for a bare number.
_PLAUSIBLE_INCH = {0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0,
                   6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 24.0, 30.0,
                   36.0, 42.0, 48.0}
_STANDARD_CLASSES = {150.0, 300.0, 400.0, 600.0, 800.0, 900.0, 1500.0, 2500.0}
_PLAUSIBLE_CORES = {1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0, 19.0, 24.0}
# Standard IEC/IS conductor cross-sections. Deliberately excludes 3, so a
# shuffled "SQMM 3 CORE 2.5" cannot read the core count as the area.
_CABLE_SQMM = {0.5, 0.75, 1.0, 1.5, 2.5, 4.0, 6.0, 10.0, 16.0, 25.0, 35.0,
               50.0, 70.0, 95.0, 120.0, 150.0, 185.0, 240.0, 300.0, 400.0,
               500.0, 630.0}


@dataclass
class MaterialDNA:
    """Structured fingerprint of one material description."""

    attributes: dict[str, object] = field(default_factory=dict)
    tokens: list[str] = field(default_factory=list)
    normalized: str = ""
    # Tokens that carried no attribute meaning - useful for transparency.
    unmapped: list[str] = field(default_factory=list)

    def get(self, key: str):
        return self.attributes.get(key)

    def signature(self) -> str:
        """Deterministic key identifying this material concept."""
        parts = []
        for key, _label in vocab.ATTRIBUTE_LABELS:
            if (key in vocab.SOFT_ATTRIBUTES or key.endswith("_source")
                    or key == "data_quality_flag"):
                continue
            val = self.attributes.get(key)
            if val not in (None, ""):
                parts.append(f"{key}={_fmt(val)}")
        return "|".join(parts)

    def to_dict(self) -> dict:
        return {
            "attributes": {k: _fmt(v) for k, v in self.attributes.items()},
            "normalized": self.normalized,
            "tokens": self.tokens,
            "unmapped": self.unmapped,
            "signature": self.signature(),
        }


def _fmt(val) -> str:
    """Render an attribute value for display / comparison."""
    if isinstance(val, float):
        return str(int(val)) if val.is_integer() else str(val)
    return str(val)


def _find_phrase(tokens: list[str], phrase: str) -> bool:
    """True if all words of a (possibly multi-word) phrase are present.

    Order-insensitive on purpose: "DEEP GROOVE" survives shuffling into
    "GROOVE ... DEEP".
    """
    return all(word in tokens for word in phrase.split(" "))


def extract_dna(description: str, uom: str | None = None,
                material_group: str | None = None) -> MaterialDNA:
    """Extract Material DNA from a raw legacy description."""
    tokens = canonical_tokens(description)
    token_set = set(tokens)
    attrs: dict[str, object] = {}
    consumed: set[int] = set()  # indices into `numbers`

    # Numeric tokens, kept with their position so each is consumed only once.
    numbers: list[float] = []
    for tok in tokens:
        if _NUMBER.match(tok):
            numbers.append(float(tok))
        else:
            hashed = _HASH_CLASS.match(tok)
            if hashed:
                numbers.append(float(hashed.group(1)))

    def take(predicate, *, exclude: set[int] = frozenset()) -> float | None:
        """Consume the first unconsumed number matching `predicate`."""
        for idx, num in enumerate(numbers):
            if idx in consumed or idx in exclude:
                continue
            if predicate(num):
                consumed.add(idx)
                return num
        return None

    # --- 1. Category ---------------------------------------------------
    # Resolved first: the numeric slots below are category-conditional, and
    # degraded descriptions sometimes drop the category word altogether
    # ("BALL DEEP GROOVE SKF 6205"), in which case the ERP material group is
    # the next best evidence.
    for candidate in vocab.CATEGORY_PRIORITY:
        keywords = vocab.CATEGORY_KEYWORDS.get(candidate, [])
        if any(_find_phrase(tokens, kw) for kw in keywords):
            attrs["category"] = candidate
            attrs["category_source"] = "description"
            break
    if "category" not in attrs:
        uom_family = vocab.UOM_FAMILY.get((uom or "").upper())
        inferred = _infer_category_from_evidence(token_set, uom_family)
        if inferred:
            attrs["category"] = inferred
            attrs["category_source"] = "attribute_evidence"
    if "category" not in attrs and material_group:
        inferred = _category_from_group(material_group)
        if inferred:
            attrs["category"] = inferred
            attrs["category_source"] = "erp_material_group"
    category = attrs.get("category")

    # Flag records whose ERP material group contradicts the engineering
    # evidence - a data-quality exception the review queue should see.
    if category and material_group:
        group_category = _category_from_group(material_group)
        if group_category and group_category != category:
            attrs["data_quality_flag"] = (
                f"ERP material group '{material_group}' implies "
                f"{group_category}, engineering attributes indicate {category}")

    # --- 2. Standard (body + number, order independent) ---------------
    std_numbers = [t for t in tokens if t in vocab.STANDARD_NUMBERS]
    bodies = [t for t in tokens if t in vocab.STANDARD_BODIES]
    if std_numbers:
        number = std_numbers[0]
        body = vocab.STANDARD_NUMBERS[number]
        # Prefer an explicitly stated body, else infer from the number.
        if body not in bodies and bodies:
            body = bodies[0]
        attrs["standard"] = f"{body} {number}"
        # The standard's numeric part must not be re-read as a dimension.
        if _NUMBER.match(number):
            take(lambda n, target=float(number): n == target)
    elif bodies:
        attrs["standard"] = bodies[0]

    # --- 3. Pressure class --------------------------------------------
    if "CLASS" in token_set or any(_HASH_CLASS.match(t) for t in tokens):
        klass = take(lambda n: n in _STANDARD_CLASSES)
        if klass is not None:
            attrs["pressure_class"] = f"CLASS {_fmt(klass)}"
    elif "PN" in token_set:
        klass = take(lambda n: n <= 100)
        if klass is not None:
            attrs["pressure_class"] = f"PN {_fmt(klass)}"

    if "pressure_class" not in attrs and category == "VALVE":
        klass = take(lambda n: n in _STANDARD_CLASSES)
        if klass is not None:
            attrs["pressure_class"] = f"CLASS {_fmt(klass)}"
            attrs["pressure_class_source"] = "inferred"

    # --- 4. Cable cores ------------------------------------------------
    # Resolved before the cross-section: with the tokens shuffled, "3" and
    # "2.5" are both plain numbers, so the core count is claimed first from
    # the explicit CORE marker.
    if "CORE" in token_set:
        cores = take(lambda n: n in _PLAUSIBLE_CORES)
        if cores is not None:
            attrs["cores"] = cores

    # --- 5. Cable cross-section ----------------------------------------
    if "SQMM" in token_set:
        # Prefer a fractional value (2.5, 1.5, 0.75): a core count is never
        # fractional, so this disambiguates even when CORE was dropped.
        area = take(lambda n: n in _CABLE_SQMM and not n.is_integer())
        if area is None:
            area = take(lambda n: n in _CABLE_SQMM)
        if area is not None:
            attrs["cross_section_sqmm"] = area

    if category == "CABLE" and "cross_section_sqmm" not in attrs:
        area = take(lambda n: n in _CABLE_SQMM and not n.is_integer())
        if area is not None:
            attrs["cross_section_sqmm"] = area
            attrs["cross_section_source"] = "inferred"

    # --- 6. Cable cores, marker dropped --------------------------------
    if category == "CABLE" and "cores" not in attrs:
        cores = take(lambda n: n in _PLAUSIBLE_CORES)
        if cores is not None:
            attrs["cores"] = cores
            attrs["cores_source"] = "inferred"

    # --- 7. Thickness (plates) -----------------------------------------
    if "MM" in token_set and ("THICKNESS" in token_set or category == "PLATE"):
        thickness = take(lambda n: 0.1 <= n <= 300)
        if thickness is not None:
            attrs["thickness_mm"] = thickness

    # --- 8. Bearing designation ----------------------------------------
    if category == "BEARING":
        model = take(lambda n: n >= 1000 and float(n).is_integer())
        if model is not None:
            attrs["model"] = _fmt(model)

    # --- 9. Nominal size in inches -------------------------------------
    if "INCH" in token_set:
        size = take(lambda n: n in _PLAUSIBLE_INCH)
        if size is not None:
            attrs["size_inch"] = size
    if "size_inch" not in attrs and category in {"PIPE", "VALVE", "FLANGE"}:
        # Degraded descriptions drop the inch marker entirely; a leftover
        # plausible NPS value in pipe/valve context is the nominal size.
        size = take(lambda n: n in _PLAUSIBLE_INCH)
        if size is not None:
            attrs["size_inch"] = size

    # --- 10. Material --------------------------------------------------
    for token in tokens:
        if token in vocab.BODY_MATERIALS:
            attrs["material"] = vocab.BODY_MATERIALS[token]
            attrs["body_spec"] = token
            break
    if "material" not in attrs:
        for canonical, words in vocab.MATERIAL_PATTERNS:
            if _find_phrase(tokens, " ".join(words)):
                attrs["material"] = canonical
                break
    if "material" not in attrs:
        # Last resort: a lone alloy qualifier whose "STEEL" token was dropped.
        for qualifier, canonical in (("CARBON", "CARBON STEEL"),
                                     ("MILD", "MILD STEEL"),
                                     ("STAINLESS", "STAINLESS STEEL")):
            if qualifier in token_set:
                attrs["material"] = canonical
                attrs["material_source"] = "inferred"
                break

    # --- 11. Grade -----------------------------------------------------
    if "GRADE" in token_set:
        for token in tokens:
            if token in vocab.GRADE_TOKENS and token not in vocab.STANDARD_BODIES:
                attrs["grade"] = token
                break

    if "grade" not in attrs and attrs.get("standard"):
        # A bare grade letter is only trustworthy next to a named standard
        # (e.g. ASTM A106 + "B" -> Grade B).
        for token in tokens:
            if (token in vocab.GRADE_TOKENS and len(token) == 1
                    and token not in vocab.STANDARD_BODIES):
                attrs["grade"] = token
                attrs["grade_source"] = "inferred"
                break

    # --- 12. Construction / type ---------------------------------------
    if category == "VALVE":
        for valve_type in vocab.TYPE_KEYWORDS["VALVE"]:
            if _find_phrase(tokens, valve_type):
                attrs["valve_type"] = valve_type
                break
    if category:
        descriptors = [d for d in vocab.TYPE_KEYWORDS.get(category, [])
                       if _find_phrase(tokens, d)]
        if category == "VALVE":
            descriptors = [d for d in descriptors if d != attrs.get("valve_type")]
        if descriptors:
            # Longest phrase wins ("DEEP GROOVE" over "BALL").
            attrs["construction"] = max(descriptors, key=lambda d: len(d.split()))

    # --- 13. End connection --------------------------------------------
    for conn in vocab.END_CONNECTIONS:
        if conn in token_set:
            attrs["end_connection"] = conn
            break

    # --- 14. Manufacturer ----------------------------------------------
    for maker in vocab.BEARING_MANUFACTURERS:
        if maker in token_set:
            attrs["manufacturer"] = maker
            break

    # --- Context from structured ERP columns ---------------------------
    if uom:
        attrs["uom"] = uom.upper()
        attrs["uom_family"] = vocab.UOM_FAMILY.get(uom.upper(), "OTHER")
    if material_group:
        attrs["material_group"] = material_group

    known = _mapped_tokens(attrs)
    unmapped = [t for t in dict.fromkeys(tokens) if t not in known]

    return MaterialDNA(
        attributes=attrs,
        tokens=tokens,
        normalized=" ".join(tokens),
        unmapped=unmapped,
    )


# Discriminating token evidence -> category. Applied when the description
# never names the category outright. Each rule needs corroborating evidence
# so a single stray token cannot reclassify a material.
def _infer_category_from_evidence(token_set: set[str], uom_family: str | None
                                  ) -> str | None:
    """Infer the category from engineering evidence in the description."""
    has = token_set.__contains__

    if has("SQMM") or has("CORE"):
        return "CABLE"
    if has("GROOVE") or (any(has(m) for m in vocab.BEARING_MANUFACTURERS)
                         and any(t.isdigit() and len(t) == 4 for t in token_set)):
        return "BEARING"
    if any(has(v) for v in vocab.TYPE_KEYWORDS["VALVE"]) and (
            has("CLASS") or has("FLANGED")):
        return "VALVE"
    if (has("SEAMLESS") or has("WELDED")) and (has("INCH") or uom_family == "LENGTH"):
        return "PIPE"
    if has("THICKNESS") and uom_family == "MASS":
        return "PLATE"
    return None


_GROUP_TO_CATEGORY = {
    "PIPES & TUBES": "PIPE",
    "VALVES": "VALVE",
    "ELECTRICAL": "CABLE",
    "STRUCTURAL STEEL": "PLATE",
    "MECHANICAL COMPONENTS": "BEARING",
}


def _category_from_group(material_group: str) -> str | None:
    """Fall back to the ERP material group when the text names no category."""
    return _GROUP_TO_CATEGORY.get((material_group or "").upper())


def _mapped_tokens(attrs: dict) -> set[str]:
    """Tokens explained by an extracted attribute (for the unmapped list)."""
    mapped: set[str] = set()
    for key, val in attrs.items():
        if key.endswith("_source") or key in {"uom", "uom_family",
                                              "material_group",
                                              "data_quality_flag"}:
            continue
        for word in _fmt(val).replace("CLASS ", "").split(" "):
            mapped.add(word)
    mapped.update({"INCH", "MM", "SQMM", "CORE", "CLASS", "GRADE", "THICKNESS"})
    return mapped


def build_standard_description(dna: MaterialDNA) -> str:
    """Compose a canonical national description from extracted attributes.

    Mirrors the house style of a national material master: category first,
    then construction, material, standard/grade, then dimensions.
    """
    a = dna.attributes
    parts: list[str] = []

    if a.get("valve_type"):
        parts.append(_fmt(a["valve_type"]))
    if a.get("category"):
        parts.append(_fmt(a["category"]))
    if a.get("construction") and a.get("construction") != a.get("valve_type"):
        parts.append(_fmt(a["construction"]))
    if a.get("end_connection") and a.get("end_connection") != a.get("construction"):
        parts.append(_fmt(a["end_connection"]))
    if a.get("material"):
        parts.append(_fmt(a["material"]))
    if a.get("standard"):
        parts.append(_fmt(a["standard"]))
    if a.get("grade"):
        parts.append(f"GRADE {_fmt(a['grade'])}")
    if a.get("body_spec") and a.get("body_spec") != a.get("grade"):
        parts.append(_fmt(a["body_spec"]))
    if a.get("pressure_class"):
        parts.append(_fmt(a["pressure_class"]))
    if a.get("manufacturer"):
        parts.append(_fmt(a["manufacturer"]))
    if a.get("model"):
        parts.append(_fmt(a["model"]))
    if a.get("cores"):
        parts.append(f"{_fmt(a['cores'])} CORE")
    if a.get("cross_section_sqmm"):
        parts.append(f"{_fmt(a['cross_section_sqmm'])} SQMM")
    if a.get("size_inch"):
        parts.append(f"{_fmt(a['size_inch'])} INCH")
    if a.get("thickness_mm"):
        parts.append(f"{_fmt(a['thickness_mm'])} MM THICKNESS")

    # De-duplicate while preserving order ("STEEL" may arrive twice).
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            out.append(part)
    return " ".join(out)
