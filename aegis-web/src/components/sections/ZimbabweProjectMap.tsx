"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation, Compass, Layers, ArrowUpRight, ShieldCheck, HardHat, Truck } from "lucide-react";
import Link from "next/link";
import { PROJECTS_DOSSIERS, ProjectDossier } from "@/lib/projectsDossiers";
import { cn, formatCurrency } from "@/lib/utils";

interface MapPinData {
  id: string;
  projectCode: string;
  title: string;
  province: string;
  category: string;
  x: number; // SVG % coordinate 0-100
  y: number; // SVG % coordinate 0-100
  dossierId: string;
}

const PROJECT_PINS: MapPinData[] = [
  {
    id: "pin-mm",
    projectCode: "SNC-MM-01",
    title: "Mega Market Industrial Flour Mill & Substation",
    province: "Manicaland",
    category: "Industrial Infrastructure",
    x: 82,
    y: 53,
    dossierId: "SNC-MEGA-MARKET",
  },
  {
    id: "pin-surrey",
    projectCode: "SNC-SRY-02",
    title: "Surrey Commercial Logistics & Cold-Chain Complex",
    province: "Mashonaland East",
    category: "Commercial Construction",
    x: 64,
    y: 38,
    dossierId: "SNC-SURREY",
  },
  {
    id: "pin-tb",
    projectCode: "SNC-TB-03",
    title: "Troutbeck Mountain Infrastructure & Reticulation",
    province: "Manicaland",
    category: "Civil Infrastructure",
    x: 86,
    y: 36,
    dossierId: "SNC-TROUTBECK",
  },
  {
    id: "pin-hc",
    projectCode: "SNC-HC-04",
    title: "Hillcrest Civil Terracing & Retention Works",
    province: "Manicaland",
    category: "Civil Infrastructure",
    x: 81,
    y: 56,
    dossierId: "SNC-HILLCREST",
  },
  {
    id: "pin-gd",
    projectCode: "SNC-GD-05",
    title: "Great Dyke Heavy Mining Haul Corridor",
    province: "Midlands",
    category: "Mining Infrastructure",
    x: 52,
    y: 54,
    dossierId: "SNC-GREAT-DYKE",
  },
  {
    id: "pin-forbes",
    projectCode: "SNC-FRB-06",
    title: "Forbes Border Post Strategic Freight Dualization",
    province: "Manicaland",
    category: "Civil Infrastructure",
    x: 85,
    y: 54,
    dossierId: "SNC-FORBES-CORRIDOR",
  },
  {
    id: "pin-tsf",
    projectCode: "SNC-ZVS-07",
    title: "Zvishavane Tailings Storage Facility (TSF)",
    province: "Midlands",
    category: "Earthworks & Grading",
    x: 54,
    y: 72,
    dossierId: "SNC-ZVISHAVANE-TSF",
  },
  {
    id: "pin-hre-depot",
    projectCode: "SNC-HQ-00",
    title: "SNC Central Plant Workshop & Operational HQ",
    province: "Harare",
    category: "Plant Operations",
    x: 58,
    y: 33,
    dossierId: "SNC-MEGA-MARKET",
  },
];

// Stylized polygon regions for Zimbabwe's 10 provinces in SVG viewBox 0 0 1000 800
const PROVINCE_PATHS: { id: string; name: string; path: string; labelX: number; labelY: number }[] = [
  {
    id: "mat-north",
    name: "Matabeleland North",
    path: "M 100 280 L 250 180 L 360 260 L 380 380 L 280 470 L 150 420 Z",
    labelX: 230,
    labelY: 310,
  },
  {
    id: "mash-west",
    name: "Mashonaland West",
    path: "M 250 180 L 480 90 L 530 200 L 460 340 L 360 260 Z",
    labelX: 410,
    labelY: 210,
  },
  {
    id: "mash-central",
    name: "Mashonaland Central",
    path: "M 480 90 L 640 100 L 620 220 L 530 200 Z",
    labelX: 560,
    labelY: 150,
  },
  {
    id: "harare",
    name: "Harare Metro",
    path: "M 550 240 L 600 240 L 600 280 L 550 280 Z",
    labelX: 575,
    labelY: 260,
  },
  {
    id: "mash-east",
    name: "Mashonaland East",
    path: "M 620 220 L 740 210 L 720 380 L 580 370 L 530 200 Z",
    labelX: 650,
    labelY: 290,
  },
  {
    id: "manicaland",
    name: "Manicaland",
    path: "M 740 210 L 880 250 L 920 480 L 800 600 L 720 380 Z",
    labelX: 810,
    labelY: 390,
  },
  {
    id: "midlands",
    name: "Midlands",
    path: "M 360 260 L 460 340 L 580 370 L 560 560 L 400 580 L 380 380 Z",
    labelX: 470,
    labelY: 440,
  },
  {
    id: "masvingo",
    name: "Masvingo",
    path: "M 580 370 L 720 380 L 800 600 L 660 740 L 560 560 Z",
    labelX: 670,
    labelY: 550,
  },
  {
    id: "bulawayo",
    name: "Bulawayo",
    path: "M 300 480 L 340 480 L 340 510 L 300 510 Z",
    labelX: 320,
    labelY: 495,
  },
  {
    id: "mat-south",
    name: "Matabeleland South",
    path: "M 280 470 L 400 580 L 560 560 L 660 740 L 460 780 L 310 650 Z",
    labelX: 430,
    labelY: 670,
  },
];

