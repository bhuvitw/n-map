"""Engineering vocabulary for N-MAP.

Everything the Material DNA extractor knows about the physical world lives here:
abbreviation expansions, category/material/type dictionaries, known engineering
standards and the per-category rules that decide what counts as a *critical*
attribute.

Kept as plain data so a domain engineer can extend it without touching logic.
"""

# --- Abbreviation / synonym expansion ------------------------------------
# Applied token-by-token after tokenisation. Values may expand to several
# tokens ("SMLS" -> "SEAMLESS").
ABBREVIATIONS: dict[str, str] = {
    # pipes & fittings
    "SMLS": "SEAMLESS",
    "SEEMLESS": "SEAMLESS",
    "SML": "SEAMLESS",
    "WLD": "WELDED",
    "WELD": "WELDED",
    "ERW": "WELDED",
    "PP": "PIPE",
    "PIPES": "PIPE",
    "TUBES": "TUBE",
    "SCH": "SCHEDULE",
    # valves
    "VLV": "VALVE",
    "VALVES": "VALVE",
    "VV": "VALVE",
    "FLNG": "FLANGED",
    "FLG": "FLANGED",
    "FLGD": "FLANGED",
    "FLANGE": "FLANGED",
    "SW": "SOCKETWELD",
    "THRD": "THREADED",
    "THD": "THREADED",
    "CL": "CLASS",
    "CLS": "CLASS",
    # bearings
    "BRG": "BEARING",
    "BRNG": "BEARING",
    "BEARNG": "BEARING",
    "BRGS": "BEARING",
    "BEARINGS": "BEARING",
    "BALLBRG": "BALL BEARING",
    "DG": "DEEP GROOVE",
    # cables
    "CBL": "CABLE",
    "CABLES": "CABLE",
    "ARMD": "ARMOURED",
    "ARM": "ARMOURED",
    "ARMORED": "ARMOURED",
    "UNARMD": "UNARMOURED",
    "UNARMORED": "UNARMOURED",
    "CU": "COPPER",
    "COPR": "COPPER",
    "COPPR": "COPPER",
    "AL": "ALUMINIUM",
    "ALU": "ALUMINIUM",
    "ALUMINUM": "ALUMINIUM",
    "XLPE": "XLPE",
    "CORES": "CORE",
    # NOTE: a bare "C" is deliberately NOT expanded to CORE - it collides with
    # material grade C (ASTM A106 Grade C) and the corpus always spells the
    # cable core count as CORE.
    "SQ": "SQMM",
    "SQMM": "SQMM",
    "SQ.MM": "SQMM",
    "MM2": "SQMM",
    "SQMMM": "SQMM",
    # plates & structural
    "PLT": "PLATE",
    "PLATES": "PLATE",
    "SHT": "SHEET",
    "THK": "THICKNESS",
    "THKNS": "THICKNESS",
    "THICK": "THICKNESS",
    # In this corpus a bare "T" is only ever the plate thickness marker.
    "T": "THICKNESS",
    "MS": "MILD STEEL",
    "CS": "CARBON STEEL",
    "SS": "STAINLESS STEEL",
    "STL": "STEEL",
    "STEELS": "STEEL",
    "CI": "CAST IRON",
    # grades / standards
    "GR": "GRADE",
    "GR.": "GRADE",
    "GRD": "GRADE",
    "GRADES": "GRADE",
    # dimensions
    "IN": "INCH",
    "IN.": "INCH",
    "INCHES": "INCH",
    "INS": "INCH",
    "NB": "INCH",
    "DIA": "DIAMETER",
    "DIAM": "DIAMETER",
    "OD": "OUTERDIAMETER",
    "ID": "INNERDIAMETER",
    "MTR": "METRE",
    "MTRS": "METRE",
}

# Tokens that carry no engineering meaning and are dropped before scoring.
STOPWORDS: set[str] = {
    "FOR", "WITH", "AND", "OF", "THE", "TYPE", "MATERIAL", "ITEM", "SPEC",
    "SPECIFICATION", "AS", "PER", "NO", "NOS", "QTY", "EA", "EACH", "SET",
}

# --- Category detection ---------------------------------------------------
# token -> canonical category. First match (by priority order) wins.
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "PIPE": ["PIPE", "TUBE", "TUBING"],
    "VALVE": ["VALVE"],
    "BEARING": ["BEARING"],
    "CABLE": ["CABLE", "WIRE", "CONDUCTOR"],
    "PLATE": ["PLATE", "SHEET", "COIL"],
    "FLANGE": ["FLANGENECK", "BLINDFLANGE"],
    "FASTENER": ["BOLT", "NUT", "SCREW", "WASHER", "STUD"],
    "MOTOR": ["MOTOR"],
    "PUMP": ["PUMP"],
    "BEAM": ["BEAM", "ANGLE", "CHANNEL", "JOIST"],
}

# Category wins over a weaker signal when both appear (e.g. "GATE VALVE PIPE").
CATEGORY_PRIORITY = [
    "BEARING", "VALVE", "CABLE", "PIPE", "PLATE", "FLANGE",
    "FASTENER", "MOTOR", "PUMP", "BEAM",
]

# --- Material detection ---------------------------------------------------
# Multi-token materials are matched first so "CARBON STEEL" beats "STEEL".
MATERIAL_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("CARBON STEEL", ("CARBON", "STEEL")),
    ("MILD STEEL", ("MILD", "STEEL")),
    ("STAINLESS STEEL", ("STAINLESS", "STEEL")),
    ("ALLOY STEEL", ("ALLOY", "STEEL")),
    ("CAST IRON", ("CAST", "IRON")),
    ("COPPER", ("COPPER",)),
    ("ALUMINIUM", ("ALUMINIUM",)),
    ("BRASS", ("BRASS",)),
    ("GUNMETAL", ("GUNMETAL",)),
    ("STEEL", ("STEEL",)),
]

