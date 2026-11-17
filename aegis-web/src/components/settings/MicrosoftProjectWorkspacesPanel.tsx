"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, MessagesSquare, RefreshCw, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  getProjectWorkspacesOverview,
  syncProjectWorkspace,
  updateProjectWorkspaceSettings,
  type ProjectWorkspacesOverview,
} from "@/lib/api/microsoft";

const CHANNEL_LABEL: Record<string, string> = {
  ready: "Channel ready",
  needs_permission: "Waiting for admin permission",
  not_linked: "No Team linked",
  failed: "Channel failed",
};

/**
 * Settings > Configuration: switch project workspaces on/off, link the Team
 * that gets a channel per active project, and see what the Microsoft 365
 * admin still has to grant.
 */
export function MicrosoftProjectWorkspacesPanel() {
  const [data, setData] = useState<ProjectWorkspacesOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [teamLink, setTeamLink] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getProjectWorkspacesOverview();
      if (res.success && res.data) {
        setData(res.data);
        setTeamName(res.data.team_name ?? "");
      }
    } catch {
      setHidden(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !data) return null;

  const save = async (payload: { enabled?: boolean; team?: string; team_name?: string }, key: string) => {
    setBusy(key);
    try {
      await updateProjectWorkspaceSettings(payload);
      toast.success("Saved.");
      setTeamLink("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const syncOne = async (projectId: string) => {
    setBusy(`sync-${projectId}`);
    try {
      await syncProjectWorkspace(projectId);
      await load();
      toast.success("Project workspace updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the workspace.");
    } finally {
      setBusy(null);
    }
  };

  const missing = data.teams_permissions_missing;

  return (
    <section className="border border-ink-mid bg-ink p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper">
            <MessagesSquare className="h-4 w-4 text-signal" /> Projects in Microsoft 365
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-light">
            When a project becomes active AEGIS creates its folders in 03_PROJECTS, copies site photos and dockets
            into them by day, keeps a Site Diary workbook, and adds a channel for it in the linked Team.
          </p>
        </div>
        <button
          type="button"
          disabled={busy === "enabled" || (!data.enabled && !data.sharepoint_ready)}
          onClick={() => void save({ enabled: !data.enabled }, "enabled")}
          className={`min-h-[40px] border px-3 py-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-50 ${
            data.enabled ? "border-success/60 text-success" : "border-ink-mid text-slate-light"
          }`}
        >
          {data.enabled ? "On" : "Off"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase text-slate">Projects Team</p>
          <p className="text-sm text-paper">
            {data.team_id ? data.team_name || "Linked" : "Not linked yet"}
          </p>
          <input
            value={teamLink}
            onChange={(e) => setTeamLink(e.target.value)}
            placeholder="Paste the Team's link (Teams: … > Get link to team)"
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper placeholder:text-slate outline-none focus:border-signal"
          />
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name, e.g. SNC Projects"
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper placeholder:text-slate outline-none focus:border-signal"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!teamLink.trim() || busy === "team"}
              onClick={() => void save({ team: teamLink, team_name: teamName }, "team")}
              className="inline-flex min-h-[40px] items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase text-signal disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Link Team
            </button>
            {data.team_id && (
              <button
                type="button"
                disabled={busy === "unlink"}
                onClick={() => void save({ team: "" }, "unlink")}
                className="min-h-[40px] border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase text-slate-light hover:border-red-400 disabled:opacity-50"
              >
                Unlink
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase text-slate">Teams permissions for the AEGIS app</p>
          {data.permissions_error ? (
            <p className="text-xs text-warning">Could not read them: {data.permissions_error}</p>
          ) : (
            <ul className="space-y-1">
              {data.teams_permissions_needed.map((perm) => (
                <li key={perm} className="flex items-center gap-2 font-mono text-xs">
                  {missing.includes(perm) ? (
                    <XCircle className="h-3.5 w-3.5 text-warning" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  )}
                  <span className={missing.includes(perm) ? "text-warning" : "text-paper"}>{perm}</span>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <p className="text-[11px] leading-relaxed text-slate-light">
              A Microsoft 365 Global Admin adds these as Application permissions on the AEGIS app registration in
              Entra (API permissions &gt; Microsoft Graph) and grants admin consent. Folders, photo copies and the
              Site Diary already work without them.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate">
            <tr>
              <th className="p-2.5">Project</th>
              <th className="p-2.5">Folder</th>
              <th className="p-2.5">Teams</th>
              <th className="p-2.5">Site Diary</th>
              <th className="p-2.5 text-right">Files copied</th>
              <th className="p-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid/50">
            {data.projects.map((p) => (
              <tr key={p.project_id}>
                <td className="p-2.5">
                  <p className="text-paper">{p.project_code ? `${p.project_code} · ${p.name}` : p.name}</p>
                  {p.status !== "active" && <p className="font-mono text-[10px] uppercase text-slate">{p.status}</p>}
                  {p.last_error && p.channel_status !== "needs_permission" && (
                    <p className="mt-0.5 text-[10px] text-warning">{p.last_error}</p>
                  )}
                </td>
                <td className="p-2.5">
                  {p.folder_web_url ? (
                    <a href={p.folder_web_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-signal hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-slate">Pending</span>
                  )}
                </td>
                <td className="p-2.5">
                  {p.channel_status === "ready" && p.channel_web_url ? (
                    <a href={p.channel_web_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-signal hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-slate">{CHANNEL_LABEL[p.channel_status ?? ""] ?? "Pending"}</span>
                  )}
                </td>
                <td className="p-2.5">
                  {p.diary_web_url ? (
                    <a href={p.diary_web_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-signal hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-slate">Pending</span>
                  )}
                </td>
                <td className="p-2.5 text-right font-mono">
                  {p.files_copied}
                  {p.files_failed > 0 && <span className="ml-1 text-warning">({p.files_failed} failed)</span>}
                </td>
                <td className="p-2.5 text-right">
                  <button
                    type="button"
                    disabled={!data.enabled || busy === `sync-${p.project_id}`}
                    onClick={() => void syncOne(p.project_id)}
                    title="Set up / update now"
                    className="inline-flex h-8 w-8 items-center justify-center border border-ink-mid text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"
                  >
                    {busy === `sync-${p.project_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
            {data.projects.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-light">No active projects.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
