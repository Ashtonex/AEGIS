@AGENTS.md

# UI conventions (owner rule, 2026-11-11)

- **Base components: shadcn/ui.** Build dialogs, selects, dropdowns, popovers,
  tabs, tables, inputs, checkboxes, tooltips, sheets, alert-dialogs etc. from
  shadcn components in `src/components/ui/`, added with the shadcn CLI and
  themed to the DXL tokens (`ink`, `signal`, `paper`, `slate`, `void`). Do not
  hand-roll `fixed inset-0` modals, custom dropdowns, or new one-off primitives.
- **Toasts: Sonner.** Use `toast` from `sonner` (`toast.success`, `toast.error`,
  `toast.promise`, ...), one `<Toaster />` in the root layout. No per-page
  `showToast` state, no new toast providers, and no `window.alert` /
  `window.confirm` (use a shadcn `AlertDialog` for confirmations).
- When touching an existing screen that still uses the old pattern, move the
  part you touch over; don't add more of the old pattern.
- Already set up: `dialog`, `alert-dialog`, `select`, `dropdown-menu`, `input`,
  `table`, `sonner` (lowercase files in `src/components/ui/`). New shadcn
  components go in with the same lowercase names, restyled from shadcn's
  `background`/`foreground` classes to the DXL tokens (`components.json` has
  `cssVariables: false`; there are no shadcn CSS variables). Overlays use
  `bg-black/70`: alpha modifiers on the var()-based tokens render transparent.
- **Never `shadcn add button`, `card`, `badge` or `skeleton`.** The app's own
  `Button.tsx`, `Card.tsx`, `Badge.tsx`, `Skeleton.tsx` have custom APIs, and on
  Windows `button.tsx` overwrites `Button.tsx` (case-insensitive filesystem).
  Extend those files instead.