# Cast-body material designations that also imply a material.
BODY_MATERIALS: dict[str, str] = {
    "WCB": "CAST CARBON STEEL",
    "WCC": "CAST CARBON STEEL",
    "CF8": "CAST STAINLESS STEEL",
    "CF8M": "CAST STAINLESS STEEL",
    "LCB": "CAST LOW TEMP STEEL",
}

# --- Construction / type descriptors -------------------------------------
TYPE_KEYWORDS: dict[str, list[str]] = {
    "PIPE": ["SEAMLESS", "WELDED", "SPIRAL"],
    "VALVE": ["GATE", "GLOBE", "BALL", "CHECK", "BUTTERFLY", "PLUG", "NEEDLE",
              "SAFETY", "RELIEF"],
    "BEARING": ["DEEP GROOVE", "BALL", "ROLLER", "TAPER", "SPHERICAL",
                "THRUST", "NEEDLE", "CYLINDRICAL"],
    "CABLE": ["ARMOURED", "UNARMOURED", "FLEXIBLE", "XLPE", "PVC"],
    "PLATE": ["HOT ROLLED", "COLD ROLLED", "CHEQUERED"],
}

# End connection is a separate slot (valves/pipes).
END_CONNECTIONS = ["FLANGED", "THREADED", "SOCKETWELD", "BUTTWELD", "WAFER"]

# --- Standards ------------------------------------------------------------
# Known standard numbers -> issuing body. Dictionary-driven because token
# order in legacy CPSE descriptions is unreliable ("ASTM GRADE A106 4 B").
STANDARD_NUMBERS: dict[str, str] = {
    "A106": "ASTM", "A53": "ASTM", "A333": "ASTM", "A312": "ASTM",
    "A216": "ASTM", "A105": "ASTM", "A234": "ASTM", "A182": "ASTM",
    "5L": "API", "6D": "API", "600": "API",
    "2062": "IS", "1239": "IS", "3589": "IS", "1363": "IS", "2002": "IS",
    "1554": "IS", "7098": "IS", "694": "IS",
    "B16.5": "ASME", "B16.34": "ASME", "B16.10": "ASME",
    "60502": "IEC",
}
STANDARD_BODIES = ["ASTM", "ASME", "API", "IS", "DIN", "EN", "BS", "JIS",
                   "IEC", "ISO", "AISI", "SAE"]

# Valid single/double character material grades (paired with a GRADE marker).
GRADE_TOKENS = {
    "A", "B", "C", "D", "E", "X42", "X46", "X52", "X56", "X60", "X65", "X70",
    "250", "350", "410", "E250", "E350", "E410", "LF2", "F316", "316", "304",
}

# --- Bearing designations -------------------------------------------------
BEARING_MANUFACTURERS = ["SKF", "FAG", "NSK", "NTN", "TIMKEN", "KOYO", "INA",
                         "NBC", "ZKL"]

# --- Per-category criticality --------------------------------------------
# An attribute listed as critical must not conflict between two materials, no
# matter how similar the free text is. This is the engineering-rule layer.
CRITICAL_ATTRIBUTES: dict[str, list[str]] = {
    "PIPE": ["category", "size_inch", "standard", "grade", "construction", "material"],
    "VALVE": ["category", "size_inch", "pressure_class", "valve_type", "material"],
    "BEARING": ["category", "model", "construction"],
    "CABLE": ["category", "cores", "cross_section_sqmm", "material"],
    "PLATE": ["category", "thickness_mm", "standard", "material"],
    "_DEFAULT": ["category", "size_inch", "standard", "material"],
}

# Attributes that differentiate but are commercially substitutable - a
# mismatch downgrades confidence instead of blocking a merge.
SOFT_ATTRIBUTES = {"manufacturer", "end_connection", "uom"}

# Relative weight of each attribute when computing attribute similarity.
ATTRIBUTE_WEIGHTS: dict[str, float] = {
    "category": 2.5,
    "material": 1.8,
    "standard": 1.6,
    "grade": 1.2,
    "construction": 1.4,
    "valve_type": 1.6,
    "size_inch": 2.0,
    "thickness_mm": 1.8,
    "pressure_class": 1.5,
    "cores": 1.6,
    "cross_section_sqmm": 1.8,
    "model": 2.0,
    "manufacturer": 0.6,
    "end_connection": 0.7,
}

# Display order / human labels for the DNA table in the UI.
ATTRIBUTE_LABELS: list[tuple[str, str]] = [
    ("category", "Category"),
    ("material", "Material"),
    ("standard", "Standard"),
    ("grade", "Grade"),
    ("construction", "Construction / Type"),
    ("valve_type", "Valve Type"),
    ("size_inch", "Nominal Size"),
    ("thickness_mm", "Thickness"),
    ("pressure_class", "Pressure Class"),
    ("cores", "Cores"),
    ("cross_section_sqmm", "Cross Section"),
    ("model", "Model / Designation"),
    ("manufacturer", "Manufacturer"),
    ("end_connection", "End Connection"),
]

# UOM families - used for compatibility checks, not for blocking.
UOM_FAMILY: dict[str, str] = {
    "MTR": "LENGTH", "METRE": "LENGTH", "M": "LENGTH", "KM": "LENGTH",
    "MT": "MASS", "TONNE": "MASS", "KG": "MASS", "TON": "MASS",
    "NO": "COUNT", "EA": "COUNT", "NOS": "COUNT", "PC": "COUNT",
    "SET": "COUNT", "PAIR": "COUNT",
    "SQM": "AREA", "LTR": "VOLUME", "KL": "VOLUME",
}
