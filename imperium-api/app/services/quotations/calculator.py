from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Any
import hashlib
import json
from pydantic import BaseModel, Field, ConfigDict


class BOQItem(BaseModel):
    model_config = ConfigDict(coerce_numbers_to_str=False)

    description: str
    quantity: Decimal = Field(default=Decimal("0"))
    unit: str = Field(default="item")
    rate: Decimal = Field(default=Decimal("0"))

    # Detailed cost components (optional breakdown)
    material_rate: Decimal = Field(default=Decimal("0"))
    labour_rate: Decimal = Field(default=Decimal("0"))
    equipment_rate: Decimal = Field(default=Decimal("0"))
    subcontractor_rate: Decimal = Field(default=Decimal("0"))
    transport_rate: Decimal = Field(default=Decimal("0"))
    waste_allowance_rate: Decimal = Field(default=Decimal("0"))


class QuotationCalculationInput(BaseModel):
    items: List[BOQItem]
    preliminaries: Decimal = Field(default=Decimal("0"))
    overhead_rate: Decimal = Field(
        default=Decimal("0"),
        description="Overhead rate as a fraction, e.g. 0.05 for 5%",
    )
    contingency_rate: Decimal = Field(
        default=Decimal("0"),
        description="Contingency rate as a fraction, e.g. 0.10 for 10%",
    )
    profit_rate: Decimal = Field(
        default=Decimal("0"),
        description="Profit margin rate as a fraction, e.g. 0.15 for 15%",
    )
    discount: Decimal = Field(default=Decimal("0"), description="Flat discount amount")
    tax_rate: Decimal = Field(
        default=Decimal("0.15"), description="Tax rate (e.g. 0.15 for ZIMRA VAT)"
    )
    provisional_sums: Decimal = Field(
        default=Decimal("0"), description="Provisional sums for undefined works"
    )

    # Metadata for auditing and tracking
    quotation_id: str = Field(default="UNTRACTED-QT")
    revision_number: int = Field(default=1)
    currency_rounding_decimals: int = Field(default=2)
    assumptions: List[str] = Field(default_factory=list)
    exclusions: List[str] = Field(default_factory=list)

    # Estimation Enhancements for Workflow alignment
    built_area_sqm: Decimal = Field(default=Decimal("0"), description="Total built area in square meters for benchmarking")
    price_validity_days: int = Field(default=30, description="Validity period of pricing in days")
    is_inflation_adjusted: bool = Field(default=False, description="Flag indicating if quote is adjusted for current material inflation")


class QuotationCalculationResult(BaseModel):
    direct_costs: Decimal
    preliminaries: Decimal
    overhead_amount: Decimal
    contingency_amount: Decimal
    profit_amount: Decimal
    provisional_sums: Decimal
    subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    grand_total: Decimal

    # Detailed breakdown audit
    breakdown_log: Dict[str, Any]
    quotation_id: str
    revision_number: int
    assumptions: List[str]
    exclusions: List[str]
    audit_trail_hash: str

    # Estimation Enhancements for Workflow alignment
    built_area_sqm: Decimal = Field(default=Decimal("0"))
    price_validity_days: int = Field(default=30)
    is_inflation_adjusted: bool = Field(default=False)


