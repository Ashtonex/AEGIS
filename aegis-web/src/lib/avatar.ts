export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Deterministic color per person (hashed from their id) so the same avatar
// reads the same way everywhere it appears, without storing a color per user.
const AVATAR_TONES = [
  "bg-signal/20 text-signal border-signal/40",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "bg-sky-500/20 text-sky-300 border-sky-500/40",
  "bg-violet-500/20 text-violet-300 border-violet-500/40",
  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "bg-rose-500/20 text-rose-300 border-rose-500/40",
];

export function avatarTone(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
