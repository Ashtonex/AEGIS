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

// A user can hold several roles; access is granted if ANY of them matches.
export function matchesAnyRole(userRoles: string[], allowedRoles: string[]): boolean {
  return userRoles.some((userRole) => matchesRole(userRole, allowedRoles));
}

// The roles that actually decide what a user sees. EMPLOYEE is the baseline
// every account gets on auto-provisioning, so it only counts when the user
// holds nothing else - same precedence the backend uses for the primary role.
export function effectiveRoles(roles: string[] | null | undefined, primaryRole: string | null): string[] {
  const all = (roles ?? []).filter(Boolean);
  const specific = all.filter((role) => role.toUpperCase() !== "EMPLOYEE");
  if (specific.length > 0) return specific;
  if (all.length > 0) return all;
  return primaryRole ? [primaryRole] : [];
}
