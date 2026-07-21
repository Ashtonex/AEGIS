"use client";

import React, { useState, useEffect } from "react";
import { 
  Info, AlertTriangle, TrendingUp, UserCheck, Clock, 
  Sparkles, Check, Calculator, ShieldAlert, Hammer, 
  ChevronDown, ChevronRight, Wrench, Package, ShieldCheck, Copy 
} from "lucide-react";

interface RuthlessCalculatorProps {
  lineItemQty: number;
  lineItemUnit: string;
  onInject: (buildupRows: any[]) => void;
  onClose: () => void;
}

type TaskType = 
  | "brickwork" | "plastering" | "concrete" | "excavation" | "painting" 
  | "tiling" | "formwork" | "rebar" | "roofing" | "ceiling";

type StanceType = "fair" | "aggressive" | "mercenary";

export default function RuthlessCalculator({ 
  lineItemQty, 
  lineItemUnit, 
  onInject, 
  onClose 
}: RuthlessCalculatorProps) {
  
  const [taskType, setTaskType] = useState<TaskType>("brickwork");
  const [activeStance, setActiveStance] = useState<StanceType>("fair");
  
  // Custom or standard basis quantity
  const [basisQty, setBasisQty] = useState<number>(lineItemQty > 0 ? lineItemQty : 100);
  
  // General Labor Cost States
  const [skilledWage, setSkilledWage] = useState<number>(45); // USD per day
  const [helperWage, setHelperWage] = useState<number>(22);   // USD per day
  
  // Equipment / Tool Hire Cost State
  const [dailyEquipmentCost, setDailyEquipmentCost] = useState<number>(10); // USD per day

  // Collapsible Advanced QS Parameters
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [mortarShrinkage, setMortarShrinkage] = useState<number>(1.30); // 30% shrinkage/waste
  const [concreteShrinkage, setConcreteShrinkage] = useState<number>(1.54); // 54% bulk shrinkage
  const [sandDensity, setSandDensity] = useState<number>(1.60); // tons/m3
  const [stoneDensity, setStoneDensity] = useState<number>(1.50); // tons/m3
  const [toolWastage, setToolWastage] = useState<number>(8); // percentage allowance for small tools

  // --- TASK 1: BRICKWORK / BLOCKWORK PARAMETERS ---
  const [brickType, setBrickType] = useState<"common" | "face" | "block90" | "block140" | "block190">("common");
  const [wallThickness, setWallThickness] = useState<"half" | "one">("half"); // single or double skin
  const [jointSize, setJointSize] = useState<number>(10); // mm
  const [brickWastage, setBrickWastage] = useState<number>(5); // %
  const [mortarMixRatio, setMortarMixRatio] = useState<number>(4); // 1:4 cement to sand
  
  // Prices
  const [priceCement, setPriceCement] = useState<number>(11.00); // per 50kg bag
  const [priceSand, setPriceSand] = useState<number>(25.00);     // per m3
  const [priceBrick, setPriceBrick] = useState<number>(0.12);     // per brick
  const [priceBlock, setPriceBlock] = useState<number>(0.85);     // per block
  const [dailyLayingTarget, setDailyLayingTarget] = useState<number>(600); // bricks per day per team

  // --- TASK 2: PLASTERING PARAMETERS ---
  const [plasterThickness, setPlasterThickness] = useState<number>(15); // mm
  const [plasterMixRatio, setPlasterMixRatio] = useState<number>(4); // 1:4 cement to sand
  const [dailyPlasterTarget, setDailyPlasterTarget] = useState<number>(20); // sqm per day per team

  // --- TASK 3: CONCRETE POURING PARAMETERS ---
  const [concreteMix, setConcreteMix] = useState<"1:2:4" | "1:3:6" | "1:1.5:3">("1:2:4");
  const [concreteTeamSize, setConcreteTeamSize] = useState<number>(4); // workers in crew
  const [dailyConcreteTarget, setDailyConcreteTarget] = useState<number>(4); // m3 per day per crew
  const [priceStone, setPriceStone] = useState<number>(30.00); // per m3

  // --- TASK 4: MANUAL EXCAVATION PARAMETERS ---
  const [soilType, setSoilType] = useState<"soft" | "medium" | "hard">("medium");

  // --- TASK 5: PAINTING PARAMETERS ---
  const [finishCoats, setFinishCoats] = useState<number>(2);
  const [hasPrimer, setHasPrimer] = useState<boolean>(true);
  const [paintCoverage, setPaintCoverage] = useState<number>(8); // sqm per liter
  const [primerCoverage, setPrimerCoverage] = useState<number>(8); // sqm per liter
  const [dailyPaintTarget, setDailyPaintTarget] = useState<number>(50); // sqm per day per painter
  const [pricePaint, setPricePaint] = useState<number>(6.50); // per Liter
  const [pricePrimer, setPricePrimer] = useState<number>(4.50); // per Liter

  // --- TASK 6: TILING PARAMETERS ---
  const [priceTile, setPriceTile] = useState<number>(12.50); // per sqm
  const [priceAdhesive, setPriceAdhesive] = useState<number>(7.50); // per 20kg bag
  const [priceGrout, setPriceGrout] = useState<number>(6.00); // per 5kg bag
  const [tileWastage, setTileWastage] = useState<number>(8); // %
  const [dailyTilingTarget, setDailyTilingTarget] = useState<number>(15); // sqm per day per team

  // --- TASK 7: FORMWORK PARAMETERS ---
  const [priceShutterPly, setPriceShutterPly] = useState<number>(28.00); // per 2.44x1.22m sheet
  const [priceFormTimber, setPriceFormTimber] = useState<number>(1.50); // per meter
  const [shutterReuses, setShutterReuses] = useState<number>(5); // times
  const [dailyFormworkTarget, setDailyFormworkTarget] = useState<number>(12); // sqm per day per team

  // --- TASK 8: STEEL REINFORCEMENT (REBAR) PARAMETERS ---
  const [priceRebarSteel, setPriceRebarSteel] = useState<number>(1.15); // per kg
  const [priceBindingWire, setPriceBindingWire] = useState<number>(2.50); // per kg
  const [dailyRebarTarget, setDailyRebarTarget] = useState<number>(200); // kg per day per team

  // --- TASK 9: ROOFING PARAMETERS ---
  const [priceRoofSheet, setPriceRoofSheet] = useState<number>(9.50); // per sqm
  const [priceRoofTimber, setPriceRoofTimber] = useState<number>(1.25); // per meter
  const [roofSlopeFactor, setRoofSlopeFactor] = useState<number>(1.08); // pitch multiplier
  const [dailyRoofTarget, setDailyRoofTarget] = useState<number>(35); // sqm per day per team

  // --- TASK 10: CEILING PARAMETERS ---
  const [priceCeilingBoard, setPriceCeilingBoard] = useState<number>(5.50); // per sqm
  const [priceCeilingGrid, setPriceCeilingGrid] = useState<number>(1.80); // per meter
  const [dailyCeilingTarget, setDailyCeilingTarget] = useState<number>(25); // sqm per day per team

  const [copied, setCopied] = useState<boolean>(false);

  // Set default targets when task / brick type changes
  useEffect(() => {
    if (taskType === "brickwork") {
      if (brickType === "common") {
        setDailyLayingTarget(600);
        setPriceBrick(0.12);
      } else if (brickType === "face") {
        setDailyLayingTarget(400);
        setPriceBrick(0.26);
      } else {
        setDailyLayingTarget(150);
      }
    }
  }, [brickType, taskType]);

  // Sync basis quantity with line item quantity if it changes
  useEffect(() => {
    if (lineItemQty > 0) {
      setBasisQty(lineItemQty);
    }
  }, [lineItemQty]);

  // Adjust defaults based on task type to be realistic
  useEffect(() => {
    if (taskType === "excavation") {
      setSkilledWage(20);
      setHelperWage(0);
      setDailyEquipmentCost(3);
    } else if (taskType === "painting") {
      setSkilledWage(35);
      setHelperWage(18);
      setDailyEquipmentCost(5);
    } else if (taskType === "concrete") {
      setSkilledWage(22);
      setHelperWage(22);
      setDailyEquipmentCost(25);
    } else if (taskType === "rebar") {
      setSkilledWage(38);
      setHelperWage(20);
      setDailyEquipmentCost(8);
    } else {
      setSkilledWage(45);
      setHelperWage(22);
      setDailyEquipmentCost(12);
    }
  }, [taskType]);

  // ==========================================
  //            CALCULATIONS ENGINE
  // ==========================================
  
  const calculateOutputs = () => {
    const results: {
      materials: Array<{ name: string; type: "material"; qty: number; unit: string; rate: number; total: number; note?: string }>;
      labour: Array<{ name: string; type: "labour"; qty: number; unit: string; rate: number; total: number }>;
      equipment: Array<{ name: string; type: "equipment"; qty: number; unit: string; rate: number; total: number }>;
      totalMaterialCost: number;
      totalLabourCost: number;
      totalEquipmentCost: number;
      laborDaysNeeded: number;
      elapsedDays: number;
      unitRate: number;
      logisticsNote: string;
      stances: Record<StanceType, { rate: number; total: number; script: string; risk: string; speedMultiplier: number }>;
    } = {
      materials: [],
      labour: [],
      equipment: [],
      totalMaterialCost: 0,
      totalLabourCost: 0,
      totalEquipmentCost: 0,
      laborDaysNeeded: 0,
      elapsedDays: 0,
      unitRate: 0,
      logisticsNote: "",
      stances: {
        fair: { rate: 0, total: 0, script: "", risk: "Low", speedMultiplier: 1.0 },
        aggressive: { rate: 0, total: 0, script: "", risk: "Moderate", speedMultiplier: 1.15 },
        mercenary: { rate: 0, total: 0, script: "", risk: "High", speedMultiplier: 1.25 }
      }
    };

    const currentLaborMultiplier = activeStance === "fair" ? 1.0 : activeStance === "aggressive" ? 1.15 : 1.25;
    
    let durationDays = 0;
    let cementBagsPerUnit = 0;
    let sandVolumePerUnit = 0;
    let stoneVolumePerUnit = 0;
    let sandTonsTotal = 0;
    let stoneTonsTotal = 0;

    if (taskType === "brickwork") {
      let L = 222, W = 106, H = 73;
      let isBlock = false;

      if (brickType === "common") {
        L = 222; W = 106; H = 73;
      } else if (brickType === "face") {
        L = 222; W = 106; H = 73;
      } else if (brickType === "block90") {
        L = 390; W = 90; H = 190; isBlock = true;
      } else if (brickType === "block140") {
        L = 390; W = 140; H = 190; isBlock = true;
      } else if (brickType === "block190") {
        L = 390; W = 190; H = 190; isBlock = true;
      }

      const effLength = (L + jointSize) / 1000;
      const effHeight = (H + jointSize) / 1000;
      const faceArea = effLength * effHeight;
      const baseUnitsPerSqm = 1 / faceArea;
      const unitsPerSqm = wallThickness === "one" && !isBlock ? baseUnitsPerSqm * 2 : baseUnitsPerSqm;
      const totalUnitsWithoutWastage = unitsPerSqm * basisQty;
      const totalUnits = Math.ceil(totalUnitsWithoutWastage * (1 + brickWastage / 100));
      const unitsPerSqmWithWastage = Number((unitsPerSqm * (1 + brickWastage / 100)).toFixed(2));

      let wetMortarPerSqm = 0;
      if (isBlock) {
        wetMortarPerSqm = 0.015;
      } else {
        const wallThicknessM = (wallThickness === "one" ? L : W) / 1000;
        const brickVolSingle = (L * W * H) / 1e9;
        const totalWallVolInOneSqm = 1 * wallThicknessM;
        const brickVolumeInOneSqm = unitsPerSqm * brickVolSingle;
        wetMortarPerSqm = Math.max(0.005, totalWallVolInOneSqm - brickVolumeInOneSqm);
      }

      const totalWetMortar = wetMortarPerSqm * basisQty;
      const totalDryMortar = totalWetMortar * mortarShrinkage;
      const mixRatioSum = 1 + mortarMixRatio;
      const cementVolume = totalDryMortar / mixRatioSum;
      const sandVolume = (totalDryMortar * mortarMixRatio) / mixRatioSum;
      const cementBags = cementVolume / 0.035;

      cementBagsPerUnit = Number((cementBags / basisQty).toFixed(4));
      sandVolumePerUnit = Number((sandVolume / basisQty).toFixed(4));
      sandTonsTotal = sandVolume * sandDensity;

      durationDays = totalUnitsWithoutWastage / (dailyLayingTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((totalUnitsWithoutWastage / dailyLayingTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: isBlock ? `${brickType.toUpperCase()} Block` : `${brickType === "face" ? "Face" : "Common"} Brick`,
        type: "material",
        qty: unitsPerSqmWithWastage,
        unit: "pcs",
        rate: isBlock ? priceBlock : priceBrick,
        total: unitsPerSqmWithWastage * (isBlock ? priceBlock : priceBrick) * basisQty
      });
      results.materials.push({
        name: "Portland Cement (CEM II 42.5N)",
        type: "material",
        qty: cementBagsPerUnit,
        unit: "bags",
        rate: priceCement,
        total: cementBagsPerUnit * priceCement * basisQty
      });
      results.materials.push({
        name: "Washed Brick Sand",
        type: "material",
        qty: sandVolumePerUnit,
        unit: "m3",
        rate: priceSand,
        total: sandVolumePerUnit * priceSand * basisQty
      });

      results.logisticsNote = `Order ${totalUnits.toLocaleString()} bricks. Sand: ${sandTonsTotal.toFixed(1)} Tons. Cement: ${Math.ceil(cementBags)} bags.`;

    } else if (taskType === "plastering") {
      const thicknessM = plasterThickness / 1000;
      const wetPlasterPerSqm = 1 * thicknessM;
      const dryPlasterPerSqm = wetPlasterPerSqm * mortarShrinkage;
      const mixRatioSum = 1 + plasterMixRatio;
      const cementVolume = (dryPlasterPerSqm / mixRatioSum) * basisQty;
      const sandVolume = ((dryPlasterPerSqm * plasterMixRatio) / mixRatioSum) * basisQty;
      const cementBags = cementVolume / 0.035;

      cementBagsPerUnit = Number((cementBags / basisQty).toFixed(4));
      sandVolumePerUnit = Number((sandVolume / basisQty).toFixed(4));
      sandTonsTotal = sandVolume * sandDensity;

      durationDays = basisQty / (dailyPlasterTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyPlasterTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "Portland Cement (CEM II 32.5R)",
        type: "material",
        qty: cementBagsPerUnit,
        unit: "bags",
        rate: priceCement,
        total: cementBagsPerUnit * priceCement * basisQty
      });
      results.materials.push({
        name: "Plaster Sand (Fine)",
        type: "material",
        qty: sandVolumePerUnit,
        unit: "m3",
        rate: priceSand,
        total: sandVolumePerUnit * priceSand * basisQty
      });

      results.logisticsNote = `Plaster Sand: ${sandTonsTotal.toFixed(1)} Tons. Cement: ${Math.ceil(cementBags)} bags.`;

    } else if (taskType === "concrete") {
      let partsCement = 1, partsSand = 2, partsStone = 4;
      if (concreteMix === "1:3:6") {
        partsCement = 1; partsSand = 3; partsStone = 6;
      } else if (concreteMix === "1:1.5:3") {
        partsCement = 1; partsSand = 1.5; partsStone = 3;
      }

      const totalParts = partsCement + partsSand + partsStone;
      const totalDryVolume = basisQty * concreteShrinkage;
      const cementVol = (totalDryVolume * partsCement) / totalParts;
      const sandVol = (totalDryVolume * partsSand) / totalParts;
      const stoneVol = (totalDryVolume * partsStone) / totalParts;
      const cementBags = cementVol / 0.035;

      cementBagsPerUnit = Number((cementBags / basisQty).toFixed(4));
      sandVolumePerUnit = Number((sandVol / basisQty).toFixed(4));
      stoneVolumePerUnit = Number((stoneVol / basisQty).toFixed(4));
      sandTonsTotal = sandVol * sandDensity;
      stoneTonsTotal = stoneVol * stoneDensity;

      durationDays = basisQty / (dailyConcreteTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number(((basisQty / dailyConcreteTarget) * concreteTeamSize).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "Portland Cement (CEM II 42.5N)",
        type: "material",
        qty: cementBagsPerUnit,
        unit: "bags",
        rate: priceCement,
        total: cementBagsPerUnit * priceCement * basisQty
      });
      results.materials.push({
        name: "Crushed Stone (19mm Granite)",
        type: "material",
        qty: stoneVolumePerUnit,
        unit: "m3",
        rate: priceStone,
        total: stoneVolumePerUnit * priceStone * basisQty
      });
      results.materials.push({
        name: "River Sand (Coarse)",
        type: "material",
        qty: sandVolumePerUnit,
        unit: "m3",
        rate: priceSand,
        total: sandVolumePerUnit * priceSand * basisQty
      });

      results.logisticsNote = `Stone: ${stoneTonsTotal.toFixed(1)} Tons. Sand: ${sandTonsTotal.toFixed(1)} Tons. Cement: ${Math.ceil(cementBags)} bags.`;

    } else if (taskType === "excavation") {
      let dailyExcavationTarget = 2.5;
      if (soilType === "soft") dailyExcavationTarget = 4.0;
      else if (soilType === "hard") dailyExcavationTarget = 1.2;

      durationDays = basisQty / (dailyExcavationTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyExcavationTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.logisticsNote = `Trench excavation. Handles soil bulking of approx 15% for stockpiling.`;

    } else if (taskType === "painting") {
      const primerLitersPerSqm = hasPrimer ? (1 / primerCoverage) : 0;
      const paintLitersPerSqm = (finishCoats / paintCoverage);
      const totalCoats = finishCoats + (hasPrimer ? 1 : 0);

      durationDays = (basisQty * totalCoats) / (dailyPaintTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number(((basisQty * totalCoats) / dailyPaintTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      if (hasPrimer) {
        results.materials.push({
          name: "Acrylic Wall Primer / Sealer",
          type: "material",
          qty: Number(primerLitersPerSqm.toFixed(4)),
          unit: "liters",
          rate: pricePrimer,
          total: primerLitersPerSqm * pricePrimer * basisQty
        });
      }
      results.materials.push({
        name: "Premium Acrylic Emulsion Paint",
        type: "material",
        qty: Number(paintLitersPerSqm.toFixed(4)),
        unit: "liters",
        rate: pricePaint,
        total: paintLitersPerSqm * pricePaint * basisQty
      });

      const totalLiters = (primerLitersPerSqm * basisQty) + (paintLitersPerSqm * basisQty);
      results.logisticsNote = `Paint needed: ${totalLiters.toFixed(1)} Liters (order ~${Math.ceil(totalLiters / 20)} x 20L drums).`;

    } else if (taskType === "tiling") {
      // Tiling: sqm basis
      const tilesSqmWithWastage = 1 * (1 + tileWastage / 100);
      const adhesiveBagsPerSqm = 0.25; // 1 bag of 20kg covers 4 sqm
      const groutBagsPerSqm = 0.10; // 1 bag of 5kg covers 50 sqm

      durationDays = basisQty / (dailyTilingTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyTilingTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "Ceramic / Porcelain Tiles",
        type: "material",
        qty: tilesSqmWithWastage,
        unit: "sqm",
        rate: priceTile,
        total: tilesSqmWithWastage * priceTile * basisQty
      });
      results.materials.push({
        name: "Premium Tile Adhesive (20kg)",
        type: "material",
        qty: adhesiveBagsPerSqm,
        unit: "bags",
        rate: priceAdhesive,
        total: adhesiveBagsPerSqm * priceAdhesive * basisQty
      });
      results.materials.push({
        name: "Waterproof Grout (5kg)",
        type: "material",
        qty: groutBagsPerSqm,
        unit: "bags",
        rate: priceGrout,
        total: groutBagsPerSqm * priceGrout * basisQty
      });

      results.logisticsNote = `Adhesive: ${Math.ceil(adhesiveBagsPerSqm * basisQty)} bags. Grout: ${Math.ceil(groutBagsPerSqm * basisQty)} bags.`;

    } else if (taskType === "formwork") {
      // Formwork contact area: sqm
      const areaOfOneSheet = 2.97; // 2.44 x 1.22
      const sheetQtyPerSqm = (1 / areaOfOneSheet) / shutterReuses;
      const timberMetersPerSqm = 4 / shutterReuses; // 4m timber frame per sqm

      durationDays = basisQty / (dailyFormworkTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyFormworkTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "Marine Shuttering Plywood (18mm)",
        type: "material",
        qty: Number(sheetQtyPerSqm.toFixed(4)),
        unit: "sheets",
        rate: priceShutterPly,
        total: sheetQtyPerSqm * priceShutterPly * basisQty
      });
      results.materials.push({
        name: "Supporting Pine Timber Frames (75x50)",
        type: "material",
        qty: Number(timberMetersPerSqm.toFixed(4)),
        unit: "m",
        rate: priceFormTimber,
        total: timberMetersPerSqm * priceFormTimber * basisQty
      });

      results.logisticsNote = `Timber adjusted for ${shutterReuses} reuses. Order ${Math.ceil(sheetQtyPerSqm * basisQty)} plywood sheets.`;

    } else if (taskType === "rebar") {
      // Rebar: kg basis
      const bindingWirePerKg = 0.015; // 1.5% weight of binding wire
      const spacerBlocksPerKg = 0.02; // 2 spacers per 100kg

      durationDays = basisQty / (dailyRebarTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyRebarTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "High-Tensile Reinforcing Steel (Y8-Y20)",
        type: "material",
        qty: 1.05, // 5% lap and scrap wastage
        unit: "kg",
        rate: priceRebarSteel,
        total: 1.05 * priceRebarSteel * basisQty
      });
      results.materials.push({
        name: "Mild Steel Binding Wire (1.6mm)",
        type: "material",
        qty: bindingWirePerKg,
        unit: "kg",
        rate: priceBindingWire,
        total: bindingWirePerKg * priceBindingWire * basisQty
      });

      results.logisticsNote = `Total steel order: ${(basisQty * 1.05 / 1000).toFixed(2)} Tons. Binding wire: ${Math.ceil(bindingWirePerKg * basisQty)} kg.`;

    } else if (taskType === "roofing") {
      // Roofing: sqm plan area
      const slopedArea = 1 * roofSlopeFactor;
      const sheetQtyPerSqm = slopedArea * 1.10; // 10% overlap
      const timberMetersPerSqm = 1.8 * roofSlopeFactor; // purlins

      durationDays = basisQty / (dailyRoofTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyRoofTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "IBR / Corrugated Roof Sheets (0.4mm)",
        type: "material",
        qty: Number(sheetQtyPerSqm.toFixed(4)),
        unit: "sqm",
        rate: priceRoofSheet,
        total: sheetQtyPerSqm * priceRoofSheet * basisQty
      });
      results.materials.push({
        name: "Timber Roofing Purlins (SA Pine 114x38)",
        type: "material",
        qty: Number(timberMetersPerSqm.toFixed(4)),
        unit: "m",
        rate: priceRoofTimber,
        total: timberMetersPerSqm * priceRoofTimber * basisQty
      });

      results.logisticsNote = `Slope pitch factor: ${roofSlopeFactor}. Roofing sheet order: ${Math.ceil(sheetQtyPerSqm * basisQty)} sqm.`;

    } else if (taskType === "ceiling") {
      // Ceiling: sqm basis
      const boardWastageFactor = 1.08; // 8% board scrap
      const gridMetersPerSqm = 1.6; // hangers + brandering runs

      durationDays = basisQty / (dailyCeilingTarget * currentLaborMultiplier);
      results.laborDaysNeeded = Number((basisQty / dailyCeilingTarget).toFixed(1));
      results.elapsedDays = Number(durationDays.toFixed(1));

      results.materials.push({
        name: "Gypsum Ceiling Plasterboard (9mm)",
        type: "material",
        qty: boardWastageFactor,
        unit: "sqm",
        rate: priceCeilingBoard,
        total: boardWastageFactor * priceCeilingBoard * basisQty
      });
      results.materials.push({
        name: "Ceiling brandering grids & hangers",
        type: "material",
        qty: gridMetersPerSqm,
        unit: "m",
        rate: priceCeilingGrid,
        total: gridMetersPerSqm * priceCeilingGrid * basisQty
      });

      results.logisticsNote = `Drywall screws & joint fillers budgeted as miscellaneous under material rates.`;
    }

    // Allocate Labour based on Task
    if (taskType !== "concrete" && taskType !== "excavation") {
      results.labour.push({
        name: `Skilled artisan / artisan team`,
        type: "labour",
        qty: Number((durationDays / basisQty).toFixed(4)),
        unit: "days",
        rate: skilledWage,
        total: skilledWage * durationDays
      });
      results.labour.push({
        name: "General helper / apprentice",
        type: "labour",
        qty: Number((durationDays / basisQty).toFixed(4)),
        unit: "days",
        rate: helperWage,
        total: helperWage * durationDays
      });
    } else if (taskType === "concrete") {
      results.labour.push({
        name: `Concrete placing crew (${concreteTeamSize} laborers)`,
        type: "labour",
        qty: Number(((durationDays * concreteTeamSize) / basisQty).toFixed(4)),
        unit: "man-days",
        rate: skilledWage,
        total: concreteTeamSize * skilledWage * durationDays
      });
    } else if (taskType === "excavation") {
      results.labour.push({
        name: "General Laborer (Manual Digging)",
        type: "labour",
        qty: Number((durationDays / basisQty).toFixed(4)),
        unit: "days",
        rate: skilledWage,
        total: skilledWage * durationDays
      });
    }

    // Equipment allocation
    results.equipment.push({
      name: "Tools, scaffolding, and site plants",
      type: "equipment",
      qty: Number((durationDays / basisQty).toFixed(4)),
      unit: "days",
      rate: dailyEquipmentCost,
      total: dailyEquipmentCost * durationDays
    });

    results.totalMaterialCost = results.materials.reduce((acc, m) => acc + m.total, 0);
    results.totalLabourCost = results.labour.reduce((acc, l) => acc + l.total, 0);
    results.totalEquipmentCost = results.equipment.reduce((acc, e) => acc + e.total, 0);
    results.unitRate = (results.totalMaterialCost + results.totalLabourCost + results.totalEquipmentCost) / basisQty;

    const dailyCrewCost = taskType === "excavation" ? skilledWage : (taskType === "concrete" ? concreteTeamSize * skilledWage : skilledWage + helperWage);
    const fairRate = (dailyCrewCost * results.laborDaysNeeded) / basisQty;

    // Stance generation
    results.stances.fair = {
      speedMultiplier: 1.0,
      rate: fairRate,
      total: fairRate * basisQty,
      risk: "Low Risk — Standard target speeds.",
      script: `Negotiation Script [FAIR MARKET]:\n"We have budgeted a crew labor rate of $${(dailyCrewCost).toFixed(2)}/day based on daily output of ${dailyLayingTarget || dailyPlasterTarget || dailyConcreteTarget || dailyPaintTarget || dailyTilingTarget || dailyFormworkTarget || dailyRebarTarget || dailyRoofTarget || dailyCeilingTarget} units/day. This comes to exactly $${fairRate.toFixed(2)} per ${lineItemUnit} for labor."`
    };

    results.stances.aggressive = {
      speedMultiplier: 1.15,
      rate: fairRate / 1.15,
      total: (fairRate / 1.15) * basisQty,
      risk: "Moderate Risk — Expects 15% higher speed.",
      script: `Negotiation Script [AGGRESSIVE TARGET]:\n"Standard labor rate is $${fairRate.toFixed(2)}/sqm. I am offering a flat rate of $${(fairRate / 1.15).toFixed(2)} per ${lineItemUnit}. If your team beats the schedule, I will payout a completion bonus of $50."`
    };

    results.stances.mercenary = {
      speedMultiplier: 1.25,
      rate: fairRate / 1.25,
      total: (fairRate / 1.25) * basisQty,
      risk: "High Risk — Expects maximum speed.",
      script: `Negotiation Script [MERCENARY LIMIT]:\n"My absolute ceiling for subcontractor labor on this scope is $${(fairRate / 1.25).toFixed(2)} per ${lineItemUnit}. I have helper crews ready to feed materials directly to your hands so you never touch a shovel or bucket."`
    };

    return results;
  };

  const calcs = calculateOutputs();

  // Push computed values to buildup
  const handleApplyToBuildup = () => {
    const selectedLaborRate = activeStance === "fair" 
      ? calcs.stances.fair.rate 
      : activeStance === "aggressive" 
        ? calcs.stances.aggressive.rate 
        : calcs.stances.mercenary.rate;

    const selectedLaborTotal = selectedLaborRate * basisQty;
    const rawLabourSum = calcs.labour.reduce((acc, l) => acc + l.total, 0);
    
    const distributedLabour = calcs.labour.map(l => {
      const proportion = rawLabourSum > 0 ? (l.total / rawLabourSum) : 0.5;
      const targetUnitCost = (selectedLaborTotal * proportion) / basisQty;
      return {
        type: "labour" as const,
        name: l.name,
        qty: 1,
        unit: "unit",
        rate: Number(targetUnitCost.toFixed(2))
      };
    });

    const generatedRows = [
      ...calcs.materials.map(m => ({
        type: "material" as const,
        name: m.name,
        qty: m.qty,
        unit: m.unit,
        rate: m.rate
      })),
      ...distributedLabour,
      ...calcs.equipment.map(e => ({
        type: "equipment" as const,
        name: e.name,
        qty: e.qty,
        unit: e.unit,
        rate: e.rate
      }))
    ];

    onInject(generatedRows);
  };

  const handleCopyScript = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-snc-navy-mid border-l border-ink-mid/60 w-full lg:max-w-md xl:max-w-lg p-5 flex flex-col justify-between h-full overflow-y-auto blueprint-grid text-paper animate-in fade-in duration-300">
      
      <div className="space-y-5">
        
        {/* Title Block */}
        <div className="flex justify-between items-start border-b border-ink-mid pb-3">
          <div>
            <span className="text-[10px] font-mono text-signal uppercase tracking-wider font-bold flex items-center gap-1">
              <Sparkles className="w-3 h-3 animate-pulse text-signal" /> Volume XIII Quantity Surveying (QS)
            </span>
            <h3 className="font-display font-bold text-base text-white mt-0.5">
              Productivity Calculator
            </h3>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-[10px] font-mono border border-ink-mid px-2 py-0.5 rounded-sm text-slate hover:text-white transition-colors hover:bg-ink-light"
          >
            Hide Estimator
          </button>
        </div>

        {/* Task type switcher tabs (2-row grid of 10 items) */}
        <div className="grid grid-cols-5 gap-1 bg-ink/60 p-1 border border-ink-mid rounded-sm">
          {([
            "brickwork", "plastering", "concrete", "excavation", "painting",
            "tiling", "formwork", "rebar", "roofing", "ceiling"
          ] as TaskType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTaskType(t)}
              className={`py-1 text-[8px] font-mono font-bold uppercase rounded-sm transition-all text-center leading-none h-6 flex items-center justify-center ${
                taskType === t 
                  ? "bg-signal text-ink" 
                  : "text-slate hover:text-white"
              }`}
            >
              {t.substring(0, 5)}
            </button>
          ))}
        </div>

        {/* Basis Scope Info */}
        <div className="grid grid-cols-2 gap-3 bg-ink/40 p-3 border border-ink-mid/40 rounded-sm">
          <div>
            <label className="block">
              <span className="font-mono text-[8px] uppercase text-slate">Scope Quantity</span>
              <input 
                type="number" 
                value={basisQty} 
                onChange={(e) => setBasisQty(Math.max(1, parseFloat(e.target.value) || 1))}
                className="mt-1 w-full bg-ink border border-ink-mid px-2 py-1 text-xs text-white outline-none focus:border-signal font-mono text-center font-bold"
              />
            </label>
          </div>
          <div className="flex flex-col justify-end">
            <span className="font-mono text-[8px] uppercase text-slate block">Current Unit</span>
            <div className="text-sm font-bold text-white mt-1 border border-ink-mid/10 bg-ink-light/50 px-2 py-1 text-center font-mono rounded-sm">
              {lineItemUnit || "unit"}
            </div>
          </div>
        </div>

        {/* Advanced Parameters Accordion */}
        <div className="border border-ink-mid rounded-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full bg-ink-light/40 hover:bg-ink-light px-3 py-2 flex justify-between items-center text-[10px] font-mono font-bold uppercase text-slate hover:text-white transition-all"
          >
            <span className="flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5 text-signal" /> Advanced QS Yield Factors</span>
            {showAdvanced ? <ChevronDown className="w-3.5 h-3.5 text-signal" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          
          {showAdvanced && (
            <div className="bg-ink/50 p-3 border-t border-ink-mid space-y-3 text-xs grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Mortar Shrinkage Factor</span>
                <input 
                  type="number" step="0.05" value={mortarShrinkage} 
                  onChange={(e) => setMortarShrinkage(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Concrete Bulk Factor</span>
                <input 
                  type="number" step="0.05" value={concreteShrinkage} 
                  onChange={(e) => setConcreteShrinkage(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Sand Density (Tons/m³)</span>
                <input 
                  type="number" step="0.1" value={sandDensity} 
                  onChange={(e) => setSandDensity(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Stone Density (Tons/m³)</span>
                <input 
                  type="number" step="0.1" value={stoneDensity} 
                  onChange={(e) => setStoneDensity(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Daily Equipment &amp; Tool Allowance ($)</span>
                <input 
                  type="number" value={dailyEquipmentCost} 
                  onChange={(e) => setDailyEquipmentCost(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}
        </div>

        {/* Task Specific Inputs */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-mono text-white uppercase tracking-wider border-b border-ink-mid/40 pb-1">
            Task Inputs &amp; Aggregates
          </h4>

          {taskType === "brickwork" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="col-span-2 block">
                <span className="font-mono text-[8px] uppercase text-slate">Brick/Block Type</span>
                <select
                  value={brickType}
                  onChange={(e: any) => setBrickType(e.target.value)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1.5 text-xs outline-none font-mono"
                >
                  <option value="common">Standard Clay Common Brick (222x106x73)</option>
                  <option value="face">Standard Clay Face Brick (222x106x73)</option>
                  <option value="block90">90mm Hollow Concrete Block (390x90x190)</option>
                  <option value="block140">140mm Hollow Concrete Block (390x140x190)</option>
                  <option value="block190">190mm Hollow Concrete Block (390x190x190)</option>
                </select>
              </label>

              {brickType !== "block90" && brickType !== "block140" && brickType !== "block190" && (
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Wall Thickness</span>
                  <select
                    value={wallThickness}
                    onChange={(e: any) => setWallThickness(e.target.value)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                  >
                    <option value="half">Half-Brick (Single Skin)</option>
                    <option value="one">One-Brick (Double Skin)</option>
                  </select>
                </label>
              )}

              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Mortar Mix Ratio</span>
                <select
                  value={mortarMixRatio}
                  onChange={(e) => setMortarMixRatio(parseInt(e.target.value))}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                >
                  <option value="3">1:3 Heavy Duty</option>
                  <option value="4">1:4 Standard Walling</option>
                  <option value="5">1:5 Bricklaying Muted</option>
                  <option value="6">1:6 Low Load</option>
                </select>
              </label>

              <div className="col-span-2 grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Cement ($/bag)</span>
                  <input 
                    type="number" step="0.1" value={priceCement} 
                    onChange={(e) => setPriceCement(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Sand ($/m3)</span>
                  <input 
                    type="number" step="1" value={priceSand} 
                    onChange={(e) => setPriceSand(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Brick ($/unit)</span>
                  <input 
                    type="number" step="0.01" value={brickType.startsWith("block") ? priceBlock : priceBrick} 
                    onChange={(e) => brickType.startsWith("block") ? setPriceBlock(parseFloat(e.target.value) || 0) : setPriceBrick(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                  />
                </label>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-ink-mid/30 pt-2">
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Wastage Factor %</span>
                  <input 
                    type="number" value={brickWastage} 
                    onChange={(e) => setBrickWastage(parseInt(e.target.value) || 0)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate">Laying Target (pcs/day)</span>
                  <input 
                    type="number" value={dailyLayingTarget} 
                    onChange={(e) => setDailyLayingTarget(parseInt(e.target.value) || 1)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                  />
                </label>
              </div>
            </div>
          )}

          {taskType === "plastering" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Plaster Thickness (mm)</span>
                <input 
                  type="number" value={plasterThickness} 
                  onChange={(e) => setPlasterThickness(parseInt(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Mix Ratio (Cement:Sand)</span>
                <select
                  value={plasterMixRatio}
                  onChange={(e) => setPlasterMixRatio(parseInt(e.target.value))}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                >
                  <option value="3">1:3 Rich Mix</option>
                  <option value="4">1:4 Standard Render</option>
                  <option value="5">1:5 Light Internal</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Cement ($/bag)</span>
                <input 
                  type="number" step="0.1" value={priceCement} 
                  onChange={(e) => setPriceCement(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Sand ($/m3)</span>
                <input 
                  type="number" step="1" value={priceSand} 
                  onChange={(e) => setPriceSand(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Plastering Target (sqm/day)</span>
                <input 
                  type="number" value={dailyPlasterTarget} 
                  onChange={(e) => setDailyPlasterTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "concrete" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Concrete Mix Design</span>
                <select
                  value={concreteMix}
                  onChange={(e: any) => setConcreteMix(e.target.value)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                >
                  <option value="1:2:4">1:2:4 (Class 20/25 Slab)</option>
                  <option value="1:3:6">1:3:6 (Class 10/15 Blinding)</option>
                  <option value="1:1.5:3">1:1.5:3 (Class 25/30 Pillars)</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Cement ($/bag)</span>
                <input 
                  type="number" step="0.1" value={priceCement} 
                  onChange={(e) => setPriceCement(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Sand ($/m3)</span>
                <input 
                  type="number" step="1" value={priceSand} 
                  onChange={(e) => setPriceSand(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Crushed Stone ($/m3)</span>
                <input 
                  type="number" step="1" value={priceStone} 
                  onChange={(e) => setPriceStone(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Crew Size (workers)</span>
                <input 
                  type="number" value={concreteTeamSize} 
                  onChange={(e) => setConcreteTeamSize(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Crew Output (m3/day)</span>
                <input 
                  type="number" step="0.5" value={dailyConcreteTarget} 
                  onChange={(e) => setDailyConcreteTarget(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "excavation" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="col-span-2 block">
                <span className="font-mono text-[8px] uppercase text-slate">Soil / Terrain Density</span>
                <select
                  value={soilType}
                  onChange={(e: any) => setSoilType(e.target.value)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                >
                  <option value="soft">Soft Sand / Topsoil (Productive: 4.0 m3/day)</option>
                  <option value="medium">Clay / Medium Gravel (Productive: 2.5 m3/day)</option>
                  <option value="hard">Hard Earth / Rocky (Productive: 1.2 m3/day)</option>
                </select>
              </label>
            </div>
          )}

          {taskType === "painting" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Finishing Coats</span>
                <input 
                  type="number" min="1" max="4" value={finishCoats} 
                  onChange={(e) => setFinishCoats(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Apply Primer Undercoat</span>
                <select
                  value={hasPrimer ? "yes" : "no"}
                  onChange={(e) => setHasPrimer(e.target.value === "yes")}
                  className="mt-1 w-full bg-ink border border-ink-mid text-white p-1 text-xs outline-none"
                >
                  <option value="yes">Yes (1 Coat)</option>
                  <option value="no">No (Finish Only)</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Primer Cost ($/L)</span>
                <input 
                  type="number" step="0.5" value={pricePrimer} 
                  onChange={(e) => setPricePrimer(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Paint Cost ($/L)</span>
                <input 
                  type="number" step="0.5" value={pricePaint} 
                  onChange={(e) => setPricePaint(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Painter Rate (sqm/day)</span>
                <input 
                  type="number" value={dailyPaintTarget} 
                  onChange={(e) => setDailyPaintTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "tiling" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Tile Cost ($/sqm)</span>
                <input 
                  type="number" value={priceTile} 
                  onChange={(e) => setPriceTile(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Adhesive Cost ($/bag)</span>
                <input 
                  type="number" value={priceAdhesive} 
                  onChange={(e) => setPriceAdhesive(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Grout Cost ($/5kg)</span>
                <input 
                  type="number" value={priceGrout} 
                  onChange={(e) => setPriceGrout(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Tile Wastage %</span>
                <input 
                  type="number" value={tileWastage} 
                  onChange={(e) => setTileWastage(parseInt(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Tiling Target (sqm/day)</span>
                <input 
                  type="number" value={dailyTilingTarget} 
                  onChange={(e) => setDailyTilingTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "formwork" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Shutter Ply ($/sheet)</span>
                <input 
                  type="number" value={priceShutterPly} 
                  onChange={(e) => setPriceShutterPly(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Frame Timber ($/m)</span>
                <input 
                  type="number" value={priceFormTimber} 
                  onChange={(e) => setPriceFormTimber(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Timber/Ply Reuses</span>
                <input 
                  type="number" value={shutterReuses} 
                  onChange={(e) => setShutterReuses(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Formwork Speed (sqm/day)</span>
                <input 
                  type="number" value={dailyFormworkTarget} 
                  onChange={(e) => setDailyFormworkTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "rebar" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Rebar Steel ($/kg)</span>
                <input 
                  type="number" value={priceRebarSteel} 
                  onChange={(e) => setPriceRebarSteel(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Binding Wire ($/kg)</span>
                <input 
                  type="number" value={priceBindingWire} 
                  onChange={(e) => setPriceBindingWire(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Rebar Fixing Target (kg/day)</span>
                <input 
                  type="number" value={dailyRebarTarget} 
                  onChange={(e) => setDailyRebarTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "roofing" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Roof Sheet ($/sqm)</span>
                <input 
                  type="number" value={priceRoofSheet} 
                  onChange={(e) => setPriceRoofSheet(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Roof Timber ($/m)</span>
                <input 
                  type="number" value={priceRoofTimber} 
                  onChange={(e) => setPriceRoofTimber(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Pitch Slope Multiplier</span>
                <input 
                  type="number" step="0.01" value={roofSlopeFactor} 
                  onChange={(e) => setRoofSlopeFactor(parseFloat(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Roofing Speed (sqm/day)</span>
                <input 
                  type="number" value={dailyRoofTarget} 
                  onChange={(e) => setDailyRoofTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {taskType === "ceiling" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Ceiling Board ($/sqm)</span>
                <input 
                  type="number" value={priceCeilingBoard} 
                  onChange={(e) => setPriceCeilingBoard(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate">Grid/Brander ($/m)</span>
                <input 
                  type="number" value={priceCeilingGrid} 
                  onChange={(e) => setPriceCeilingGrid(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
              <label className="col-span-2 block border-t border-ink-mid/30 pt-2">
                <span className="font-mono text-[8px] uppercase text-slate">Ceiling Speed (sqm/day)</span>
                <input 
                  type="number" value={dailyCeilingTarget} 
                  onChange={(e) => setDailyCeilingTarget(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono"
                />
              </label>
            </div>
          )}

          {/* Daily Labor Wage Settings */}
          <div className="bg-ink/40 p-3 border border-ink-mid/30 rounded-sm space-y-3">
            <h5 className="font-mono text-[8px] uppercase text-signal tracking-wide font-bold flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-signal" /> Direct Labor Wage Allocations
            </h5>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="font-mono text-[8px] uppercase text-slate font-bold">
                  {taskType === "excavation" || taskType === "concrete" ? "Laborer wage ($/day)" : "Skilled artisan ($/day)"}
                </span>
                <input 
                  type="number" value={skilledWage} 
                  onChange={(e) => setSkilledWage(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono focus:border-signal font-bold"
                />
              </label>
              
              {taskType !== "excavation" && taskType !== "concrete" && (
                <label className="block">
                  <span className="font-mono text-[8px] uppercase text-slate font-bold">Helper / Assis. ($/day)</span>
                  <input 
                    type="number" value={helperWage} 
                    onChange={(e) => setHelperWage(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-ink border border-ink-mid text-center text-white p-1 text-xs outline-none font-mono focus:border-signal font-bold"
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Yield and Logistics Output */}
        <div className="bg-ink-light/50 border border-ink-mid/60 p-4 rounded-sm space-y-3">
          <h4 className="text-[10px] font-mono text-white uppercase tracking-wider border-b border-ink-mid/30 pb-1 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-signal" /> Materials Yields &amp; Logistics
          </h4>
          <div className="space-y-2 text-xs font-mono text-slate-light">
            {calcs.materials.map((m, idx) => (
              <div key={idx} className="flex justify-between items-start">
                <div>
                  <span className="text-white font-semibold">{m.name}</span>
                  {m.note && <span className="block text-[8px] text-slate">{m.note}</span>}
                </div>
                <span className="text-white font-bold bg-ink px-1.5 py-0.5 rounded-sm border border-ink-mid/30 text-[10px]">
                  {(m.qty * basisQty).toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.unit}
                </span>
              </div>
            ))}
            <p className="text-[9px] text-signal font-bold leading-relaxed border-t border-ink-mid/20 pt-2 italic">
              {calcs.logisticsNote}
            </p>
          </div>
        </div>

        {/* Timeline Metrics */}
        <div className="bg-ink-light/50 border border-ink-mid/60 p-4 rounded-sm">
          <h4 className="text-[10px] font-mono text-white uppercase tracking-wider border-b border-ink-mid/30 pb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-signal" /> Project Time &amp; Duration
          </h4>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono text-center mt-2.5">
            <div className="bg-ink p-2 border border-ink-mid/30 rounded-sm">
              <span className="text-[7px] text-slate uppercase block">Est. Duration</span>
              <span className="text-sm text-white font-bold">{calcs.elapsedDays}</span>
              <span className="text-[7px] text-slate block mt-0.5">days (1 crew)</span>
            </div>
            <div className="bg-ink p-2 border border-ink-mid/30 rounded-sm">
              <span className="text-[7px] text-slate uppercase block">Total Labor</span>
              <span className="text-sm text-white font-bold">{calcs.laborDaysNeeded}</span>
              <span className="text-[7px] text-slate block mt-0.5">man-days</span>
            </div>
            <div className="bg-ink p-2 border border-ink-mid/30 rounded-sm">
              <span className="text-[7px] text-slate uppercase block">Equipment Cost</span>
              <span className="text-sm text-signal font-bold">${calcs.totalEquipmentCost.toFixed(2)}</span>
              <span className="text-[7px] text-slate block mt-0.5 font-bold">wages cost</span>
            </div>
          </div>
        </div>

        {/* INSTITUTIONAL NEGOTIATOR MATRIX */}
        <div className="border border-red-500/20 bg-red-950/10 p-4 rounded-sm space-y-4">
          <div className="flex justify-between items-center border-b border-red-500/20 pb-2">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <h4 className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-wider">
                Institutional Stance Matrix
              </h4>
            </div>
            <span className="text-[8px] bg-red-500/20 text-red-300 font-mono px-1 rounded-sm border border-red-500/30">RUTHLESS QS</span>
          </div>

          {/* Stance Choice Toggles */}
          <div className="grid grid-cols-3 gap-1 bg-ink/75 p-1 border border-ink-mid/40 rounded-sm font-mono text-[9px]">
            {(["fair", "aggressive", "mercenary"] as StanceType[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setActiveStance(s);
                  setCopied(false);
                }}
                className={`py-1.5 uppercase font-bold rounded-sm transition-all text-center flex flex-col items-center ${
                  activeStance === s 
                    ? "bg-red-600 text-white" 
                    : "text-slate hover:text-white"
                }`}
              >
                <span>{s}</span>
                <span className="text-[7px] opacity-75">${calcs.stances[s].rate.toFixed(2)}/u</span>
              </button>
            ))}
          </div>

          {/* Current Stance Breakdown Details */}
          <div className="bg-ink/50 p-3 border border-ink-mid/30 rounded-sm space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate">Recommended Labor Pay Rate:</span>
              <span className="text-white font-bold">${calcs.stances[activeStance].rate.toFixed(2)} / {lineItemUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Total Labor Contract Cap:</span>
              <span className="text-white font-bold">${calcs.stances[activeStance].total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Labor Risk Index:</span>
              <span className={`font-bold ${
                activeStance === "fair" ? "text-emerald-400" : activeStance === "aggressive" ? "text-yellow-400" : "text-red-400"
              }`}>{calcs.stances[activeStance].risk}</span>
            </div>
          </div>

          {/* Copyable script block */}
          <div className="relative group bg-ink-light/50 border border-ink-mid/40 p-3 rounded-sm text-[10px] font-mono leading-relaxed select-all text-slate-light">
            <button
              type="button"
              onClick={() => handleCopyScript(calcs.stances[activeStance].script)}
              className="absolute top-2 right-2 p-1 bg-ink border border-ink-mid/40 hover:border-signal text-slate hover:text-white rounded transition-all"
              title="Copy negotiation script"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-signal" />}
            </button>
            <p className="pr-6 font-semibold italic text-paper">
              {calcs.stances[activeStance].script}
            </p>
          </div>
        </div>

      </div>

      {/* Inject Bar */}
      <div className="pt-4 mt-4 border-t border-ink-mid flex justify-between gap-3 bg-ink/40 p-3 rounded-sm items-center">
        <div className="text-left font-mono">
          <span className="text-[8px] text-slate block uppercase">EST. DIRECT UNIT RATE</span>
          <span className="text-sm font-bold text-white">
            ${calcs.unitRate.toFixed(2)} <span className="text-xs text-slate">/{lineItemUnit}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={handleApplyToBuildup}
          className="bg-signal text-ink hover:bg-signal-hover transition-colors font-bold text-xs uppercase py-2.5 px-4 flex items-center justify-center gap-1.5 rounded-sm hover:scale-[1.01] active:scale-[0.99]"
        >
          <Hammer className="w-3.5 h-3.5" />
          Inject QS Buildup
        </button>
      </div>

    </div>
  );
}