class QuotationCalculator:
    @staticmethod
    def sanitize_decimal(val: Any) -> Decimal:
        """Converts input safely to Decimal, defaulting to 0."""
        if val is None:
            return Decimal("0")
        try:
            d = Decimal(str(val))
            if d.is_nan():
                return Decimal("0")
            return d
        except (ValueError, TypeError):
            return Decimal("0")

    @classmethod
    def calculate(cls, input_data: Dict[str, Any]) -> QuotationCalculationResult:
        """
        Executes the formal construction cost estimation formula:
        Direct Costs = Sum(BOQ Quantity * Rate)
                     (Where Rate = sum(breakdown rates) if flat rate is 0)
        Subtotal = Direct Costs + Preliminaries + Overheads + Contingency + Profit + Provisional Sums
        Taxable = Subtotal - Discount
        Grand Total = Taxable + Taxes
        """
        # Parse metadata
        quotation_id = str(input_data.get("quotation_id", "UNTRACTED-QT"))
        revision_number = int(input_data.get("revision_number", 1))
        decimals = int(input_data.get("currency_rounding_decimals", 2))
        rounding_str = "0." + "0" * (decimals - 1) + "1" if decimals > 0 else "1"
        rounding_prec = Decimal(rounding_str)

        assumptions = [str(x) for x in input_data.get("assumptions", [])]
        exclusions = [str(x) for x in input_data.get("exclusions", [])]

        # Parse estimation controls & workflow enhancements
        built_area_sqm = cls.sanitize_decimal(input_data.get("built_area_sqm"))
        price_validity_days = int(input_data.get("price_validity_days", 30))
        is_inflation_adjusted = bool(input_data.get("is_inflation_adjusted", False))

        raw_items = input_data.get("items", [])
        boq_items: List[BOQItem] = []
        direct_costs = Decimal("0")
        item_alerts: List[str] = []

        # Summary of cost components
        total_materials = Decimal("0")
        total_labour = Decimal("0")
        total_equipment = Decimal("0")
        total_subcontractors = Decimal("0")
        total_transport = Decimal("0")
        total_waste = Decimal("0")

        for item in raw_items:
            qty = cls.sanitize_decimal(item.get("quantity"))
            flat_rate = cls.sanitize_decimal(item.get("rate"))

            # Sub-components
            mat = cls.sanitize_decimal(item.get("material_rate"))
            lab = cls.sanitize_decimal(item.get("labour_rate"))
            eqp = cls.sanitize_decimal(item.get("equipment_rate"))
            sub = cls.sanitize_decimal(item.get("subcontractor_rate"))
            trans = cls.sanitize_decimal(item.get("transport_rate"))
            waste = cls.sanitize_decimal(item.get("waste_allowance_rate"))

            desc = str(item.get("description", "Unspecified item"))
            unit = str(item.get("unit", "m"))

            # Zero out negative quantities/rates - but flag it, since silently
            # dropping a negative value (e.g. a credit/deduction line) would
            # otherwise inflate grand_total with no indication to the user.
            if qty < 0:
                item_alerts.append(f"Item '{desc}': negative quantity ({qty}) was treated as 0.")
                qty = Decimal("0")
            if flat_rate < 0:
                item_alerts.append(f"Item '{desc}': negative rate ({flat_rate}) was treated as 0.")
                flat_rate = Decimal("0")

            # Map breakdowns to zero if negative
            for label, val in (("material_rate", mat), ("labour_rate", lab), ("equipment_rate", eqp), ("subcontractor_rate", sub), ("transport_rate", trans), ("waste_allowance_rate", waste)):
                if val < 0:
                    item_alerts.append(f"Item '{desc}': negative {label} ({val}) was treated as 0.")
            mat = max(Decimal("0"), mat)
            lab = max(Decimal("0"), lab)
            eqp = max(Decimal("0"), eqp)
            sub = max(Decimal("0"), sub)
            trans = max(Decimal("0"), trans)
            waste = max(Decimal("0"), waste)

            # If rate is 0 but breakdown is present, compute rate as sum of breakdown components
            computed_breakdown_sum = mat + lab + eqp + sub + trans + waste
            if flat_rate == Decimal("0") and computed_breakdown_sum > Decimal("0"):
                rate = computed_breakdown_sum
            else:
                rate = flat_rate
                if computed_breakdown_sum > Decimal("0") and rate != computed_breakdown_sum:
                    item_alerts.append(
                        f"Item '{desc}': flat rate (${rate}) does not match the sum of its cost "
                        f"breakdown components (${computed_breakdown_sum}). The flat rate was used "
                        "for direct costs; the breakdown totals below reflect the components, not the billed rate."
                    )

            boq_items.append(
                BOQItem(
                    description=desc,
                    quantity=qty,
                    unit=unit,
                    rate=rate,
                    material_rate=mat,
                    labour_rate=lab,
                    equipment_rate=eqp,
                    subcontractor_rate=sub,
                    transport_rate=trans,
                    waste_allowance_rate=waste,
                )
            )

            # Sum up direct item costs
            item_cost = (qty * rate).quantize(rounding_prec, rounding=ROUND_HALF_UP)
            direct_costs += item_cost

            # Aggregate breakdown totals
            total_materials += (qty * mat).quantize(
                rounding_prec, rounding=ROUND_HALF_UP
            )
            total_labour += (qty * lab).quantize(rounding_prec, rounding=ROUND_HALF_UP)
            total_equipment += (qty * eqp).quantize(
                rounding_prec, rounding=ROUND_HALF_UP
            )
            total_subcontractors += (qty * sub).quantize(
                rounding_prec, rounding=ROUND_HALF_UP
            )
            total_transport += (qty * trans).quantize(
                rounding_prec, rounding=ROUND_HALF_UP
            )
            total_waste += (qty * waste).quantize(rounding_prec, rounding=ROUND_HALF_UP)

        prelims = cls.sanitize_decimal(input_data.get("preliminaries"))
        if prelims < 0:
            prelims = Decimal("0")
        prelims = prelims.quantize(rounding_prec, rounding=ROUND_HALF_UP)

        # Base for percentage calculations
        base_for_markups = direct_costs + prelims

        # Rates (fractions)
        overhead_rate = cls.sanitize_decimal(input_data.get("overhead_rate"))
        contingency_rate = cls.sanitize_decimal(input_data.get("contingency_rate"))
        profit_rate = cls.sanitize_decimal(input_data.get("profit_rate"))
        discount = cls.sanitize_decimal(input_data.get("discount"))
        # An omitted tax_rate (key absent, e.g. an older caller that predates
        # this field) falls back to the documented 0.15 ZIMRA VAT default
        # rather than silently pricing the quote at 0% tax. An explicitly
        # supplied 0 (VAT-exempt quote) is honoured as-is.
        if "tax_rate" in input_data and input_data.get("tax_rate") is not None:
            tax_rate = cls.sanitize_decimal(input_data.get("tax_rate"))
        else:
            tax_rate = Decimal("0.15")
        prov_sums = cls.sanitize_decimal(input_data.get("provisional_sums"))

        # Zero out negative rates/sums
        overhead_rate = max(Decimal("0"), overhead_rate)
        contingency_rate = max(Decimal("0"), contingency_rate)
        profit_rate = max(Decimal("0"), profit_rate)
        discount = max(Decimal("0"), discount).quantize(rounding_prec, rounding=ROUND_HALF_UP)
        tax_rate = max(Decimal("0"), tax_rate)
        prov_sums = max(Decimal("0"), prov_sums).quantize(rounding_prec, rounding=ROUND_HALF_UP)

        # Amounts
        overhead_amount = (base_for_markups * overhead_rate).quantize(
            rounding_prec, rounding=ROUND_HALF_UP
        )
        contingency_amount = (base_for_markups * contingency_rate).quantize(
            rounding_prec, rounding=ROUND_HALF_UP
        )
        profit_amount = (base_for_markups * profit_rate).quantize(
            rounding_prec, rounding=ROUND_HALF_UP
        )

        # Base subtotal includes provisional sums
        subtotal = (
            base_for_markups
            + overhead_amount
            + contingency_amount
            + profit_amount
            + prov_sums
        )

        # Enforce that discount cannot reduce taxable amount below zero
        taxable_amount = max(Decimal("0"), subtotal - discount)
        tax_amount = (taxable_amount * tax_rate).quantize(
            rounding_prec, rounding=ROUND_HALF_UP
        )

        grand_total = taxable_amount + tax_amount

        # Margin Threshold Checks (Flag overrides or alerts)
        unauthorised_margins = False
        alerts = list(item_alerts)
        if profit_rate > Decimal("0.40"):
            unauthorised_margins = True
            alerts.append("Profit rate exceeds maximum corporate threshold of 40%.")
        if overhead_rate > Decimal("0.25"):
            unauthorised_margins = True
            alerts.append("Overhead rate exceeds maximum corporate threshold of 25%.")

        # Benchmarking finished price per sqm ($450–$800 USD/sqm)
        sqm_benchmark_status = "not_applicable"
        finished_price_per_sqm = Decimal("0")
        if built_area_sqm > 0:
            finished_price_per_sqm = (grand_total / built_area_sqm).quantize(rounding_prec, rounding=ROUND_HALF_UP)
            if finished_price_per_sqm < Decimal("450"):
                sqm_benchmark_status = "below_range"
                alerts.append(f"Finished price of ${finished_price_per_sqm}/m² is below the standard corporate benchmark range ($450 - $800/m²). Ensure cost recovery is sufficient.")
            elif finished_price_per_sqm > Decimal("800"):
                sqm_benchmark_status = "above_range"
                alerts.append(f"Finished price of ${finished_price_per_sqm}/m² exceeds the standard corporate benchmark range ($450 - $800/m²). Review premium finish specification or markup.")
            else:
                sqm_benchmark_status = "within_range"
        
        # Inflation check warning
        if not is_inflation_adjusted:
            alerts.append("Pricing represents historical rates and has not been inflation-adjusted for current material price fluctuations. Recommend review against cost catalog.")

        breakdown_log = {
            "boq_item_count": len(boq_items),
            "overhead_percentage": f"{overhead_rate * 100}%",
            "contingency_percentage": f"{contingency_rate * 100}%",
            "profit_percentage": f"{profit_rate * 100}%",
            "tax_percentage": f"{tax_rate * 100}%",
            "margin_policy_violated": unauthorised_margins,
            "margin_alerts": alerts,
            "direct_costs_breakdown": {
                "materials": str(total_materials),
                "labour": str(total_labour),
                "equipment": str(total_equipment),
                "subcontractors": str(total_subcontractors),
                "transport": str(total_transport),
                "waste_allowance": str(total_waste),
            },
            "estimation_controls": {
                "built_area_sqm": str(built_area_sqm),
                "finished_price_per_sqm": str(finished_price_per_sqm),
                "sqm_benchmark_status": sqm_benchmark_status,
                "price_validity_days": price_validity_days,
                "is_inflation_adjusted": is_inflation_adjusted,
            }
        }

        # Secure Checksum/Audit Hash (prevent pricing database tampering).
        # Every input that feeds the final grand_total must be represented here -
        # otherwise that field could be tampered with post-calculation without
        # invalidating the hash, as long as grand_total itself is left consistent.
        checksum_payload = {
            "quotation_id": quotation_id,
            "revision_number": revision_number,
            "grand_total": str(grand_total),
            "direct_costs": str(direct_costs),
            "preliminaries": str(prelims),
            "overhead_rate": str(overhead_rate),
            "contingency_rate": str(contingency_rate),
            "profit_rate": str(profit_rate),
            "tax_rate": str(tax_rate),
            "discount": str(discount),
            "provisional_sums": str(prov_sums),
            "margin_policy_violated": unauthorised_margins,
            "built_area_sqm": str(built_area_sqm),
            "is_inflation_adjusted": is_inflation_adjusted,
            "items": [
                {"description": bi.description, "quantity": str(bi.quantity), "rate": str(bi.rate)}
                for bi in boq_items
            ],
        }
        checksum_str = json.dumps(checksum_payload, sort_keys=True)
        audit_trail_hash = hashlib.sha256(checksum_str.encode("utf-8")).hexdigest()

        return QuotationCalculationResult(
            direct_costs=direct_costs,
            preliminaries=prelims,
            overhead_amount=overhead_amount,
            contingency_amount=contingency_amount,
            profit_amount=profit_amount,
            provisional_sums=prov_sums,
            subtotal=subtotal,
            discount_amount=discount,
            taxable_amount=taxable_amount,
            tax_amount=tax_amount,
            grand_total=grand_total,
            breakdown_log=breakdown_log,
            quotation_id=quotation_id,
            revision_number=revision_number,
            assumptions=assumptions,
            exclusions=exclusions,
            audit_trail_hash=audit_trail_hash,
            built_area_sqm=built_area_sqm,
            price_validity_days=price_validity_days,
            is_inflation_adjusted=is_inflation_adjusted,
        )


