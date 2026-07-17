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

        raw_items = input_data.get("items", [])
        boq_items: List[BOQItem] = []
        direct_costs = Decimal("0")

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

            # Zero out negative quantities
            if qty < 0:
                qty = Decimal("0")
            if flat_rate < 0:
                flat_rate = Decimal("0")

            # Map breakdowns to zero if negative
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

            desc = str(item.get("description", "Unspecified item"))
            unit = str(item.get("unit", "m"))

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

        # Base for percentage calculations
        base_for_markups = direct_costs + prelims

        # Rates (fractions)
        overhead_rate = cls.sanitize_decimal(input_data.get("overhead_rate"))
        contingency_rate = cls.sanitize_decimal(input_data.get("contingency_rate"))
        profit_rate = cls.sanitize_decimal(input_data.get("profit_rate"))
        discount = cls.sanitize_decimal(input_data.get("discount"))
        tax_rate = cls.sanitize_decimal(input_data.get("tax_rate"))
        prov_sums = cls.sanitize_decimal(input_data.get("provisional_sums"))

        # Zero out negative rates/sums
        overhead_rate = max(Decimal("0"), overhead_rate)
        contingency_rate = max(Decimal("0"), contingency_rate)
        profit_rate = max(Decimal("0"), profit_rate)
        discount = max(Decimal("0"), discount)
        tax_rate = max(Decimal("0"), tax_rate)
        prov_sums = max(Decimal("0"), prov_sums)

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
        alerts = []
        if profit_rate > Decimal("0.40"):
            unauthorised_margins = True
            alerts.append("Profit rate exceeds maximum corporate threshold of 40%.")
        if overhead_rate > Decimal("0.25"):
            unauthorised_margins = True
            alerts.append("Overhead rate exceeds maximum corporate threshold of 25%.")

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
        }

        # Secure Checksum/Audit Hash (prevent pricing database tampering)
        checksum_payload = {
            "quotation_id": quotation_id,
            "revision_number": revision_number,
            "grand_total": str(grand_total),
            "direct_costs": str(direct_costs),
            "overhead_rate": str(overhead_rate),
            "profit_rate": str(profit_rate),
            "margin_policy_violated": unauthorised_margins,
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
        )
