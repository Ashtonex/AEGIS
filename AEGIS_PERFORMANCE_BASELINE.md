# AEGIS Performance Baseline & Latency Standards

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Reliability Engineer  

---

## 1. Network & Fan-Out Budgets
1. **Initial Mount Request Ceiling**: No dashboard page may execute more than three parallel HTTP requests on mount. Composite bundle endpoints (such as `GET /executive/overview-bundle`) must be used to combine related read models.
2. **Cross-Region RTT Optimization**: Because database servers in Western Europe and field operators in Zimbabwe experience ~200ms round-trip latency, sequential network waterfalls (`await req1; await req2;`) on client pages are strictly prohibited.
3. **Payload Truncation**: List endpoints returning unbounded datasets must enforce a hard upper limit (default 200, maximum 1000) using the `capped(...)` helper and return an `X-Results-Truncated: true` header when pagination is required.

---

## 2. Database Connection Management
1. **Minimal Connection Hold Time**: Database sessions must be acquired immediately before query execution and released immediately after. Network I/O, external HTTP calls, or file uploads must never occur while holding an active database connection.
2. **Safe Pool Sizing**: Connection pool parameters for Supavisor transaction pooler must remain within conservative boundaries (`pool_size=3, max_overflow=2, timeout=5.0s`) to prevent connection pool exhaustion during traffic spikes.
3. **Zero Single-Session Concurrency**: `asyncio.gather` must never be called on tasks sharing the same SQLAlchemy `AsyncSession`. Concurrent queries require independent sessions or sequential execution.