def sum_buildup_by_type(item: Dict[str, Any], component_type: str) -> float:
    return sum(
        (float(b.get("qty", 0)) or 0) * (float(b.get("rate", 0)) or 0)
        for b in (item.get("buildup") or [])
        if b.get("type") == component_type
    )


def build_calc_input_from_metadata(quotation_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Maps a quotation's stored metadata blob into the shape
    QuotationCalculator.calculate() expects. Shared by every code path that
    needs to re-derive a priced cost breakdown from a quotation - originally
    inlined in quotations.py's decide_quotation, extracted so
    mark_opportunity_won (crm.py) can run the identical calculation instead
    of re-deriving its own, subtly different version."""
    return {
        "quotation_id": quotation_id,
        "preliminaries": metadata.get("preliminaries", 0),
        "overhead_rate": float(metadata.get("overhead_pct", 0) or 0) / 100.0,
        "contingency_rate": float(metadata.get("contingency_pct", 0) or 0) / 100.0,
        "profit_rate": float(metadata.get("profit_pct", 0) or 0) / 100.0,
        "discount": metadata.get("discount", 0),
        "tax_rate": 0.15 if metadata.get("apply_vat") else 0,
        "provisional_sums": metadata.get("provisional_sums", 0),
        "built_area_sqm": metadata.get("built_area_sqm", 0),
        "items": [
            {
                "description": it.get("description"),
                "quantity": it.get("qty"),
                "unit": it.get("unit"),
                "rate": it.get("rate"),
                "material_rate": sum_buildup_by_type(it, "material"),
                "labour_rate": sum_buildup_by_type(it, "labour"),
                "equipment_rate": sum_buildup_by_type(it, "equipment"),
                "subcontractor_rate": sum_buildup_by_type(it, "subcontractor"),
            }
            for it in (metadata.get("items") or [])
        ],
    }
