// This file used to be one 6,084-line, 694-export module (see the AEGIS
// Performance Audit, item 2.8 - "a tree-shaking hazard... imported
// everywhere"). It's now a barrel re-exporting the same names from
// per-domain modules under ./api/, so every existing `from "@/lib/api"`
// import keeps working unchanged while new code can import directly from
// the domain module it actually needs (e.g. `from "@/lib/api/crm"`).
export * from "./api/core";
export * from "./api/website";
export * from "./api/crm";
export * from "./api/procurement";
export * from "./api/fleet";
export * from "./api/finance";
export * from "./api/inventory";
export * from "./api/hr";
export * from "./api/compliance";
export * from "./api/documents";
export * from "./api/reports";
export * from "./api/quotations";
export * from "./api/banking";
export * from "./api/data-room";
