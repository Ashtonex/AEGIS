"""Six Nine Construction contact details printed on every AEGIS document.

One place, so a change of phone number, address or website reaches every
PDF (invoices, quotations, purchase orders, leave records, packs) at once.
"""

WEBSITES = ("www.snc.co.zw", "www.sixnineconstruction.com")
WEBSITES_LINE = " · ".join(WEBSITES)

GENERAL_EMAIL = "info@snc.co.zw"
# Contact for tenders and procurement notices SNC issues to suppliers.
PROCUREMENT_EMAIL = "procurement@sixnineconstruction.com"

ADDRESS_LINE = "No. 4 Kariba Road, Nyakamete Industrial Area, Mutare, Manicaland, Zimbabwe"
PHONES_LINE = "+263 77 100 1750 · +263 77 100 1577 · 0202 065 845"
REGISTRATION_LINE = "VAT reg. 220116087 · TIN 2001309644 · ZIMRA tax clearance ITF263"

# Running footer on every page (Helvetica 7.5 leaves room for "Page n of m").
FOOTER_LINE = f"No. 4 Kariba Road, Mutare · +263 77 100 1750 · {GENERAL_EMAIL} · {WEBSITES_LINE} · VAT reg. 220116087"


def company_detail_lines(extra: str = "Incorporation 11284/2019") -> list[str]:
    """Header address block beneath the company name, one string per line."""
    return [
        ADDRESS_LINE,
        PHONES_LINE,
        f"{GENERAL_EMAIL} · {extra}" if extra else GENERAL_EMAIL,
        WEBSITES_LINE,
        REGISTRATION_LINE,
    ]
