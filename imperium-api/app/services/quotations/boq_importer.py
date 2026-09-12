import csv
import math
import re
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import List, Dict, Any, Optional, Tuple
from io import BytesIO, StringIO
from openpyxl import load_workbook
from app.services.quotations.calculator import BOQItem

try:
    import xlrd
except ImportError:
    xlrd = None


class BOQImportResult:
    def __init__(
        self, items: List[BOQItem], warnings: List[str], summary: Dict[str, Any]
    ):
        self.items = items
        self.warnings = warnings
        self.summary = summary

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": len(self.items) > 0,
            "items": [item.model_dump() for item in self.items],
            "warnings": self.warnings,
            "summary": self.summary,
        }


class BOQImporter:
    DESC_HEADERS = {
        "description", "item description", "particulars", "task", "details",
        "name", "work description", "specification", "scope of work", "scope"
    }
    QTY_HEADERS = {
        "quantity", "qty", "volume", "amount_qty", "qnty", "estimated qty",
        "vol", "quant"
    }
    UNIT_HEADERS = {
        "unit", "uom", "measure", "unit of measure", "qty unit"
    }
    RATE_HEADERS = {
        "rate", "unit rate", "price", "unit price", "cost", "unit cost", "base rate"
    }
    AMOUNT_HEADERS = {
        "amount", "total", "total cost", "total amount", "extended cost",
        "extended amount", "line total", "total price"
    }
    ITEM_NO_HEADERS = {
        "item no", "item no.", "item_no", "no", "item", "item ref", "ref", "code"
    }
    SECTION_HEADERS = {
        "section", "trade", "bill", "heading", "category", "element", "package"
    }

    IGNORE_SHEET_KEYWORDS = {
        "cover", "title", "index", "toc", "contents", "instruction",
        "notes", "terms", "condition", "preamble", "sign", "disclaimer",
        "recap", "recapitulation"
    }

    SUBTOTAL_KEYWORDS = [
        "total carried", "carried forward", "carried to", "brought forward",
        "final summary", "grand total", "sub-total", "sub total",
        "total for bill", "collection", "carried to collection",
        "summary of bill", "page total", "add vat", "vat ("
    ]

    SUBTOTAL_PATTERNS = [
        re.compile(r"^(grand\s+)?total(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^sub[-\s]?total(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^total\s+bill(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^total\s+for(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^carried\s+(forward|to)(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^brought\s+forward(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^collection(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^add\s+vat(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^vat(\s*\(.*\))?$", re.IGNORECASE),
        re.compile(r"^p\s*&\s*g(\s+.*)?$", re.IGNORECASE),
        re.compile(r"^provisional\s+sum(\s+.*)?$", re.IGNORECASE),
    ]

    CURRENCY_REGEX = re.compile(r"[$£€¥R]|USD|ZWL|ZAR|NAD|BWP", re.IGNORECASE)

    @staticmethod
    def _is_blank(val: Any) -> bool:
        if val is None:
            return True
        if isinstance(val, float) and math.isnan(val):
            return True
        return str(val).strip() == ""

    @classmethod
    def _sanitize_decimal(cls, val: Any) -> Tuple[Decimal, bool]:
        """Returns (value, parse_failed). parse_failed is only True when the
        cell had content that wasn't a valid number - never for a genuinely
        empty/NaN cell, so callers can warn without flagging every blank cell."""
        if cls._is_blank(val):
            return Decimal("0"), False

        if isinstance(val, (int, float, Decimal)):
            try:
                if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                    return Decimal("0"), True
                return Decimal(str(val)), False
            except Exception:
                return Decimal("0"), True

        raw_str = str(val).strip()

        # Remove currency symbols and country codes
        clean_str = cls.CURRENCY_REGEX.sub("", raw_str).strip()

        # Accounting-style negatives, e.g. "(1,234.56)" -> -1234.56
        if clean_str.startswith("(") and clean_str.endswith(")"):
            clean_str = "-" + clean_str[1:-1].strip()

        # Trailing negative signs: "1234.56-" -> "-1234.56"
        if clean_str.endswith("-") and not clean_str.startswith("-"):
            clean_str = "-" + clean_str[:-1].strip()

        # Remove all spaces including non-breaking spaces
        clean_str = clean_str.replace(" ", "").replace("\xa0", "")

        # Handle European decimal: e.g. "1250,50" -> "1250.50" if no other dots
        if "," in clean_str and "." not in clean_str:
            parts = clean_str.split(",")
            if len(parts) == 2 and len(parts[1]) <= 3:
                clean_str = f"{parts[0]}.{parts[1]}"
            else:
                clean_str = clean_str.replace(",", "")
        else:
            clean_str = clean_str.replace(",", "")

        # Handle simple formula string if uncached (e.g. "=10*2.5" or "10*2.5")
        if clean_str.startswith("="):
            clean_str = clean_str[1:].strip()

        if re.match(r"^-?\d+(\.\d+)?\s*[\*]\s*-?\d+(\.\d+)?$", clean_str):
            try:
                parts = clean_str.split("*")
                product = Decimal(parts[0].strip()) * Decimal(parts[1].strip())
                return product, False
            except Exception:
                pass

        try:
            d = Decimal(clean_str)
            if d.is_nan() or d.is_infinite():
                return Decimal("0"), True
            return d, False
        except (InvalidOperation, ValueError, Exception):
            return Decimal("0"), True

    @staticmethod
    def _clean_text(val: Any) -> str:
        if BOQImporter._is_blank(val):
            return ""
        return str(val).strip()

    @classmethod
    def _read_excel_sheets(cls, file_content: bytes, file_extension: str) -> List[Tuple[str, List[List[Any]]]]:
        """Reads all sheets from .xlsx, .xlsm or .xls as lists of row values."""
        sheets: List[Tuple[str, List[List[Any]]]] = []
        ext = file_extension.lower()

        if ext in [".xlsx", ".xlsm", ".xltx"]:
            # Load with data_only=True to read evaluated formula values
            wb_data = load_workbook(BytesIO(file_content), data_only=True, read_only=False)
            try:
                wb_formulas = load_workbook(BytesIO(file_content), data_only=False, read_only=False)
            except Exception:
                wb_formulas = None

            for sheet_name in wb_data.sheetnames:
                ws_data = wb_data[sheet_name]
                ws_formulas = wb_formulas[sheet_name] if wb_formulas and sheet_name in wb_formulas.sheetnames else None

                rows: List[List[Any]] = []
                for row_idx, row in enumerate(ws_data.iter_rows(values_only=True), start=1):
                    row_vals = list(row)
                    if ws_formulas and any(v is None for v in row_vals):
                        try:
                            formula_row = list(ws_formulas.iter_rows(min_row=row_idx, max_row=row_idx, values_only=True))[0]
                            for col_idx, cell_val in enumerate(row_vals):
                                if cell_val is None and col_idx < len(formula_row) and formula_row[col_idx] is not None:
                                    row_vals[col_idx] = formula_row[col_idx]
                        except Exception:
                            pass
                    rows.append(row_vals)
                sheets.append((sheet_name, rows))

        elif ext == ".xls":
            if xlrd is None:
                raise RuntimeError("xlrd library is required to read legacy .xls files.")
            wb = xlrd.open_workbook(file_contents=file_content)
            for sheet_name in wb.sheet_names():
                sheet = wb.sheet_by_name(sheet_name)
                rows = []
                for r in range(sheet.nrows):
                    rows.append([sheet.cell_value(r, c) for c in range(sheet.ncols)])
                sheets.append((sheet_name, rows))
        else:
            raise ValueError(f"Unsupported Excel format: {file_extension}")

        return sheets

    @classmethod
    def _find_header_mapping(cls, rows: List[List[Any]], max_scan_rows: int = 25) -> Tuple[int, Dict[str, int]]:
        """
        Scans rows to identify the best header row and maps column concepts.
        Returns (header_row_index, header_map).
        """
        best_row_idx = -1
        best_score = 0
        best_map: Dict[str, Any] = {}

        for r_idx, row in enumerate(rows[:max_scan_rows]):
            normalized = [cls._clean_text(v).lower() for v in row]
            if not any(normalized):
                continue

            current_map: Dict[str, Any] = {
                "quantity_candidates": [],
                "rate_candidates": [],
                "amount_candidates": [],
            }
            # Disambiguation: Check if both 'amount' and 'total' appear in the same row.
            # In cost sheets, 'Amount' is often the quantity (e.g. 4 units) and 'Total' is the line sum.
            has_explicit_total = any(cls._clean_text(v).lower() in ["total", "line total", "total cost", "total price", "extended amount"] for v in row)
            score = 0

            for c_idx, val in enumerate(normalized):
                if not val:
                    continue

                if val in cls.ITEM_NO_HEADERS or any(h in val for h in ["item no", "item_no", "item #"]):
                    if "item_no" not in current_map:
                        current_map["item_no"] = c_idx
                        score += 2
                elif val in cls.DESC_HEADERS or any(h in val for h in ["description", "particulars", "scope of work"]):
                    if "description" not in current_map:
                        current_map["description"] = c_idx
                        score += 3
                elif (val in cls.QTY_HEADERS or any(h in val for h in ["quantity", "qty", "qnty", "volume"])) or (val == "amount" and has_explicit_total):
                    if "quantity" not in current_map:
                        current_map["quantity"] = c_idx
                    current_map["quantity_candidates"].append(c_idx)
                    score += 3
                elif val in cls.UNIT_HEADERS or val in ["unit", "uom", "measure"]:
                    if "unit" not in current_map:
                        current_map["unit"] = c_idx
                        score += 2
                elif val in cls.RATE_HEADERS or any(h in val for h in ["unit rate", "unit price", "rate", "cost per unit", "new cost", "cost/unit", "price/unit"]):
                    if "rate" not in current_map:
                        current_map["rate"] = c_idx
                    current_map["rate_candidates"].append(c_idx)
                    score += 3
                elif (val in cls.AMOUNT_HEADERS or any(h in val for h in ["amount", "line total", "total cost", "total price", "total"])) and not (val == "amount" and has_explicit_total):
                    if "amount" not in current_map:
                        current_map["amount"] = c_idx
                    current_map["amount_candidates"].append(c_idx)
                    score += 2
                elif val in cls.SECTION_HEADERS or "section" in val or "trade" in val:
                    if "section" not in current_map:
                        current_map["section"] = c_idx
                        score += 1

            has_desc = "description" in current_map
            has_metric = bool(current_map["quantity_candidates"]) or bool(current_map["rate_candidates"]) or bool(current_map["amount_candidates"]) or ("unit" in current_map)

            if has_desc and has_metric and score > best_score:
                best_score = score
                best_row_idx = r_idx
                best_map = current_map

        return best_row_idx, best_map

    @classmethod
    def _is_subtotal_row(cls, desc: str, section: str = "") -> bool:
        lower_sec = (section or "").strip().lower()
        if lower_sec in ["summary", "bill summary", "final summary", "recapitulation", "collection"]:
            return True
        clean = re.sub(r"\s+", " ", desc.strip()).lower()
        if any(keyword in clean for keyword in cls.SUBTOTAL_KEYWORDS):
            return True
        return any(pat.match(clean) for pat in cls.SUBTOTAL_PATTERNS)

    @classmethod
    def _process_tabular_rows(
        cls,
        rows: List[List[Any]],
        sheet_title: str,
        warnings: List[str],
        default_section: str = "Measured Works",
        sections_seen: Optional[set[str]] = None,
    ) -> List[BOQItem]:
        """Processes structured tabular rows into BOQItem instances."""
        if not rows:
            return []

        header_idx, header_map = cls._find_header_mapping(rows)
        start_row = header_idx + 1 if header_idx >= 0 else 0

        # Determine column indices
        desc_idx = header_map.get("description", 1 if len(rows[0]) > 1 else 0)
        item_no_idx = header_map.get("item_no", 0 if (header_idx < 0 and desc_idx != 0) else -1)
        unit_idx = header_map.get("unit", 2 if (header_idx < 0 and len(rows[0]) > 2) else -1)
        qty_candidates = header_map.get("quantity_candidates") or ([header_map.get("quantity", 3 if len(rows[0]) > 3 else -1)] if header_idx < 0 else [])
        rate_candidates = header_map.get("rate_candidates") or ([header_map.get("rate", 4 if len(rows[0]) > 4 else -1)] if header_idx < 0 else [])
        amount_candidates = header_map.get("amount_candidates") or ([header_map.get("amount", -1)] if header_idx < 0 else [])
        section_idx = header_map.get("section", -1)

        items: List[BOQItem] = []
        current_section = sheet_title if sheet_title and sheet_title.lower() not in ["sheet1", "table", "data"] else default_section
        if sections_seen is not None:
            sections_seen.add(current_section)
        pending_description = ""
        pending_item_no = ""

        for row_num, row_vals in enumerate(rows[start_row:], start=start_row + 1):
            normalized = [cls._clean_text(v) for v in row_vals]
            if not any(normalized):
                pending_description = ""
                pending_item_no = ""
                continue

            desc = cls._clean_text(row_vals[desc_idx]) if desc_idx >= 0 and desc_idx < len(row_vals) else ""
            item_no = cls._clean_text(row_vals[item_no_idx]) if item_no_idx >= 0 and item_no_idx < len(row_vals) else ""
            unit = cls._clean_text(row_vals[unit_idx]) if unit_idx >= 0 and unit_idx < len(row_vals) else ""
            row_section = cls._clean_text(row_vals[section_idx]) if section_idx >= 0 and section_idx < len(row_vals) else ""

            # Check candidate quantity columns (preferring non-zero quantity)
            raw_qty = None
            for q_idx in qty_candidates:
                if q_idx >= 0 and q_idx < len(row_vals):
                    val = row_vals[q_idx]
                    if not cls._is_blank(val):
                        raw_qty = val
                        d, _ = cls._sanitize_decimal(val)
                        if d > 0:
                            break

            raw_rate = None
            for r_idx in rate_candidates:
                if r_idx >= 0 and r_idx < len(row_vals):
                    val = row_vals[r_idx]
                    if not cls._is_blank(val):
                        raw_rate = val
                        d, _ = cls._sanitize_decimal(val)
                        if d > 0:
                            break

            raw_amount = None
            for a_idx in amount_candidates:
                if a_idx >= 0 and a_idx < len(row_vals):
                    val = row_vals[a_idx]
                    if not cls._is_blank(val):
                        raw_amount = val
                        d, _ = cls._sanitize_decimal(val)
                        if d > 0:
                            break

            qty, qty_err = cls._sanitize_decimal(raw_qty)
            rate, rate_err = cls._sanitize_decimal(raw_rate)
            amount, amount_err = cls._sanitize_decimal(raw_amount)

            if cls._is_subtotal_row(desc, row_section or current_section):
                continue

            if row_section:
                current_section = row_section
                if sections_seen is not None:
                    sections_seen.add(current_section)

            has_measure = (unit != "") or (qty != 0) or (rate != 0) or (amount != 0)

            if desc and not has_measure:
                is_all_caps = desc == desc.upper() and any(c.isalpha() for c in desc)
                has_section_kw = any(k in desc.upper() for k in ["BILL NO", "BILL  NO", "SECTION", "TRADE", "ELEMENT", "DIVISION", "SUMMARY OF"])
                
                # Check if the subsequent non-empty row has measures, indicating this standalone short text is a section/trade title
                next_row_has_measure = False
                for future_vals in rows[row_num:]:
                    if any(cls._clean_text(v) for v in future_vals):
                        f_qty = cls._sanitize_decimal(future_vals[qty_candidates[0]])[0] if qty_candidates and qty_candidates[0] < len(future_vals) else Decimal("0")
                        f_rate = cls._sanitize_decimal(future_vals[rate_candidates[0]])[0] if rate_candidates and rate_candidates[0] < len(future_vals) else Decimal("0")
                        f_amt = cls._sanitize_decimal(future_vals[amount_candidates[0]])[0] if amount_candidates and amount_candidates[0] < len(future_vals) else Decimal("0")
                        f_u = cls._clean_text(future_vals[unit_idx]) if unit_idx >= 0 and unit_idx < len(future_vals) else ""
                        next_row_has_measure = (f_u != "") or (f_qty != 0) or (f_rate != 0) or (f_amt != 0)
                        break

                # Check if previous row in rows was empty or this row is capitalized
                prev_row_is_blank = (row_num - 2 >= 0 and not any(cls._clean_text(v) for v in rows[row_num - 2]))
                is_title_cased = desc[0].isupper() and not desc.startswith("&") and not desc.startswith("and ")
                is_short_title = (
                    len(desc.split()) <= 6
                    and not any(c in desc for c in [",", ";", ":", "."])
                    and is_title_cased
                    and (prev_row_is_blank or not items or is_all_caps or has_section_kw)
                )
                is_pure_heading = (has_section_kw or (is_all_caps and len(desc) > 3) or (is_short_title and next_row_has_measure)) and not item_no

                if is_pure_heading:
                    current_section = desc
                    if sections_seen is not None:
                        sections_seen.add(current_section)
                    pending_description = ""
                    pending_item_no = ""
                else:
                    if item_no:
                        pending_item_no = item_no
                        pending_description = f"{pending_description} {desc}".strip() if pending_description else desc
                    elif items and not pending_item_no:
                        # Continuation of the previous row's description
                        items[-1].description = f"{items[-1].description} {desc}".strip()
                    else:
                        pending_description = f"{pending_description} {desc}".strip() if pending_description else desc
                continue

            if pending_description and has_measure:
                desc = f"{pending_description} {desc}".strip() if desc else pending_description
                pending_description = ""

            if pending_item_no and not item_no:
                item_no = pending_item_no
                pending_item_no = ""

            if not desc:
                continue

            if qty_err:
                warnings.append(f"{sheet_title} row {row_num}: Could not parse quantity '{raw_qty}' as a number; treated as 0.")
            if rate_err:
                warnings.append(f"{sheet_title} row {row_num}: Could not parse rate '{raw_rate}' as a number; treated as 0.")

            if qty < 0:
                warnings.append(f"{sheet_title} row {row_num}: Negative quantity ({qty}) set to 0.")
                qty = Decimal("0")
            if rate < 0:
                warnings.append(f"{sheet_title} row {row_num}: Negative rate ({rate}) set to 0.")
                rate = Decimal("0")

            if rate == 0 and amount > 0 and qty > 0:
                rate = (amount / qty).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            elif qty == 0 and rate == 0 and amount > 0:
                qty = Decimal("1")
                unit = unit or "sum"
                rate = amount

            unit = unit or "item"

            item = BOQItem(
                section=current_section,
                item_no=item_no,
                description=desc,
                quantity=qty,
                unit=unit,
                rate=rate,
                source_sheet=sheet_title or None,
                source_row=row_num,
            )
            items.append(item)
            if sections_seen is not None:
                sections_seen.add(current_section)

        return items

    @classmethod
    def _import_excel_workbook(cls, file_content: bytes, file_extension: str = ".xlsx") -> BOQImportResult:
        """Parses multi-sheet Excel workbook with formula caching and legacy support."""
        sheets = cls._read_excel_sheets(file_content, file_extension)
        warnings: List[str] = []
        all_items: List[BOQItem] = []
        rows_processed = 0
        sections_seen: set[str] = set()

        candidate_sheets = []
        for name, rows in sheets:
            rows_processed += len(rows)
            lower_name = name.lower().strip()
            if len(sheets) > 1 and any(kw in lower_name for kw in cls.IGNORE_SHEET_KEYWORDS):
                continue
            candidate_sheets.append((name, rows))

        if not candidate_sheets:
            candidate_sheets = sheets

        # If some sheets have explicit recognizable bill/cost headers, prioritize them
        # to avoid polluting the ledger with unstructured summary or governance tabs
        mapped_sheets = [
            (name, rows) for name, rows in candidate_sheets
            if cls._find_header_mapping(rows)[0] >= 0
        ]
        active_sheets = mapped_sheets if mapped_sheets else candidate_sheets

        for sheet_name, rows in active_sheets:
            sheet_items = cls._process_tabular_rows(
                rows=rows,
                sheet_title=sheet_name,
                warnings=warnings,
                default_section=sheet_name or "Measured Works",
                sections_seen=sections_seen,
            )
            all_items.extend(sheet_items)

        # Fallback: if prioritizing mapped_sheets produced 0 items, scan all candidate sheets
        if not all_items and mapped_sheets and len(mapped_sheets) < len(candidate_sheets):
            for sheet_name, rows in candidate_sheets:
                if (sheet_name, rows) in mapped_sheets:
                    continue
                sheet_items = cls._process_tabular_rows(
                    rows=rows,
                    sheet_title=sheet_name,
                    warnings=warnings,
                    default_section=sheet_name or "Measured Works",
                    sections_seen=sections_seen,
                )
                all_items.extend(sheet_items)

        total_direct_costs = sum(
            (it.quantity * it.rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            for it in all_items
        )

        return BOQImportResult(
            items=all_items,
            warnings=warnings,
            summary={
                "total_rows_processed": rows_processed,
                "valid_items_imported": len(all_items),
                "section_count": len(sections_seen) if sections_seen else 1,
                "total_direct_costs": str(total_direct_costs),
            },
        )

    @classmethod
    def _import_csv(cls, file_content: bytes) -> BOQImportResult:
        """Parses CSV with delimiter sniffing, header detection, and amount resolution."""
        text = file_content.decode("utf-8-sig", errors="replace")
        warnings: List[str] = []

        delimiter = ","
        first_few_lines = "\n".join(text.splitlines()[:5])
        if "\t" in first_few_lines and first_few_lines.count("\t") > first_few_lines.count(","):
            delimiter = "\t"
        elif ";" in first_few_lines and first_few_lines.count(";") > first_few_lines.count(","):
            delimiter = ";"
        elif "|" in first_few_lines and first_few_lines.count("|") > first_few_lines.count(","):
            delimiter = "|"

        reader = csv.reader(StringIO(text), delimiter=delimiter)
        rows = [list(r) for r in reader]

        items = cls._process_tabular_rows(
            rows=rows,
            sheet_title="Measured Works",
            warnings=warnings,
            default_section="Measured Works",
        )

        sections_seen = {it.section for it in items}
        total_direct_costs = sum(
            (it.quantity * it.rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            for it in items
        )

        return BOQImportResult(
            items=items,
            warnings=warnings,
            summary={
                "total_rows_processed": len(rows),
                "valid_items_imported": len(items),
                "section_count": len(sections_seen) if sections_seen else 1,
                "total_direct_costs": str(total_direct_costs),
            },
        )

    @classmethod
    def import_boq(cls, file_content: bytes, file_extension: str) -> BOQImportResult:
        """
        Parses BOQ items from an Excel (.xlsx, .xlsm, .xls) or CSV/TSV file.
        Dynamically maps column headers to match description, quantity, unit, rate, and amount.
        """
        ext = file_extension.lower().strip()
        if not ext.startswith("."):
            ext = "." + ext

        try:
            if ext in [".xlsx", ".xlsm", ".xltx", ".xls"]:
                return cls._import_excel_workbook(file_content, ext)
            elif ext in [".csv", ".tsv", ".txt"]:
                return cls._import_csv(file_content)
            else:
                raise ValueError(f"Unsupported file format: {file_extension}")
        except Exception as e:
            return BOQImportResult(
                items=[],
                warnings=[f"Failed to read file: {str(e)}"],
                summary={
                    "total_rows_processed": 0,
                    "valid_items_imported": 0,
                    "total_direct_costs": "0.00",
                },
            )
