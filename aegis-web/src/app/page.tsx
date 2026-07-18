/**
 * SNC Gateway — Home Page
 * ─────────────────────────────────────────────────────────────────────────────
 * Sequence reel: 01 Arrival → 02 Evidence → 03 Capability → 04 Infrastructure
 *                → 05 Operations → 06 Portal → 07 Relationship
 *
 * Architecture rules:
 *   - Each Sequence is its own isolated component
 *   - Living Architecture surfaces (live data) load independently
 *   - No sequence shares a layout pattern with an adjacent one
 */

import { constructMetadata } from "@/lib/metadata";
import { ArrivalSequence } from "@/components/sequences/ArrivalSequence";
import { EvidenceSequence } from "@/components/sequences/EvidenceSequence";
import { CapabilitySequence } from "@/components/sequences/CapabilitySequence";
import { InfrastructureSequence } from "@/components/sequences/InfrastructureSequence";
import { OperationsSequence } from "@/components/sequences/OperationsSequence";
import { PortalSequence } from "@/components/sequences/PortalSequence";
import { RelationshipSequence } from "@/components/sequences/RelationshipSequence";

// ── Sequences 02–07 are built one at a time with directorial review ──────────
// All sequences now render directly; keep polish work focused on copy,
// motion timing, and visual consistency across the public reel.

export const metadata = constructMetadata({
  title: "Six Nine Construction | Infrastructure Built to Last",
  description:
    "Civil engineering, structural construction, and plant logistics at national scale. On time, on budget, without compromise.",
  image: "/arrival-01.jpg",
});

export default function GatewayPage() {
  return (
    <main id="main-content">
      {/* ── Sequence 01: Arrival ───────────────────────────────────────────── */}
      {/* Objective: institutional confidence within 4 seconds */}
      <ArrivalSequence />

      {/* ── Sequence 02: Evidence ─────────────────────────────────────────── */}
      {/* Objective: prove the confidence was earned — massive numbers, no cards */}
      <EvidenceSequence />

      {/* ── Sequences 03–07: Built sequentially, pausing for directorial review */}
      {/* ── Sequence 03: Capability ───────────────────────────────────────── */}
      {/* Objective: demonstrate range without listing services like a menu */}
      <CapabilitySequence />

      {/* ── Sequence 04: Infrastructure ───────────────────────────────────── */}
      {/* Objective: proof through scale — edge-to-edge interactive project wall */}
      <InfrastructureSequence />

      {/* ── Sequence 05: Operations ────────────────────────────────────── */}
      {/* Objective: show the company in motion, historically and physically */}
      <OperationsSequence />

      {/* ── Sequence 06: Portal ────────────────────────────────────────── */}
      {/* Objective: Show the portal login as an operational control panel */}
      <PortalSequence />

      {/* ── Sequence 07: Relationship ──────────────────────────────────── */}
      {/* Objective: Return to daylight. Unsentimental, direct contact spec. */}
      <RelationshipSequence />
    </main>
  );
}
