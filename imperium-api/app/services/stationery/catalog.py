"""AEGIS registered stationery: the books SNC prints and what each leaf holds.

Each book type is described as data (fields, line-item tables, checklists,
sign-off blocks) and laid out by ``render.py`` for its page size. The forms
follow the ones Finance and the Front Desk already use (REQUISITION.xlsx,
the petty cash replenishment request and the acknowledgement of receipt),
with three additions on every leaf: a pre-printed serial number, a QR code
that opens the leaf in AEGIS, and a project / cost code field so each form
can be traced to where the money went.

Serial prefixes are permanent once books are printed: never reuse or change
one. Purchase-order books use LPO so a hand-written order can never share a
number with an AEGIS-issued PO-xxxx.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence, Tuple, Union

# ── Building blocks ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class F:
    """One boxed field: a small label with room to write beneath it.
    ``options`` prints tick boxes instead (e.g. Cash / Bank transfer)."""

    label: str
    span: int = 1
    options: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Fields:
    rows: Tuple[Tuple[F, ...], ...]
    tint: bool = False  # shaded: for the office's use only
    tall: Tuple[int, ...] = ()  # indexes of rows given extra writing height


@dataclass(frozen=True)
class Title:
    text: str


@dataclass(frozen=True)
class Col:
    header: str
    weight: float
    align: str = "l"  # l | r | c


@dataclass(frozen=True)
class Table:
    columns: Tuple[Col, ...]
    rows: int
    totals: Tuple[str, ...] = ()  # one row per label, boxes in the money columns
    numbered: bool = False


@dataclass(frozen=True)
class Amounts:
    """Fixed labelled lines with an amount box each (a small summary table)."""

    labels: Tuple[str, ...]
    amount_header: str = "Amount (USD)"


@dataclass(frozen=True)
class Checks:
    """Tick-box lines. An item with options prints ``text: [ ] Yes [ ] No``."""

    items: Tuple[Union[str, Tuple[str, Tuple[str, ...]]], ...]
    columns: int = 1


@dataclass(frozen=True)
class Lines:
    """Ruled writing lines under a label."""

    label: str
    count: int = 1


@dataclass(frozen=True)
class Signatures:
    roles: Tuple[str, ...]
    columns: Tuple[str, ...] = ("Name", "Signature", "Date")


@dataclass(frozen=True)
class Note:
    text: str
    heading: Optional[str] = None


Section = Union[Fields, Title, Table, Amounts, Checks, Lines, Signatures, Note]


@dataclass(frozen=True)
class BookType:
    key: str
    prefix: str
    title: str  # printed on every leaf
    book_title: str  # printed on the cover
    holder_group: str  # finance | front_desk
    page_size: str  # A4 | A5 | A5L (A5 landscape)
    default_leaves: int
    default_copies: int
    sections: Tuple[Section, ...]
    leaf_word: str = "leaf"  # "page" for the petty cash book
    description: str = ""
    allowed_sizes: Tuple[str, ...] = ("A5", "A4")

    def serial_label(self, serial: int) -> str:
        return f"{self.prefix}-{serial:06d}"

    def book_label(self, book_number: int) -> str:
        return f"{self.prefix} Book {book_number:04d}"


PAY_METHOD = F("Payment method", options=("Cash", "Bank transfer", "Mobile money", "Cheque"))
CURRENCY = F("Currency", options=("USD", "ZWG"))

# ── Finance books (A4) ───────────────────────────────────────────────────────

PAYMENT_REQUEST = BookType(
    key="payment_request",
    allowed_sizes=("A4",),
    prefix="PRQ",
    title="PAYMENT REQUEST",
    book_title="Payment Request Book",
    holder_group="finance",
    page_size="A4",
    default_leaves=50,
    default_copies=2,
    description="Request for funds before a payment is made, traced to a project and cost code.",
    sections=(
        Fields(
            rows=(
                (F("Date"), F("Required by (date)")),
                (F("Requested by"), F("Department")),
                (F("Project / site"), F("Project cost code")),
                (F("Purpose / description", span=2),),
                (PAY_METHOD, CURRENCY),
            ),
            tall=(3,),
        ),
        Title("FUNDING REQUIREMENT"),
        Table(
            columns=(
                Col("Qty", 0.08, "c"),
                Col("Description", 0.40),
                Col("Supplier / payee", 0.24),
                Col("Unit price", 0.13, "r"),
                Col("Amount requested", 0.15, "r"),
            ),
            rows=12,
            totals=("TOTAL",),
        ),
        Lines("Amount in words", 1),
        Title("SUPPORTING DOCUMENTS"),
        Checks(
            items=("Quotation(s)", "Purchase order No. ____________", "Invoice", "Budget / cost estimate", "Other: ____________________"),
            columns=3,
        ),
        Title("APPROVALS"),
        Signatures(roles=("Requested by", "Finance", "Commercial", "Managing Director")),
        Title("FINANCE USE ONLY"),
        Fields(
            rows=(
                (F("Payment voucher No."), F("Date paid"), F("Amount paid")),
                (F("Account / expense code"), F("Project cost code"), F("Payment reference")),
            ),
            tint=True,
        ),
    ),
)

PAYMENT_VOUCHER = BookType(
    key="payment_voucher",
    allowed_sizes=("A4",),
    prefix="PV",
    title="PAYMENT VOUCHER",
    book_title="Payment Voucher Book",
    holder_group="finance",
    page_size="A4",
    default_leaves=50,
    default_copies=2,
    description="Authority to pay a supplier or payee; links back to the payment request and purchase order.",
    sections=(
        Fields(
            rows=(
                (F("Date"), F("Payable to")),
                (F("Project / site"), F("Project cost code")),
                (F("Invoice No."), F("Invoice date")),
                (F("Payment request No. (PRQ)"), F("Purchase order No. (LPO / PO)")),
                (PAY_METHOD, CURRENCY),
                (F("Description", span=2),),
            ),
            tall=(5,),
        ),
        Title("PAYMENT DETAILS"),
        Table(
            columns=(
                Col("Account / cost code", 0.17),
                Col("Description", 0.38),
                Col("Project / site", 0.17),
                Col("Unit price", 0.13, "r"),
                Col("Amount", 0.15, "r"),
            ),
            rows=12,
            totals=("TOTAL",),
        ),
        Lines("Amount in words", 1),
        Lines("Notes", 2),
        Title("AUTHORISATION"),
        Signatures(roles=("Prepared by", "Finance", "Commercial", "Managing Director")),
        Title("RECEIVED BY PAYEE"),
        Fields(rows=((F("Name"), F("ID No."), F("Signature"), F("Date")),)),
    ),
)

PURCHASE_ORDER = BookType(
    key="purchase_order",
    allowed_sizes=("A4",),
    prefix="LPO",
    title="PURCHASE ORDER",
    book_title="Purchase Order Book",
    holder_group="finance",
    page_size="A4",
    default_leaves=50,
    default_copies=3,
    description="Hand-written purchase order (LPO) for suppliers; suppliers scan it to confirm it is genuine.",
    sections=(
        Title("SUPPLIER"),
        Fields(
            rows=(
                (F("Company name", span=2),),
                (F("Address", span=2),),
                (F("Contact person"), F("Phone / email")),
                (F("Supplier tax No. (VAT / BP)"), F("Quotation / RFQ ref.")),
            ),
        ),
        Title("ORDER"),
        Fields(
            rows=(
                (F("Date of order"), F("Delivery date")),
                (F("Project / site"), F("Project cost code")),
                (F("Delivery address", span=2),),
                (F("Account code"), F("Payment terms")),
            ),
        ),
        Title("ORDER DETAILS"),
        Table(
            columns=(
                Col("Qty", 0.08, "c"),
                Col("Unit", 0.08, "c"),
                Col("Description / item", 0.52),
                Col("Unit price", 0.14, "r"),
                Col("Amount", 0.18, "r"),
            ),
            rows=10,
            totals=("SUBTOTAL", "VAT", "TOTAL"),
        ),
        Title("AUTHORISATION"),
        Signatures(roles=("Prepared by", "Commercial", "Finance", "Managing Director")),
        Note(
            heading="KEY TERMS & CONDITIONS",
            text=(
                "1. Goods/services must match the description, quantity and agreed price on this purchase order. "
                "2. Supplier must provide a valid tax invoice and delivery note quoting this order number. "
                "3. Delivery must be made to the stated project/site unless otherwise authorised in writing. "
                "4. Any price or quantity change requires prior written approval. "
                "5. Payment is processed on the agreed terms after verification of supporting documents. "
                "6. Before supplying, scan the QR code: supply only if AEGIS shows this order as genuine and approved."
            ),
        ),
    ),
)

# ── Finance books (standard size) ────────────────────────────────────────────

PETTY_CASH_VOUCHER = BookType(
    key="petty_cash_voucher",
    prefix="PCV",
    title="PETTY CASH VOUCHER",
    book_title="Petty Cash Voucher Book",
    holder_group="finance",
    page_size="A5",
    default_leaves=100,
    default_copies=2,
    description="Cash paid out of a petty cash float, with the cost code it is charged to.",
    sections=(
        Fields(
            rows=(
                (F("Date"), F("Project / cost code")),
                (F("Requested by"), F("Department / site")),
                (F("Amount requested (USD)"), F("Type", options=("Actual", "Estimate"))),
            ),
        ),
        Lines("Purpose / description", 3),
        Checks(items=("Receipt / invoice attached", "No receipt"), columns=2),
        Lines("If no receipt, explain", 2),
        Title("APPROVAL"),
        Signatures(roles=("Requested by", "Reviewed by", "Approved by")),
        Title("ACCOUNTS USE ONLY"),
        Fields(
            rows=(
                (F("Amount paid (USD)"), F("Payment method")),
                (F("Amount spent (USD)"), F("Paid to")),
                (F("Balance returned (USD)"), F("Paid by")),
                (F("Expense / account code"), F("Date paid")),
            ),
            tint=True,
        ),
        Note(
            text=(
                "CONTROL NOTE: Attach receipts/invoices where available. Unused cash must be returned and recorded. "
                "The person requesting cash must not be the only person approving it."
            ),
        ),
    ),
)

MAIN_CASH_FUNDING = BookType(
    key="cash_funding",
    prefix="MCF",
    title="MAIN CASH FUNDING REQUEST",
    book_title="Main Cash Funding Book",
    holder_group="finance",
    page_size="A5",
    default_leaves=50,
    default_copies=2,
    description="Cash drawn from the bank into main (HQ) cash, approved before the withdrawal.",
    sections=(
        Fields(
            rows=(
                (F("Date"), F("Requested by")),
                (F("Amount requested"), CURRENCY),
                (F("Source of funds (bank account)", span=2),),
            ),
        ),
        Title("REQUEST DETAILS"),
        Table(
            columns=(Col("Description / purpose", 0.72), Col("Amount", 0.28, "r")),
            rows=7,
            totals=("TOTAL REQUEST",),
        ),
        Title("APPROVAL"),
        Signatures(roles=("Requested by", "Reviewed by (Finance)", "Approved by (MD)")),
        Title("WITHDRAWAL"),
        Fields(
            rows=(
                (F("Bank reference / cheque No."), F("Date withdrawn")),
                (F("Cash received by"), F("Signature")),
            ),
        ),
        Title("ACCOUNTING ENTRY AFTER APPROVED TRANSFER"),
        Fields(
            rows=((F("Debit: Main cash (HQ)  —  amount"), F("Credit: Bank, main account  —  amount")),),
            tint=True,
        ),
    ),
)

# ── Front Desk books (standard size) ─────────────────────────────────────────

PETTY_CASH_BOOK = BookType(
    key="petty_cash_book",
    prefix="PCB",
    title="PETTY CASH BOOK  —  HQ",
    book_title="Petty Cash Book (HQ)",
    holder_group="front_desk",
    page_size="A5L",
    default_leaves=100,
    default_copies=1,
    leaf_word="page",
    allowed_sizes=("A5L", "A4"),
    description="The HQ petty cash register kept by the Front Desk: every receipt and payment, page by page.",
    sections=(
        Fields(rows=((F("Custodian"), F("Month"), F("Balance brought forward (USD)")),)),
        Table(
            columns=(
                Col("Date", 0.09, "c"),
                Col("Voucher / receipt No.", 0.13),
                Col("Details (paid to / received from, purpose)", 0.32),
                Col("Project / cost code", 0.14),
                Col("Received", 0.10, "r"),
                Col("Paid", 0.10, "r"),
                Col("Balance", 0.12, "r"),
            ),
            rows=14,
            totals=("TOTALS THIS PAGE  /  BALANCE CARRIED FORWARD",),
        ),
        Fields(rows=((F("Checked by Finance (name)"), F("Signature"), F("Date")),), tint=True),
    ),
)

RECEIPT_ACKNOWLEDGEMENT = BookType(
    key="receipt_acknowledgement",
    prefix="ACK",
    title="ACKNOWLEDGEMENT OF RECEIPT OF MONEY",
    book_title="Acknowledgement of Receipt Book",
    holder_group="front_desk",
    page_size="A5",
    default_leaves=100,
    default_copies=2,
    description="Signed by anyone who receives cash from SNC (casual workers, suppliers paid in cash).",
    sections=(
        Fields(
            rows=(
                (F("Recipient full name", span=2),),
                (F("National ID No."), F("Contact No.")),
                (F("Amount received"), CURRENCY),
                (F("Amount in words", span=2),),
                (F("Date received"), F("Voucher No. (PCV / PV)")),
                (F("Purpose", span=2),),
                (F("Allocation: project / cost code", span=2),),
            ),
            tall=(5,),
        ),
        Note(text="I confirm that I have received the amount stated above, in full, for the purpose stated above."),
        Signatures(roles=("Recipient", "Paid by", "Witness")),
        Note(text="A recipient who cannot sign places a thumbprint in the signature box, and the witness signs."),
        Lines("Notes", 3),
    ),
)

PETTY_CASH_REPLENISHMENT = BookType(
    key="petty_cash_replenishment",
    prefix="PCR",
    title="PETTY CASH REPLENISHMENT REQUEST",
    book_title="Petty Cash Replenishment Book",
    holder_group="front_desk",
    page_size="A4",
    allowed_sizes=("A4",),
    default_leaves=50,
    default_copies=2,
    description="The custodian's request to top the petty cash float back up, with the vouchers it covers.",
    sections=(
        Fields(
            rows=(
                (F("Request date"), F("Requested by")),
                (F("Petty cash custodian"), F("Department / project")),
                (F("Approved float (USD)"), F("Cash account / location")),
            ),
        ),
        Title("1. PETTY CASH SUMMARY"),
        Amounts(
            labels=(
                "Approved petty cash float",
                "Opening cash balance",
                "Total petty cash expenditure",
                "Cash balance available",
                "Amount requested for replenishment",
            ),
        ),
        Title("2. SUPPORTING EXPENDITURE SCHEDULE"),
        Table(
            columns=(
                Col("No.", 0.07, "c"),
                Col("Voucher / receipt No.", 0.22),
                Col("Description", 0.49),
                Col("Amount (USD)", 0.22, "r"),
            ),
            rows=12,
            totals=("TOTAL",),
            numbered=True,
        ),
        Title("3. SUPPORTING DOCUMENTATION"),
        Checks(
            items=(
                ("Original receipts / vouchers attached", ("Yes", "No")),
                ("Petty cash register and reconciliation attached", ("Yes", "No")),
            ),
        ),
        Note(
            heading="4. DECLARATION AND AUTHORISATION",
            text=(
                "I confirm that the expenditure listed above was incurred for authorised company business, "
                "is accurately recorded and is supported by the relevant documentation."
            ),
        ),
        Signatures(roles=("Prepared by (custodian)", "Reviewed by (accounts)", "Approved by")),
        Fields(rows=((F("FINANCE: amount disbursed (USD)"), F("Date funds received")),), tint=True),
    ),
)


BOOK_TYPES: dict[str, BookType] = {
    bt.key: bt
    for bt in (
        PAYMENT_REQUEST,
        PAYMENT_VOUCHER,
        PURCHASE_ORDER,
        PETTY_CASH_VOUCHER,
        MAIN_CASH_FUNDING,
        PETTY_CASH_BOOK,
        RECEIPT_ACKNOWLEDGEMENT,
        PETTY_CASH_REPLENISHMENT,
    )
}

COPY_LABELS: dict[int, Sequence[str]] = {
    1: ("ORIGINAL",),
    2: ("ORIGINAL", "DUPLICATE · BOOK COPY"),
    3: ("ORIGINAL", "DUPLICATE · SUPPLIER COPY", "TRIPLICATE · BOOK COPY"),
}


def get_book_type(key: str) -> BookType:
    try:
        return BOOK_TYPES[key]
    except KeyError:
        raise ValueError(f"Unknown book type '{key}'.") from None


def copy_labels(book_type: BookType, copies: int) -> Sequence[str]:
    labels = COPY_LABELS[copies]
    if copies == 3 and book_type.key != "purchase_order":
        return ("ORIGINAL", "DUPLICATE · PAYEE COPY", "TRIPLICATE · BOOK COPY")
    return labels
