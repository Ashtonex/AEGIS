"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, ClipboardList, Lock, PackageSearch, RefreshCw } from "lucide-react";
import { completeWeeklyStoresCount, confirmWeeklyMaterialUsage, getWeeklyReconciliation } from "@/lib/api";
import { ApiRecord, Btn, Locked, Notice, Panel, Pill, dayLabel, errorText, num, qty, usd } from "./ui";

const keyOf = (r: ApiRecord) => `${r.store_id}|${r.item_id}`;

/** Saturday: confirm the week's material usage, then count the site stores. */
export function WeeklyReconTab({ projectId, projectName, onChanged }: { projectId: string; projectName: string; onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [unrecorded, setUnrecorded] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await getWeeklyReconciliation(projectId, week);
      setData(res.data ?? null);
      setUnrecorded({});
      setCounted({});
      setNotes({});
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "The weekly reconciliation could not be loaded.") });
    } finally {
      setLoading(false);
    }
  }, [projectId, week]);

  useEffect(() => { void load(); }, [load]);

  const snapshot: ApiRecord[] = useMemo(() => data?.snapshot ?? [], [data]);
  const recon = data?.reconciliation;
  const materialsDone = !!recon?.materials_completed_at;
  const completed = !!data?.completed;
  const savedUsage = (data?.lines ?? []).filter((l: ApiRecord) => l.kind === "material_usage");
  const savedCount = (data?.lines ?? []).filter((l: ApiRecord) => l.kind === "store_count");

  // After unrecorded usage is booked the books hold less: count against that.
  const expected = (r: ApiRecord) => num(r.system_qty) - (materialsDone ? 0 : num(unrecorded[keyOf(r)]));
  const toCount = snapshot.filter((r) => num(r.system_qty) !== 0 || num(r.received_qty) || num(r.issued_qty));
  const countedAll = toCount.every((r) => num(r.system_qty) === 0 || counted[keyOf(r)] !== undefined && counted[keyOf(r)] !== "");
  const variances = toCount.filter((r) => counted[keyOf(r)] !== undefined && counted[keyOf(r)] !== "" && num(counted[keyOf(r)]) !== num(r.system_qty));

  if (!projectId) return <Locked title="Choose a project" body="The weekly reconciliation is done per project." />;

  const confirmUsage = async () => {
    const extra = snapshot.filter((r) => num(unrecorded[keyOf(r)]) > 0);
    const msg = extra.length
      ? `Book ${extra.length} item(s) of usage that never made a daily report out of the site stores?`
      : "Confirm that every material used this week is on the daily reports?";
    if (!window.confirm(msg)) return;
    setBusy("usage");
    try {
      const res = await confirmWeeklyMaterialUsage({
        project_id: projectId,
        week_ending: data.week_ending,
        lines: extra.map((r) => ({ item_id: String(r.item_id), store_id: String(r.store_id), unrecorded_usage_qty: num(unrecorded[keyOf(r)]), notes: notes[keyOf(r)] || null })),
      });
      setNotice({ tone: "success", text: res?.message || "Material usage confirmed." });
      await load();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "The usage confirmation didn't save.") });
    } finally {
      setBusy(null);
    }
  };

  const completeCount = async () => {
    if (!countedAll) { setNotice({ tone: "error", text: "Enter a count for every item the books hold in the site stores (0 if none is left)." }); return; }
    const msg = variances.length
      ? `${variances.length} item(s) differ from the books. Post the differences as stock adjustments and close the week?`
      : "The count agrees with the books. Close the week?";
    if (!window.confirm(msg)) return;
    setBusy("count");
    try {
      const res = await completeWeeklyStoresCount({
        project_id: projectId,
        week_ending: data.week_ending,
        lines: toCount
          .filter((r) => counted[keyOf(r)] !== undefined && counted[keyOf(r)] !== "")
          .map((r) => ({ item_id: String(r.item_id), store_id: String(r.store_id), counted_qty: num(counted[keyOf(r)]), notes: notes[keyOf(r)] || null })),
      });
      setNotice({ tone: "success", text: res?.message || "Weekly reconciliation complete." });
      await load();
      onChanged?.();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "The stores count didn't save.") });
    } finally {
      setBusy(null);
    }
  };

  const fillBooks = () => setCounted(Object.fromEntries(toCount.map((r) => [keyOf(r), String(num(r.system_qty))])));

  return (
    <div className="space-y-4">
      {notice ? <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice> : null}

      <section className={`flex flex-wrap items-center justify-between gap-4 border p-4 ${completed ? "border-emerald-500/40 bg-emerald-950/20" : data?.blocking ? "border-red-500/50 bg-red-950/20" : "border-signal/40 bg-signal/5"}`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center ${completed ? "bg-emerald-500 text-ink" : "border border-signal/50 text-signal"}`}>
            {completed ? <CheckCircle2 className="h-5 w-5" /> : <CalendarCheck className="h-5 w-5" />}
          </span>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-slate-light">Weekly stores &amp; material recon · {projectName}</p>
            <p className="text-lg font-semibold text-paper">
              {data ? `Week ${dayLabel(data.week_start)} – ${dayLabel(data.week_ending)}` : "Loading…"}
            </p>
            <p className="text-xs text-slate-light">
              {completed ? `Completed ${recon?.completed_at ? new Date(recon.completed_at).toLocaleString() : ""}`
                : !data?.required ? (data && data.week_ending < data.enforced_from ? `Required from the week ending ${dayLabel(data.enforced_from)}.` : "No site days this week, so it isn't required. You can still do it.")
                : data?.blocking ? "Overdue: no new site day can be opened until this is done."
                : "Due today. The site day can't be closed until it's done."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={week ?? data?.week_ending ?? ""} onChange={(e) => setWeek(e.target.value || undefined)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" aria-label="Week">
            {data ? <option value={data.due_week_ending}>Due: week ending {dayLabel(data.due_week_ending)}</option> : null}
            {(data?.history ?? []).filter((h: ApiRecord) => String(h.week_ending) !== data?.due_week_ending).map((h: ApiRecord) => (
              <option key={String(h.week_ending)} value={String(h.week_ending)}>Week ending {dayLabel(String(h.week_ending))} · {h.status}</option>
            ))}
          </select>
          <Btn tone="ghost" icon={<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />} onClick={() => void load()}>Refresh</Btn>
        </div>
      </section>

      {data && !data.open ? <Notice tone="info">This week&apos;s reconciliation opens on Saturday.</Notice> : null}
      {data && data.store_ids?.length === 0 ? (
        <Notice tone="info">This project has no site store, so there is no stock to count. Confirming the step below records the week as reconciled.</Notice>
      ) : null}

      {/* Step 1: material usage */}
      <Panel step={1} done={materialsDone} title="Material usage this week"
        subtitle="Receipts into the site stores, issues out, and the usage recorded on the daily reports. If material was used but never recorded, enter it: it comes off the store now.">
        {materialsDone ? (
          <SavedUsage lines={savedUsage} by={recon?.materials_completed_by_name} at={recon?.materials_completed_at} />
        ) : snapshot.length === 0 ? (
          <p className="text-sm text-slate-light">{loading ? "Loading…" : "No stock movement in this project's site stores."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-mid font-mono uppercase text-slate">
                <tr>
                  <th className="px-3 py-2">Store</th><th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Issued out</th>
                  <th className="px-3 py-2 text-right">Used (daily reports)</th><th className="px-3 py-2 text-right">Books now</th>
                  <th className="px-3 py-2 text-center">Used, not recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/60">
                {snapshot.map((r) => (
                  <tr key={keyOf(r)}>
                    <td className="px-3 py-2 text-slate-light">{r.store_name}</td>
                    <td className="px-3 py-2"><p className="text-paper">{r.item_name}</p><p className="font-mono text-[10px] text-slate">{r.item_code} · {r.unit_of_measure}</p></td>
                    <td className="px-3 py-2 text-right font-mono">{qty(r.received_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono">{qty(r.issued_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono">{qty(r.recorded_usage_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono text-paper">{qty(r.system_qty)}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min="0" step="any" placeholder="0" value={unrecorded[keyOf(r)] ?? ""} disabled={!data?.open}
                        onChange={(e) => setUnrecorded({ ...unrecorded, [keyOf(r)]: e.target.value })}
                        className="h-8 w-24 border border-ink-mid bg-ink px-2 text-center font-mono text-xs text-paper focus:border-signal" aria-label={`Unrecorded use of ${r.item_name}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!materialsDone ? (
          <div className="mt-4 flex justify-end">
            <Btn busy={busy === "usage"} disabled={!data?.open || loading} icon={<ClipboardList className="h-4 w-4" />} onClick={() => void confirmUsage()}>Confirm the week&apos;s material usage</Btn>
          </div>
        ) : null}
      </Panel>

      {/* Step 2: stores count */}
      <Panel step={2} done={completed} title="Count the site stores"
        subtitle="Count what is physically in each site store and enter it. Differences from the books are posted as stock adjustments (loss or found stock) and the project manager is told.">
        {!materialsDone ? (
          <p className="flex items-center gap-2 text-sm text-slate-light"><Lock className="h-4 w-4" /> Confirm the week&apos;s material usage first.</p>
        ) : completed ? (
          <SavedCount lines={savedCount} by={recon?.stores_completed_by_name} at={recon?.stores_completed_at} />
        ) : toCount.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-light">Nothing in the site stores to count.</p>
            <div className="flex justify-end"><Btn busy={busy === "count"} onClick={() => void completeCount()}>Close the week</Btn></div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-light">
              <span>{toCount.filter((r) => counted[keyOf(r)] !== undefined && counted[keyOf(r)] !== "").length} of {toCount.length} counted · {variances.length} difference(s)</span>
              <button onClick={fillBooks} className="font-mono uppercase tracking-wider text-signal hover:underline">Start from the book figures</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-ink-mid font-mono uppercase text-slate">
                  <tr>
                    <th className="px-3 py-2">Store</th><th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2 text-right">Books</th><th className="px-3 py-2 text-center">Counted</th>
                    <th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2">Reason (if different)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/60">
                  {toCount.map((r) => {
                    const c = counted[keyOf(r)];
                    const diff = c === undefined || c === "" ? null : num(c) - expected(r);
                    return (
                      <tr key={keyOf(r)} className={diff ? "bg-amber-950/20" : ""}>
                        <td className="px-3 py-2 text-slate-light">{r.store_name}</td>
                        <td className="px-3 py-2 text-paper">{r.item_name} <span className="text-slate">({r.unit_of_measure})</span></td>
                        <td className="px-3 py-2 text-right font-mono">{qty(expected(r))}</td>
                        <td className="px-3 py-2 text-center">
                          <input type="number" min="0" step="any" value={c ?? ""} onChange={(e) => setCounted({ ...counted, [keyOf(r)]: e.target.value })}
                            className="h-8 w-24 border border-ink-mid bg-ink px-2 text-center font-mono text-xs text-paper focus:border-signal" aria-label={`Count of ${r.item_name}`} />
                        </td>
                        <td className={`px-3 py-2 text-right font-mono ${diff ? (diff < 0 ? "text-red-300" : "text-emerald-300") : "text-slate"}`}>
                          {diff === null ? "—" : `${diff > 0 ? "+" : ""}${qty(diff)} (${usd(diff * num(r.unit_cost), 2)})`}
                        </td>
                        <td className="px-3 py-2">
                          {diff ? <input value={notes[keyOf(r)] ?? ""} onChange={(e) => setNotes({ ...notes, [keyOf(r)]: e.target.value })} placeholder="Breakage, theft, miscount…" className="h-8 w-full min-w-40 border border-ink-mid bg-ink px-2 text-xs text-paper focus:border-signal" /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <Btn busy={busy === "count"} disabled={!countedAll} icon={<PackageSearch className="h-4 w-4" />} onClick={() => void completeCount()}>Post the count and close the week</Btn>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function SavedUsage({ lines, by, at }: { lines: ApiRecord[]; by?: string; at?: string }) {
  const booked = lines.filter((l) => num(l.unrecorded_usage_qty) > 0);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-emerald-300">Confirmed{by ? ` by ${by}` : ""}{at ? ` on ${new Date(at).toLocaleString()}` : ""}. {lines.length} item(s) reviewed.</p>
      {booked.length ? (
        <ul className="space-y-1 text-xs text-slate-light">
          {booked.map((l) => <li key={l.id}>{l.item_name} ({l.store_name}): {qty(l.unrecorded_usage_qty)} unrecorded use booked out</li>)}
        </ul>
      ) : <p className="text-xs text-slate-light">All usage was already on the daily reports.</p>}
    </div>
  );
}

function SavedCount({ lines, by, at }: { lines: ApiRecord[]; by?: string; at?: string }) {
  const diffs = lines.filter((l) => num(l.variance_qty) !== 0);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-emerald-300">Counted{by ? ` by ${by}` : ""}{at ? ` on ${new Date(at).toLocaleString()}` : ""}. {lines.length} item(s), {diffs.length} difference(s).</p>
      {diffs.length ? (
        <ul className="space-y-1 text-xs">
          {diffs.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-2">
              <span className="text-paper">{l.item_name}</span><span className="text-slate-light">{l.store_name}</span>
              <Pill tone={num(l.variance_qty) < 0 ? "red" : "green"}>{num(l.variance_qty) > 0 ? "+" : ""}{qty(l.variance_qty)}</Pill>
              {l.notes ? <span className="text-slate-light">{l.notes}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
