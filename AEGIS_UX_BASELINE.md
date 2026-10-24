# AEGIS UX & Interface Standards Baseline

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  

---

## 1. Shell Navigation & State Persistence
1. **Persistent Accordion Memory**: User expansion of navigation modules must persist in `localStorage` (`aegis:nav:open-groups`) across browser refreshes and page transitions.
2. **Desktop Mini-Rail Availability**: High-density engineering and financial workspaces must provide a toggleable `w-16` icon rail mode, accessible via UI toggle and global keyboard shortcut `⌘B` / `Ctrl+B`, persisted to `localStorage` (`aegis:nav:sidebar-collapsed`).
3. **Mobile Drawer Context Preservation**: Nested navigation in the mobile slide-out drawer must not close the menu prematurely; dismissal occurs exclusively upon selecting a leaf link.

---

## 2. Layout Stability & Loading Skeletons
1. **Cumulative Layout Shift (CLS) Ceiling**: Cumulative Layout Shift must remain ≤ 0.1 across all primary routes.
2. **Geometric Skeleton Reservoirs**: Loading skeletons must match the exact dimensions and aspect ratio of loaded cards, metric badges, and data tables to prevent visual jumping upon data arrival.
3. **Full Viewport Width Utilization**: Data-dense tables (BOQs, project budgets, materials ledgers) must stretch to available viewport width rather than being constrained within narrow containers.

---

## 3. Error, Empty, and Offline States
1. **Actionable Empty States**: Empty views must present an honest, instructive message explaining why no records exist and providing a direct action (e.g. "Create First Requisition").
2. **Transparent Error Attribution**: System errors must surface clear explanations with a traceable reference ID (`Ref: <id>`) rather than generic "service unavailable" placeholders.
3. **Explicit Offline Boundaries**: PWA offline capabilities must clearly distinguish between cached reference data and pending local drafts. Offline writes to financial or stock ledgers are prohibited without an authorized conflict resolution model.
