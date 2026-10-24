# AEGIS Test Evidence Register

| Date | Scope | Test Command | Result | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 2026-10-17 | Backend Site Operations | `pytest tests/test_site_operations_unified_flow.py` | PASS (5/5) | Baseline site operations flow verified |
| 2026-10-17 | Backend Shell Contract | `pytest tests/test_system_shell_render_contract.py` | PASS (6/6) | Mini-rail, persistent accordion, and drawer verified |
| 2026-10-17 | Backend Notifications | `pytest tests/test_notifications_contract.py` | PASS (6/6) | Push and alert contracts verified |
| 2026-10-17 | Daily Site Report Slice | `pytest tests/test_daily_site_report_vertical_slice.py` | PASS (11/11) | Vertical slice daily report contract verified |
| 2026-10-17 | Full Backend Suite | `python -m pytest (4 suites, 28 tests)` | PASS (28/28 in 6.67s) | 100% pass across all affected test suites |
| 2026-10-17 | Frontend Typecheck | `npm run typecheck` | PASS (0 errors) | Full strict TypeScript compilation clean (including PlantTab, Materials & Inventory) |
| 2026-10-17 | Navigation Completeness | `npm run check:nav` | PASS (142 routes) | All 142 dashboard routes verified |
| 2026-10-17 | VAPID Key Generation | Python EC P-256 generation | PASS (87 chars) | Valid uncompressed base64url P-256 public key generated |
| 2026-10-17 | Plant & Heavy Machinery Outbox | Offline simulation & schema verification | PASS | Queues plant requests to outbox when disconnected |
| 2026-10-17 | Material Request Outbox | Offline simulation & schema verification | PASS | Queues material requisition to outbox when disconnected |
| 2026-10-17 | Inventory Adaptive Layout | Mobile viewport (< 768px) layout check | PASS | StockLevels, Catalogue, Stores render cards on mobile & tables on desktop |

---

## Field Pilot & Physical-Device Verification Protocol

### Test Environment Profile
- **Target OS**: Android (Chrome 120+) and iOS (Safari 17+ / Add to Home Screen PWA).
- **Network Profiles**:
  1. High-speed 4G/LTE (Harare Head Office baseline).
  2. Edge / 2G / Flaky 3G (Simulated site conditions: 1500ms RTT, 250kbps throughput, 5% packet loss).
  3. Total Offline (Airplane Mode engaged).

### Execution Checklist
1. **PWA Installation & Shell Render**:
   - Navigate to `/dashboard` on mobile browser.
   - Verify prompt "Add to Home Screen" or banner renders cleanly.
   - Install to Home Screen and launch in standalone window mode.
   - Verify viewport fills `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` without notch clipping.
2. **Offline Daily Site Report & Photo Evidence**:
   - Select site project and today's date.
   - Engage Airplane Mode on mobile device.
   - Fill Section 1 (Progress Notes, Hours worked) and Section 5 (Site Evidence & Delivery Dockets).
   - Capture photo with camera; verify client-side downscale to 1600px JPEG.
   - Submit report; verify notification: "Offline: Daily report saved to local outbox. It will synchronize automatically."
   - Verify status pill in top bar turns amber (`WifiOff`).
3. **Plant & Equipment Request Offline Queue**:
   - While still offline, navigate to Plant & Machinery tab.
   - Request "20-Ton Excavator", quantity 1, priority "High".
   - Submit; verify saved to local outbox notice.
4. **Reconnection & Flush Verification**:
   - Disable Airplane Mode.
   - Verify status pill transitions: `RefreshCw` (Syncing) -> `CheckCircle` (Synchronized).
   - Refresh page; verify Daily Report draft and Plant Request now exist on the authoritative backend server.
5. **Inventory Mobile Inspection**:
   - Navigate to `/dashboard/inventory/stock`.
   - Verify adaptive card view displays without horizontal overflow.
   - Verify low-stock warning indicators and reorder progress bars display legibly.

