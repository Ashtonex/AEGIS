// SUPERADMIN is the one role granted system-wide access. This mirrors the
// backend's authoritative role resolution (core.user_roles) - the role
// claim is only ever set by the server, never derived from email or
// client-controlled state. Shared by RBACGuard and the dashboard sidebar
// so both gate access using the exact same rule.
export function matchesRole(userRole: string, allowedRoles: string[]): boolean {
  const normUser = userRole.toLowerCase().trim();

  if (normUser === "superadmin") {
    return true;
  }

  return allowedRoles.some((role) => role.toLowerCase().trim() === normUser);
}
