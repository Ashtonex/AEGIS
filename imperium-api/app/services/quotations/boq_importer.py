import pandas as pd
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Any
from io import BytesIO
from app.services.quotations.calculator import BOQItem


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
    @staticmethod
    def _sanitize_decimal(val: Any) -> Decimal:
        if pd.isna(val) or val is None:
            return Decimal("0")
        try:
            # Strip formatting characters like currency symbols or commas
            clean_str = str(val).replace("$", "").replace(",", "").strip()
            d = Decimal(clean_str)
            if d.is_nan():
                return Decimal("0")
            return d
        except Exception:
            return Decimal("0")

    @classmethod
    def import_boq(cls, file_content: bytes, file_extension: str) -> BOQImportResult:
        """
        Parses BOQ items from an Excel or CSV file.
        Dynamically maps column headers to match 'description', 'quantity', 'unit', and 'rate'.
        """
        warnings = []
        items: List[BOQItem] = []

        try:
            if file_extension.lower() in [".xlsx", ".xls"]:
                # Read using openpyxl for Excel files
                df = pd.read_excel(BytesIO(file_content), engine="openpyxl")
            elif file_extension.lower() == ".csv":
                df = pd.read_csv(BytesIO(file_content))
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

        # Standardise column names (lowercase and stripped)
        df.columns = [str(c).strip().lower() for c in df.columns]

        # Column mapping matrix
        desc_cols = [
            "description",
            "item description",
            "task",
            "details",
            "name",
            "item",
        ]
        qty_cols = ["quantity", "qty", "volume", "amount_qty"]
        unit_cols = ["unit", "uom", "measure"]
        rate_cols = ["rate", "unit rate", "price", "unit price", "cost"]

        # Helper to find first matching column
        def find_col(possible_names: List[str], fallback: str) -> str:
            for col in df.columns:
                if col in possible_names:
                    return col
            return fallback

        desc_col = find_col(desc_cols, "description")
        qty_col = find_col(qty_cols, "quantity")
        unit_col = find_col(unit_cols, "unit")
        rate_col = find_col(rate_cols, "rate")

        if desc_col not in df.columns:
            warnings.append(
                "Could not find description column. Using first column as fallback."
            )
            desc_col = df.columns[0] if len(df.columns) > 0 else "description"

        total_direct_costs = Decimal("0")
        rows_processed = 0

        for idx, row in df.iterrows():
            rows_processed += 1
            # Retrieve values safely
            raw_desc = row.get(desc_col) if desc_col in df.columns else None
            raw_qty = row.get(qty_col) if qty_col in df.columns else None
            raw_unit = row.get(unit_col) if unit_col in df.columns else None
            raw_rate = row.get(rate_col) if rate_col in df.columns else None

            # Skip completely empty rows
            if pd.isna(raw_desc) and pd.isna(raw_qty) and pd.isna(raw_rate):
                continue

            desc = str(raw_desc).strip() if not pd.isna(raw_desc) else ""
            if not desc:
                warnings.append(f"Row {idx + 1}: Empty description, skipping row.")
                continue

            qty = cls._sanitize_decimal(raw_qty)
            unit = str(raw_unit).strip() if not pd.isna(raw_unit) else "item"
            rate = cls._sanitize_decimal(raw_rate)

            if qty < 0:
                warnings.append(f"Row {idx + 1}: Negative quantity ({qty}) set to 0.")
                qty = Decimal("0")
            if rate < 0:
                warnings.append(f"Row {idx + 1}: Negative rate ({rate}) set to 0.")
                rate = Decimal("0")

            boq_item = BOQItem(description=desc, quantity=qty, unit=unit, rate=rate)
            items.append(boq_item)

            item_cost = (qty * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_direct_costs += item_cost

        summary = {
            "total_rows_processed": rows_processed,
            "valid_items_imported": len(items),
            "total_direct_costs": str(total_direct_costs),
        }

        return BOQImportResult(items=items, warnings=warnings, summary=summary)
