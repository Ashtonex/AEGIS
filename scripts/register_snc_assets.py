"""
Register Six Nine Construction Fixed Assets and Plant Register into Project AEGIS (fleet.fleet).

This script idempotently registers or updates all 17 fixed assets and plant equipment items
for Six Nine Construction (Private) Limited.
"""

import asyncio
import os
import sys
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in environment.")
    sys.exit(1)

# Ensure asyncpg dialect
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Raw assets data from the Six Nine Construction register
ASSET_RECORDS = [
    {
        "fa_num": 1,
        "asset_code": "SNC-FA-001",
        "description": "TLB",
        "make": "CASE",
        "model": "580 SUPER M",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": "HJE548613",
        "engine_number": "23H93",
        "year_of_manufacture": None,
        "location": "SOLD",
        "purchase_date": date(2024, 4, 1),
        "sell_date": date(2026, 6, 5),
        "raw_status": "SOLD",
        "asset_category": "Heavy plant",
        "asset_type": "TLB (Tractor Loader Backhoe)",
        "vehicle_type": "tlb",
        "meter_type": "engine_hours",
        "operational_status": "disposed",
        "disposal_status": "disposed",
    },
    {
        "fa_num": 2,
        "asset_code": "SNC-FA-002",
        "description": "SIDEPAN 7 TON",
        "make": "HINO RANGER",
        "model": "FF",
        "reg_number": "ADA3337",
        "colour": "BLUE",
        "serial_number": "AHHGDA15KXX010643",
        "engine_number": "MJ010035A078416X",
        "year_of_manufacture": None,
        "location": "SOLD",
        "purchase_date": None,
        "sell_date": date(2026, 5, 21),
        "raw_status": "SOLD",
        "asset_category": "Trucks and commercial vehicles",
        "asset_type": "Sidepan 7 Ton",
        "vehicle_type": "truck",
        "meter_type": "kilometres",
        "operational_status": "disposed",
        "disposal_status": "disposed",
    },
    {
        "fa_num": 3,
        "asset_code": "SNC-FA-003",
        "description": "LOWBED TRAILER",
        "make": "TRAILER LOWBED",
        "model": "LOWBED TRAILER",
        "reg_number": "ACQ9607",
        "colour": "WHITE",
        "serial_number": "AAGB232AM8B5P/087",
        "engine_number": None,
        "year_of_manufacture": 2009,
        "location": "SOLD",
        "purchase_date": None,
        "sell_date": date(2026, 5, 22),
        "raw_status": "SOLD",
        "asset_category": "Trucks and commercial vehicles",
        "asset_type": "Lowbed Trailer",
        "vehicle_type": "trailer",
        "meter_type": "kilometres",
        "operational_status": "disposed",
        "disposal_status": "disposed",
    },
    {
        "fa_num": 4,
        "asset_code": "SNC-FA-004",
        "description": "HORSE",
        "make": "DAF",
        "model": "CF 75.310",
        "reg_number": "ACQ1401",
        "colour": "GREEN",
        "serial_number": "XLRTE75PC0E663798",
        "engine_number": "523606",
        "year_of_manufacture": 2004,
        "location": "SOLD",
        "purchase_date": None,
        "sell_date": date(2026, 5, 22),
        "raw_status": "SOLD",
        "asset_category": "Trucks and commercial vehicles",
        "asset_type": "Mechanical Horse / Prime Mover",
        "vehicle_type": "truck",
        "meter_type": "kilometres",
        "operational_status": "disposed",
        "disposal_status": "disposed",
    },
    {
        "fa_num": 5,
        "asset_code": "SNC-FA-005",
        "description": "CRANE",
        "make": "GROVE",
        "model": "TMS 760",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": date(2024, 6, 1),
        "sell_date": None,
        "raw_status": "under maintanance",
        "asset_category": "Heavy plant",
        "asset_type": "Mobile Crane",
        "vehicle_type": "crane",
        "meter_type": "engine_hours",
        "operational_status": "under_repair",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 6,
        "asset_code": "SNC-FA-006",
        "description": "CONCRETE PUMP",
        "make": "PUTZMEISTER",
        "model": "BSA 1005-D",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": "214305759",
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "Astera Resources",
        "purchase_date": date(2025, 12, 14),
        "sell_date": None,
        "raw_status": "under maintanance",
        "asset_category": "Concrete equipment",
        "asset_type": "Stationary Concrete Pump",
        "vehicle_type": "concrete_pump",
        "meter_type": "engine_hours",
        "operational_status": "under_repair",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 7,
        "asset_code": "SNC-FA-007",
        "description": "Batch Plant",
        "make": "ELKON",
        "model": "MIX MASTER 30",
        "reg_number": None,
        "colour": "ORANGE",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": date(2025, 12, 2),
        "sell_date": None,
        "raw_status": "under maintanance",
        "asset_category": "Concrete equipment",
        "asset_type": "Concrete Batching Plant",
        "vehicle_type": "batch_plant",
        "meter_type": "engine_hours",
        "operational_status": "under_repair",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 8,
        "asset_code": "SNC-FA-008",
        "description": "Concrete mixer",
        "make": "TURNER MORRIS",
        "model": "400LTR",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "Beira corridor",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Concrete equipment",
        "asset_type": "Concrete Mixer 400L",
        "vehicle_type": "concrete_mixer",
        "meter_type": "engine_hours",
        "operational_status": "available",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 9,
        "asset_code": "SNC-FA-009",
        "description": "power float",
        "make": "TOTAL",
        "model": None,
        "reg_number": None,
        "colour": "GREEN",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Small plant and tools",
        "asset_type": "Power Float",
        "vehicle_type": "power_float",
        "meter_type": "engine_hours",
        "operational_status": "available",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 10,
        "asset_code": "SNC-FA-010",
        "description": "jumping compactor",
        "make": "TEKPAC",
        "model": None,
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Small plant and tools",
        "asset_type": "Jumping Compactor / Rammer",
        "vehicle_type": "compactor",
        "meter_type": "engine_hours",
        "operational_status": "available",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 11,
        "asset_code": "SNC-FA-011",
        "description": "jumping compactor",
        "make": "ROBIN",
        "model": "5.0 EY20D",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "not working",
        "asset_category": "Small plant and tools",
        "asset_type": "Jumping Compactor / Rammer",
        "vehicle_type": "compactor",
        "meter_type": "engine_hours",
        "operational_status": "breakdown",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 12,
        "asset_code": "SNC-FA-012",
        "description": "plate compactor",
        "make": "SINO PLANT",
        "model": "GP-150",
        "reg_number": None,
        "colour": "YELLOW",
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "not working",
        "asset_category": "Small plant and tools",
        "asset_type": "Plate Compactor",
        "vehicle_type": "compactor",
        "meter_type": "engine_hours",
        "operational_status": "breakdown",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 13,
        "asset_code": "SNC-FA-013",
        "description": "toyota hilux",
        "make": "TOYOTA",
        "model": "GD-6 HILUX",
        "reg_number": "AFX 8804",
        "colour": "BLACK",
        "serial_number": "MR0BA3CD700006787",
        "engine_number": "1GD-021374",
        "year_of_manufacture": 2016,
        "location": "Operations",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Light vehicles",
        "asset_type": "Toyota Hilux GD-6",
        "vehicle_type": "pickup",
        "meter_type": "kilometres",
        "operational_status": "operating",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 14,
        "asset_code": "SNC-FA-014",
        "description": "toyota Axio",
        "make": "TOYOTA",
        "model": "COROLLA AXIO",
        "reg_number": "AGS4825",
        "colour": "WHITE",
        "serial_number": "NKE165-7096776",
        "engine_number": None,
        "year_of_manufacture": 2015,
        "location": "Operations",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Light vehicles",
        "asset_type": "Toyota Corolla Axio",
        "vehicle_type": "sedan",
        "meter_type": "kilometres",
        "operational_status": "operating",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 15,
        "asset_code": "SNC-FA-015",
        "description": "Toyota Aqua",
        "make": "TOYOTA",
        "model": "AQUA",
        "reg_number": "AHO0664",
        "colour": "SILVER",
        "serial_number": "NHP10-2576662",
        "engine_number": None,
        "year_of_manufacture": 2016,
        "location": "Operations",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Light vehicles",
        "asset_type": "Toyota Aqua",
        "vehicle_type": "hatchback",
        "meter_type": "kilometres",
        "operational_status": "operating",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 16,
        "asset_code": "SNC-FA-016",
        "description": "pocker vibrator",
        "make": None,
        "model": None,
        "reg_number": None,
        "colour": None,
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "Beira corridor",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "good",
        "asset_category": "Small plant and tools",
        "asset_type": "Poker Vibrator",
        "vehicle_type": "concrete_vibrator",
        "meter_type": "engine_hours",
        "operational_status": "available",
        "disposal_status": "in_service",
    },
    {
        "fa_num": 17,
        "asset_code": "SNC-FA-017",
        "description": "brick molding machine",
        "make": None,
        "model": None,
        "reg_number": None,
        "colour": None,
        "serial_number": None,
        "engine_number": None,
        "year_of_manufacture": None,
        "location": "CBC",
        "purchase_date": None,
        "sell_date": None,
        "raw_status": "working",
        "asset_category": "Heavy plant",
        "asset_type": "Brick Molding Machine",
        "vehicle_type": "brick_machine",
        "meter_type": "engine_hours",
        "operational_status": "operating",
        "disposal_status": "in_service",
    },
]


