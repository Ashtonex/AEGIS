# AEGIS Data Truth & Operational Integrity Rules

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  

---

## 1. Absolute Truth in Enterprise Reporting
1. **Zero Fake Fallbacks**: Hardcoded sample data, dummy names, placeholder arrays, and synthetic metric constants must never be served in production or staging environments.
2. **Explicit Unknown vs. Zero**: Missing or unmeasured operational data must be reported as `null` or `UNKNOWN`. It is strictly forbidden to display `$0`, `0.0%`, or a sentinel number (e.g. `99.0` months) when data was simply never recorded.
3. **No Optimistic Deception**: UI buttons and action cards must not report success until the backend returns HTTP 200/201 with confirmed database commit. Mutated states must display a provisional "Pending Confirmation" indicator.

---

## 2. Derived Values & Forecasting Standards
1. **Documented Estimation Provenance**: Legitimate mathematical forecasts, linear projections, and derived estimates are permitted only when explicitly labelled as `[ESTIMATED]` or `[PROJECTED]`, accompanied by the underlying statistical basis (e.g. "Derived from 30-day moving average").
2. **Deterministic Financial Rounding**: All currency and tax calculations must use `Decimal` with standardized banker's rounding (`ROUND_HALF_UP` to 2 decimal places for money, 4 decimal places for unit costs). Floating-point math is strictly forbidden in financial pipelines.

---

## 3. Transparency for Staged Features
1. **Simulation Mode Labels**: Any visual workflow designer, AI copilot preview, or automated dispatch engine whose backend queue workers are not yet active must display an un-dismissible banner or badge: `[SIMULATION & STAGING MODE]`.
2. **Accurate Error States**: Network or upstream provider failures must not be swallowed into empty arrays. If the financial ledger or timesheet service fails, the affected UI card must render an error state stating that the source is unavailable.
