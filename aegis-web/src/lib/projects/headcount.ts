// One person, counted once, however many ways they are attached to a project:
// a permanent staff allocation, a delegated site role (PM, engineer, foreman)
// and/or a project-hire record. Each person contributes a set of identity
// keys (employee id, user id, national id, normalised name, email); two
// records that share any key are the same person.

type Rec = Record<string, any>;

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function keysOf(parts: Array<[string, unknown]>): string[] {
  return parts.map(([kind, value]) => [kind, norm(value)] as const).filter(([, v]) => v && v !== "hire").map(([k, v]) => `${k}:${v}`);
}

/** The project team feed mixes staff allocations with project hires; a hire has no employee_id. */
export function isProjectHireRow(member: Rec) {
  return member.employment_type === "project_hire" || (!member.employee_id && member.category_name === "Project Hire");
}

export function isActiveAllocation(member: Rec) {
  if (member.is_deleted) return false;
  if (typeof member.is_current === "boolean") return member.is_current;
  return member.status !== "ended";
}

export function uniqueHeadcount(groups: { permanent?: Rec[]; roles?: Rec[]; hires?: Rec[] }): number {
  const people: Set<string>[] = [];
  const add = (keys: string[], fallback: string) => {
    const ids = keys.length ? keys : [fallback];
    const matches = people.filter((p) => ids.some((k) => p.has(k)));
    if (!matches.length) {
      people.push(new Set(ids));
      return;
    }
    // merge everything this record links together into one person
    const [first, ...rest] = matches;
    ids.forEach((k) => first.add(k));
    for (const other of rest) {
      other.forEach((k) => first.add(k));
      people.splice(people.indexOf(other), 1);
    }
  };

  for (const m of groups.permanent ?? []) {
    add(keysOf([["emp", m.employee_id], ["user", m.user_id], ["name", m.employee_name], ["email", m.email]]), `alloc:${m.allocation_id ?? m.id}`);
  }
  for (const r of groups.roles ?? []) {
    add(keysOf([["user", r.user_id], ["emp", r.employee_id], ["name", r.full_name ?? r.user_name], ["email", r.email ?? r.user_email]]), `role:${r.id}`);
  }
  for (const h of groups.hires ?? []) {
    // Hires are matched by record and national ID only: two casual workers can share a name.
    add(keysOf([["hire", h.id ?? h.allocation_id], ["nid", h.national_id]]), `hire:${h.id}`);
  }
  return people.length;
}
