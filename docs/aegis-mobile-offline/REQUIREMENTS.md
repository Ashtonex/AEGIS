# AEGIS Mobile-First & Offline Operations — Requirements Register

**Organization**: Six Nine Construction (Private) Limited (SNC)  
**System**: Project AEGIS / Imperium Operations Platform  

---

| ID | Requirement Description | Modules | Target File / Area | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-PWA-01** | Fix push notifications configuration so VAPID subject & keys never fail to initialize | Backend & Frontend | `imperium-api/app/shared/pwa.py`, `core/config.py`, `PwaPushButton.tsx` | Pytest / API curl / UI Test | VERIFIED |
| **REQ-SHELL-01** | Role-aware mobile navigation dock (Thumb zone at bottom on screens < 768px) | Navigation Shell | `DashboardShell.tsx`, `ExecutiveNav.tsx` | Automated render test & Visual check | VERIFIED |
| **REQ-SHELL-02** | Viewport safe-area inset compliance and dynamic viewport units (`dvh`, `env(safe-area)`) | Core Layout | `layout.tsx`, `globals.css` | CSS audit & mobile layout check | VERIFIED |
| **REQ-DATA-01** | Adaptive data views (Table to Card transformation on screens < 768px) | Core UI & Modules | `OperationalTable.tsx`, `site-operations` | Component contract tests | VERIFIED |
| **REQ-OFFLINE-01** | IndexedDB local persistence for drafts, reference snapshots, and submission outbox | Client Offline Core | `src/lib/offline/db.ts`, `src/lib/offline/sync.ts` | Unit / Storage test | VERIFIED |
| **REQ-SYNC-01** | At-least-once delivery with idempotent backend processing (`operation_id`) | Client & Backend API | `src/lib/offline/sync.ts`, `routers/site_reports.py` | Contract idempotency tests | VERIFIED |
| **REQ-SLICE-01** | End-to-end vertical slice: Site Daily Report offline creation, photo attach, sync & recovery | Site Operations | `site-operations/page.tsx`, `ActiveDailyReport.tsx` | Integration test & Recovery test | VERIFIED |
| **REQ-INPUT-01** | Field ergonomics: 48x48px touch targets, numeric keypads (`inputMode="decimal"`), camera capture | Form System | `FormField.tsx`, `Button.tsx` | Component audit | VERIFIED |
| **REQ-SEC-01** | Identity boundary & tenant isolation: multi-tenant partitioned storage, no cross-user queue bleed | Security & Auth | `src/lib/offline/db.ts` | Isolation contract test | VERIFIED |
| **REQ-REL-01** | Network reachability detection, sync queue state machine, retry backoff with jitter | Client Sync Engine | `src/lib/offline/sync.ts` | Network simulation tests | VERIFIED |
| **REQ-ROLL-01** | Service worker update safety: never purge pending drafts during SW update or cache invalidation | PWA & Service Worker | `sw.js`, `PwaRegistration.tsx` | Cache test | VERIFIED |