export function ZimbabweProjectMap() {
  const [selectedPinId, setSelectedPinId] = useState<string>("pin-mm");
  const [hoveredProvince, setHoveredProvince] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>("all");

  const selectedPin = PROJECT_PINS.find((p) => p.id === selectedPinId) || PROJECT_PINS[0];
  const activeDossier: ProjectDossier | undefined = PROJECTS_DOSSIERS.find(
    (d) => d.id === selectedPin.dossierId || d.slug === selectedPin.dossierId.toLowerCase()
  );

  const filteredPins = sectorFilter === "all"
    ? PROJECT_PINS
    : PROJECT_PINS.filter((p) => p.category.toLowerCase().includes(sectorFilter.toLowerCase()));

  return (
    <div className="bg-ink border border-ink-mid rounded-[4px] overflow-hidden text-paper">
      {/* Top Bar / Filter Controls */}
      <div className="p-6 md:px-8 border-b border-ink-mid flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-ink/95">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-signal animate-pulse" />
          <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-signal">
            National Operational Telemetry Grid
          </span>
          <span className="text-slate font-mono text-[11px] hidden sm:inline">
            · SADC Corridor ZW·EPSG:4326
          </span>
        </div>

        {/* Sector Filter Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All Sectors" },
            { id: "mining", label: "Mining" },
            { id: "civil", label: "Civil Infrastructure" },
            { id: "industrial", label: "Industrial & Commercial" },
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setSectorFilter(filter.id)}
              className={cn(
                "px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-[2px] transition-colors",
                sectorFilter === filter.id
                  ? "bg-signal text-ink font-bold"
                  : "bg-ink-mid text-slate hover:text-paper"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* Left Column: Interactive Vector SVG Map */}
        <div className="lg:col-span-8 p-6 md:p-10 relative flex items-center justify-center bg-void/60 select-none overflow-hidden">
          {/* Subtle Grid Overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(#243656_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

          {/* Compass Rose */}
          <div className="absolute top-6 left-6 flex items-center gap-2 font-mono text-[10px] text-slate/50">
            <Compass className="w-4 h-4 text-signal/70" />
            <span>N 19° 00′ · E 30° 00′</span>
          </div>

          <div className="relative w-full max-w-[720px] aspect-[10/8]">
            <svg
              viewBox="0 0 1000 800"
              className="w-full h-full filter drop-shadow-[0_10px_25px_rgba(0,0,0,0.5)]"
            >
              {/* Province Boundaries */}
              {PROVINCE_PATHS.map((province) => {
                const isHovered = hoveredProvince === province.name;
                const hasSelectedPin = selectedPin.province.toLowerCase() === province.name.toLowerCase();

                return (
                  <g key={province.id}>
                    <path
                      d={province.path}
                      onMouseEnter={() => setHoveredProvince(province.name)}
                      onMouseLeave={() => setHoveredProvince(null)}
                      className={cn(
                        "transition-all duration-300 cursor-pointer stroke-[1.5]",
                        hasSelectedPin
                          ? "fill-signal/15 stroke-signal"
                          : isHovered
                          ? "fill-ink-light stroke-slate/70"
                          : "fill-ink/90 stroke-ink-mid hover:fill-ink-mid/80"
                      )}
                    />
                    <text
                      x={province.labelX}
                      y={province.labelY}
                      textAnchor="middle"
                      className="font-mono text-[11px] fill-slate/60 pointer-events-none uppercase tracking-wider font-semibold"
                    >
                      {province.name}
                    </text>
                  </g>
                );
              })}

              {/* Major Highway Corridors Linking Harare to Mutare and Bulawayo */}
              <path
                d="M 320 495 L 470 440 L 575 260 L 650 290 L 810 390"
                fill="none"
                stroke="#F5A623"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-40"
              />
            </svg>

            {/* Radar Project Markers (Positioned via percentage) */}
            {filteredPins.map((pin) => {
              const isSelected = pin.id === selectedPinId;
              return (
                <div
                  key={pin.id}
                  style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
                >
                  <button
                    onClick={() => setSelectedPinId(pin.id)}
                    className="relative group focus:outline-none"
                    aria-label={pin.title}
                  >
                    {/* Animated Beacon Ripple */}
                    {isSelected && (
                      <span className="absolute -inset-2 rounded-full bg-signal/30 animate-ping" />
                    )}

                    {/* Central Radar Pin */}
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg",
                        isSelected
                          ? "bg-signal text-ink scale-125 ring-4 ring-signal/20"
                          : "bg-ink border-2 border-signal text-signal hover:scale-110 hover:bg-signal hover:text-ink"
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    </div>

                    {/* Pin Tooltip */}
                    <div className="absolute left-1/2 bottom-full -translate-x-1/2 mb-2 hidden group-hover:block z-30 whitespace-nowrap bg-ink-mid/95 backdrop-blur-md border border-ink-mid text-paper text-[11px] font-mono py-1 px-2.5 rounded shadow-xl">
                      <div className="text-signal font-bold">{pin.projectCode}</div>
                      <div>{pin.title}</div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="absolute bottom-6 left-6 flex items-center gap-6 font-mono text-[11px] text-slate bg-ink/80 backdrop-blur px-3 py-1.5 border border-ink-mid rounded">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-signal" />
              <span>Active Site Node</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-[2px] bg-signal/60 border-dashed" />
              <span>A3 / A5 Freight Corridor</span>
            </div>
          </div>
        </div>

        {/* Right Column: Operational Telemetry Inspector Drawer */}
        <div className="lg:col-span-4 bg-ink p-6 md:p-8 border-t lg:border-t-0 lg:border-l border-ink-mid flex flex-col justify-between">
          <div>
            {/* Header / ID Code */}
            <div className="flex items-center justify-between border-b border-ink-mid pb-4 mb-4">
              <div>
                <span className="text-signal font-mono text-[11px] uppercase tracking-[0.12em] font-bold">
                  {selectedPin.projectCode}
                </span>
                <span className="text-slate font-mono text-[11px] ml-2">· {selectedPin.province}</span>
              </div>
              <span className={cn(
                "px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border",
                activeDossier?.status === "Completed"
                  ? "text-[#2ECC71] border-[#2ECC71]/30 bg-[#2ECC71]/10"
                  : "text-signal border-signal/30 bg-signal/10"
              )}>
                {activeDossier?.status || "Active"}
              </span>
            </div>

            {/* Title */}
            <h4 className="font-bold text-[20px] text-paper leading-tight mb-2">
              {activeDossier?.title || selectedPin.title}
            </h4>
            <div className="text-slate-light text-[12px] font-mono mb-4">
              Client: <span className="text-paper font-semibold">{activeDossier?.client || "Industrial Client"}</span>
            </div>

            {/* Scope Summary */}
            <p className="text-[13px] text-slate leading-relaxed mb-6">
              {activeDossier?.description || "Heavy infrastructure engineering contract executed to national standards."}
            </p>

            {/* Engineering Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6 font-mono">
              <div className="bg-ink-light p-3 border border-ink-mid rounded">
                <span className="text-[10px] uppercase text-slate block mb-1">Earthworks Volume</span>
                <span className="text-[16px] font-bold text-signal">
                  {activeDossier?.earthworksVolumeM3 ? `${activeDossier.earthworksVolumeM3.toLocaleString()} m³` : "42,000 m³"}
                </span>
              </div>
              <div className="bg-ink-light p-3 border border-ink-mid rounded">
                <span className="text-[10px] uppercase text-slate block mb-1">Structural Concrete</span>
                <span className="text-[16px] font-bold text-paper">
                  {activeDossier?.concreteVolumeM3 ? `${activeDossier.concreteVolumeM3.toLocaleString()} m³` : "5,400 m³"}
                </span>
              </div>
              <div className="bg-ink-light p-3 border border-ink-mid rounded">
                <span className="text-[10px] uppercase text-slate block mb-1">Structural Steel</span>
                <span className="text-[16px] font-bold text-paper">
                  {activeDossier?.steelTonnage ? `${activeDossier.steelTonnage} Tonnes` : "420 T"}
                </span>
              </div>
              <div className="bg-ink-light p-3 border border-ink-mid rounded">
                <span className="text-[10px] uppercase text-slate block mb-1">Zero-Harm Record</span>
                <span className="text-[14px] font-bold text-[#2ECC71]">
                  {activeDossier?.hseRecord || "Zero LTI"}
                </span>
              </div>
            </div>

            {/* Heavy Plant Assets Deployed */}
            {activeDossier?.activePlant && activeDossier.activePlant.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-1.5 text-slate text-[11px] font-mono uppercase tracking-wider mb-2">
                  <Truck className="w-3.5 h-3.5 text-signal" />
                  <span>Fleet Units Mobilized</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeDossier.activePlant.slice(0, 4).map((plant, idx) => (
                    <span
                      key={idx}
                      className="bg-ink-mid text-slate-light text-[11px] font-mono px-2 py-1 rounded border border-ink-mid"
                    >
                      {plant}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Link to Full Case Study */}
          <div className="border-t border-ink-mid pt-4 mt-4">
            <Link
              href={`/projects/${activeDossier?.slug || selectedPin.dossierId.toLowerCase()}`}
              className="inline-flex items-center justify-between w-full bg-paper hover:bg-signal text-ink font-bold text-[12px] tracking-wider uppercase px-4 py-3 rounded transition-colors"
            >
              <span>Examine Technical Case Study</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
