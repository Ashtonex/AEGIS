"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { updateDiscoveryProfile, type DiscoveryProfile } from "@/lib/api/tender-discovery";
import { Panel, btn, errorMessage, fmtHarare, input } from "./shared";

const list = (value: string) => value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);

export function ProfileEditor({ profile, canConfigure, onSaved }: { profile: DiscoveryProfile; canConfigure: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<DiscoveryProfile>(profile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setDraft(profile), [profile]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateDiscoveryProfile(profile.id, {
        name: draft.name, description: draft.description, work_types: draft.work_types, category_terms: draft.category_terms,
        preferred_locations: draft.preferred_locations, nearby_locations: draft.nearby_locations,
        exclude_terms: draft.exclude_terms, scoring: draft.scoring,
      });
      setMessage(res.message || "Saved.");
      onSaved();
    } catch (err) {
      setMessage(errorMessage(err, "Profile was not saved."));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !canConfigure;
  return (
    <div className="space-y-3 text-xs">
      <Panel title="Profile" actions={canConfigure && <button className={btn.primary} onClick={save} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save profile</button>}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-slate-light">Name</span>
            <input className={input} value={draft.name} disabled={disabled} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <p className="self-end text-slate">Last updated {fmtHarare(profile.updated_at)}</p>
        </div>
        <label className="mt-2 block"><span className="mb-1 block text-slate-light">Description</span>
          <textarea className={input} rows={2} value={draft.description || ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <p className="mt-2 text-slate">Scores are transparent: each matching term adds the weight shown. A keyword match never means SNC is eligible - eligibility comes only from credentials configured in AEGIS.</p>
        {message && <p className="mt-2 text-sky-200">{message}</p>}
      </Panel>

      <Panel title="Work types">
        <div className="space-y-2">
          {draft.work_types.map((wt, i) => (
            <div key={wt.key} className="grid gap-2 rounded-sm border border-white/5 p-2 sm:grid-cols-[1fr,80px]">
              <input className={input} value={wt.label} disabled={disabled} onChange={(e) => { const next = [...draft.work_types]; next[i] = { ...wt, label: e.target.value }; setDraft({ ...draft, work_types: next }); }} />
              <input className={input} type="number" min={0} max={50} value={wt.weight} disabled={disabled} aria-label="Weight"
                     onChange={(e) => { const next = [...draft.work_types]; next[i] = { ...wt, weight: Number(e.target.value) }; setDraft({ ...draft, work_types: next }); }} />
              <textarea className={`${input} sm:col-span-2`} rows={2} value={wt.terms.join(", ")} disabled={disabled}
                        onChange={(e) => { const next = [...draft.work_types]; next[i] = { ...wt, terms: list(e.target.value) }; setDraft({ ...draft, work_types: next }); }} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Official e-GP procurement categories">
        <div className="space-y-2">
          {draft.category_terms.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr,90px,80px]">
              <input className={input} value={c.term} disabled={disabled} onChange={(e) => { const next = [...draft.category_terms]; next[i] = { ...c, term: e.target.value }; setDraft({ ...draft, category_terms: next }); }} />
              <input className={input} value={c.code || ""} placeholder="code" disabled={disabled} onChange={(e) => { const next = [...draft.category_terms]; next[i] = { ...c, code: e.target.value || null }; setDraft({ ...draft, category_terms: next }); }} />
              <input className={input} type="number" min={0} max={50} value={c.weight} disabled={disabled} onChange={(e) => { const next = [...draft.category_terms]; next[i] = { ...c, weight: Number(e.target.value) }; setDraft({ ...draft, category_terms: next }); }} />
            </div>
          ))}
          {canConfigure && <button className={btn.ghost} onClick={() => setDraft({ ...draft, category_terms: [...draft.category_terms, { term: "", code: null, weight: 10 }] })}>Add category</button>}
        </div>
      </Panel>

      <Panel title="Locations and exclusions">
        <label className="block"><span className="mb-1 block text-slate-light">Preferred (+{draft.scoring?.preferred_location_points ?? 20})</span>
          <textarea className={input} rows={2} value={draft.preferred_locations.join(", ")} disabled={disabled} onChange={(e) => setDraft({ ...draft, preferred_locations: list(e.target.value) })} /></label>
        <label className="mt-2 block"><span className="mb-1 block text-slate-light">Nearby (+{draft.scoring?.nearby_location_points ?? 10}) - everything else is kept for nationwide review</span>
          <textarea className={input} rows={2} value={draft.nearby_locations.join(", ")} disabled={disabled} onChange={(e) => setDraft({ ...draft, nearby_locations: list(e.target.value) })} /></label>
        <label className="mt-2 block"><span className="mb-1 block text-slate-light">Exclusions (term:penalty, one per line)</span>
          <textarea className={input} rows={4} disabled={disabled}
                    value={draft.exclude_terms.map((x) => `${x.term}:${x.penalty}`).join("\n")}
                    onChange={(e) => setDraft({ ...draft, exclude_terms: e.target.value.split("\n").map((line) => {
                      const [term, penalty] = line.split(":");
                      return { term: (term || "").trim(), penalty: Number(penalty) || 0 };
                    }).filter((x) => x.term) })} /></label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-slate-light">Strong from score</span>
            <input className={input} type="number" value={draft.scoring?.strong_at ?? 55} disabled={disabled} onChange={(e) => setDraft({ ...draft, scoring: { ...draft.scoring, strong_at: Number(e.target.value) } })} /></label>
          <label className="block"><span className="mb-1 block text-slate-light">Possible from score</span>
            <input className={input} type="number" value={draft.scoring?.possible_at ?? 30} disabled={disabled} onChange={(e) => setDraft({ ...draft, scoring: { ...draft.scoring, possible_at: Number(e.target.value) } })} /></label>
        </div>
      </Panel>
    </div>
  );
}