async def register_assets():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        # 1. Resolve Organization ID
        org_res = await conn.execute(
            text("SELECT id, name FROM core.organizations WHERE name ILIKE '%Six Nine%' LIMIT 1")
        )
        org_row = org_res.first()
        if not org_row:
            # Fallback to standard org
            org_res = await conn.execute(text("SELECT id, name FROM core.organizations LIMIT 1"))
            org_row = org_res.first()
        org_id = org_row[0]
        org_name = org_row[1]
        print(f"Target Organization: {org_name} ({org_id})")

        # 2. Resolve Admin User ID
        user_res = await conn.execute(
            text("SELECT id, email FROM core.users WHERE email = 'admin@sixnineconstruction.com' LIMIT 1")
        )
        user_row = user_res.first()
        if not user_row:
            user_res = await conn.execute(text("SELECT id, email FROM core.users LIMIT 1"))
            user_row = user_res.first()
        user_id = user_row[0] if user_row else None
        print(f"Created By User: {user_row[1] if user_row else 'None'} ({user_id})")

        registered_count = 0
        updated_count = 0

        for item in ASSET_RECORDS:
            code = item["asset_code"]
            # Registration: if road reg exists use it, otherwise use asset code
            veh_reg = item["reg_number"] if item["reg_number"] else code

            # Compose informative notes
            notes_parts = []
            if item["colour"]:
                notes_parts.append(f"Colour: {item['colour']}")
            if item["engine_number"]:
                notes_parts.append(f"Engine No: {item['engine_number']}")
            if item["raw_status"]:
                notes_parts.append(f"Original Register Status: {item['raw_status']}")
            if item["sell_date"]:
                notes_parts.append(f"Disposal/Sell Date: {item['sell_date']}")
            notes = " | ".join(notes_parts) if notes_parts else None

            # Check if asset already exists by asset_code or vehicle_registration in this org
            existing = await conn.execute(
                text("""
                    SELECT id, asset_code, vehicle_registration
                    FROM fleet.fleet
                    WHERE organization_id = :org_id
                      AND (asset_code = :code OR vehicle_registration = :veh_reg)
                      AND is_deleted = false
                """),
                {"org_id": org_id, "code": code, "veh_reg": veh_reg},
            )
            existing_row = existing.first()

            params = {
                "org_id": org_id,
                "user_id": user_id,
                "asset_code": code,
                "vehicle_registration": veh_reg,
                "vehicle_type": item["vehicle_type"],
                "asset_category": item["asset_category"],
                "asset_type": item["asset_type"],
                "make": item["make"],
                "model": item["model"],
                "model_year": item["year_of_manufacture"],
                "serial_number": item["serial_number"],
                "chassis_number": item["serial_number"],
                "vin": item["serial_number"],
                "purchase_date": item["purchase_date"],
                "acquired_on": item["purchase_date"],
                "disposal_date": item["sell_date"],
                "current_location": item["location"],
                "meter_type": item["meter_type"],
                "ownership_type": "owned",
                "operational_status": item["operational_status"],
                "disposal_status": item["disposal_status"],
                "notes": notes,
            }

            if existing_row:
                asset_id = existing_row[0]
                await conn.execute(
                    text("""
                        UPDATE fleet.fleet SET
                            vehicle_registration = :vehicle_registration,
                            vehicle_type = :vehicle_type,
                            asset_category = :asset_category,
                            asset_type = :asset_type,
                            make = :make,
                            model = :model,
                            model_year = :model_year,
                            serial_number = :serial_number,
                            chassis_number = :chassis_number,
                            vin = :vin,
                            purchase_date = :purchase_date,
                            acquired_on = :acquired_on,
                            disposal_date = :disposal_date,
                            current_location = :current_location,
                            meter_type = :meter_type,
                            operational_status = :operational_status,
                            disposal_status = :disposal_status,
                            notes = :notes,
                            updated_at = NOW()
                        WHERE id = :asset_id AND organization_id = :org_id
                    """),
                    {**params, "asset_id": asset_id},
                )
                print(f"[{code}] Updated: {item['description']} ({veh_reg}) -> ID {asset_id}")
                updated_count += 1
            else:
                insert_res = await conn.execute(
                    text("""
                        INSERT INTO fleet.fleet (
                            organization_id, created_by, asset_code, vehicle_registration,
                            vehicle_type, asset_category, asset_type, make, model,
                            model_year, serial_number, chassis_number, vin,
                            purchase_date, acquired_on, disposal_date,
                            current_location, meter_type, ownership_type,
                            operational_status, disposal_status, notes
                        ) VALUES (
                            :org_id, :user_id, :asset_code, :vehicle_registration,
                            :vehicle_type, :asset_category, :asset_type, :make, :model,
                            :model_year, :serial_number, :chassis_number, :vin,
                            :purchase_date, :acquired_on, :disposal_date,
                            :current_location, :meter_type, :ownership_type,
                            :operational_status, :disposal_status, :notes
                        ) RETURNING id
                    """),
                    params,
                )
                new_id = insert_res.scalar()
                print(f"[{code}] Registered: {item['description']} ({veh_reg}) -> ID {new_id}")
                registered_count += 1

        print(f"\nCompleted: {registered_count} newly registered, {updated_count} updated.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(register_assets())
