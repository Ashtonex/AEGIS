# AEGIS UX & Shell Reliability Register

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  
**UX Mandate**: Resilient navigation, zero layout jumping, persistent operator preferences, and robust field performance on rugged site devices.

---

## 1. Executive Summary

This register audits the user experience, shell state management, navigation ergonomics, and layout stability of the `aegis-web` Next.js frontend across desktop, tablet, and mobile form factors.

---

## 2. UX Issue Register

### UX-001: Ephemeral In-Memory Sidebar State Resets on Navigation
- **Page/component**: `aegis-web/src/app/dashboard/DashboardShell.tsx:51`
- **Current behaviour**: When a user expanded navigation groups (e.g. "Supply Chain & Site Stores"), refreshing the browser or navigating between certain pages caused `openGroups` to wipe back to initial defaults, forcing repetitive clicking.
- **Expected behaviour**: Expanded/collapsed accordion group states must persist seamlessly across reloads and route transitions.
- **Root cause**: `openGroups` state was stored purely in React local memory (`useState<string[]>([])`) without synchronization to `localStorage`.
- **Proposed fix**: Initialize `openGroups` from `localStorage.getItem("aegis:nav:open-groups")`, synchronize on toggle, and keep active route's parent section auto-expanded without wiping user preferences.
- **Files to change**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Accessibility impact**: Positive (Reduces repetitive keyboard and screen reader navigation).
- **Mobile impact**: Independent (Mobile uses drawer overlay).
- **Tests required**: `test_system_shell_render_contract.py`, `npm run check:nav`
- **Status**: VERIFIED FIXED

---

### UX-002: Missing Desktop Sidebar Collapse Mode Squeezes Wide Tables
- **Page/component**: `aegis-web/src/app/dashboard/DashboardShell.tsx:535`
- **Current behaviour**: Sidebar was permanently locked at `w-56` (224px), depriving data-dense operational tables (Procurement Ledgers, BOQs, Project Budgets, Cash Curves) of horizontal display width.
- **Expected behaviour**: Users should be able to collapse the sidebar into a compact `w-16` icon rail with tooltips, recovering 160px of horizontal workspace.
- **Root cause**: Hardcoded desktop layout geometry without mini-rail state or collapse toggle control.
- **Proposed fix**: Introduce `isCollapsed` state persisted to `localStorage` (`aegis:nav:sidebar-collapsed`), add a toggle button in the sidebar footer, and bind global keyboard shortcut `⌘B` / `Ctrl+B`.
- **Files to change**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Accessibility impact**: Fully accessible via keyboard shortcut and ARIA toggle button.
- **Mobile impact**: Desktop-only enhancement (Mobile uses slide-out drawer).
- **Tests required**: `test_system_shell_render_contract.py`
- **Status**: VERIFIED FIXED

---

### UX-003: Mobile Drawer Auto-Closes Prematurely on Sub-Branch Navigation
- **Page/component**: `aegis-web/src/app/dashboard/DashboardShell.tsx:178`
- **Current behaviour**: Opening a submenu branch inside the mobile navigation drawer immediately triggered a route listener that shut the drawer, disorienting site engineers.
- **Expected behaviour**: Mobile drawer stays open during nested accordion exploration and closes exclusively upon leaf link selection.
- **Root cause**: `useEffect` listening to `pathname` closed the mobile menu indiscriminately whenever route transitions occurred.
- **Proposed fix**: Differentiate accordion expansion clicks from leaf link selections; close drawer only when a leaf navigation item is tapped.
- **Files to change**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Accessibility impact**: Prevents focus loss during touch navigation.
- **Mobile impact**: Dramatic usability improvement for field personnel on smartphones.
- **Tests required**: Mobile touch simulation and layout contract verification.
- **Status**: VERIFIED FIXED

---

### UX-004: Onboarding Tour Re-Triggering on Cold Page Loads
- **Page/component**: `aegis-web/src/app/dashboard/DashboardShell.tsx:215-221`
- **Current behaviour**: New user introductory walkthrough tour re-triggered intermittently after completing onboarding if network latency delayed user profile retrieval.
- **Expected behaviour**: Tour is presented once upon initial account provisioning and never re-triggers after dismissal.
- **Root cause**: Profile fetch race condition where `user.has_completed_tour` temporarily evaluated to `false` before auth profile rehydration settled.
- **Proposed fix**: Cache tour completion token in `localStorage` (`aegis:onboarding:completed`) immediately upon dismissal; check both local cache and backend profile before launching.
- **Files to change**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Accessibility impact**: Eliminates modal dialog trap for return users.
- **Mobile impact**: Prevents screen takeover on small mobile viewports.
- **Tests required**: Layout contract checks.
- **Status**: VERIFIED FIXED

---

## 3. UX Reliability Standards
1. **Screen Real Estate Optimization**: High-density engineering and financial tables must take full advantage of available viewport width.
2. **Deterministic Navigation Memory**: The application must remember how the operator arranged their workspace across browser sessions.
3. **No Layout Shift on Load**: All dashboard cards and metric widgets must utilize fixed aspect ratio skeletons to prevent Cumulative Layout Shift (CLS < 0.1).
