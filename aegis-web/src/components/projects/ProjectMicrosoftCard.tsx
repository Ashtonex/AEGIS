"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileSpreadsheet, FolderOpen, Loader2, MessagesSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getProjectWorkspace, syncProjectWorkspace, type ProjectWorkspaceState } from "@/lib/api/microsoft";

function when(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LinkTile({
  href,
  icon,
  label,
  detail,
}: {
  href: string | null | undefined;
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-paper">
        {icon}
        <span className="font-medium">{label}</span>
        {href && <ExternalLink className="ml-auto h-3.5 w-3.5 text-slate-light" />}
      </div>
      <p className="mt-1 text-[11px] text-slate-light">{detail}</p>
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block min-h-[64px] border border-ink-mid bg-ink-light/30 p-3 transition-colors hover:border-signal/50"
    >
      {body}
    </a>
  ) : (
    <div className="min-h-[64px] border border-ink-mid/60 bg-ink-light/10 p-3 opacity-70">{body}</div>
  );
}

/**
 * The project's Microsoft 365 workspace: its SharePoint folder (site photos
 * and dockets land there by day), its Teams channel and its Site Diary
 * workbook. Set up automatically when the project becomes active.
 */
export function ProjectMicrosoftCard({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ProjectWorkspaceState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getProjectWorkspace(projectId);
      if (res.success && res.data) setState(res.data);
    } catch {
      // No access to this, or the integration isn't there: leave the card out.
      setHidden(true);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !state || !state.enabled) return null;
  const ws = state.workspace;

  const syncNow = async () => {
    setSyncing(true);
    try {
      await syncProjectWorkspace(projectId);
      await load();
      toast.success("Microsoft 365 workspace updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Microsoft 365 could not be updated.");
    } finally {
      setSyncing(false);
    }
  };

  const channelDetail = !state.team_linked
    ? "No projects Team linked yet"
    : ws?.channel_status === "ready"
    ? `Channel ${ws.channel_name ?? ""}`.trim()
    : ws?.channel_status === "needs_permission"
    ? "Waiting for the Microsoft 365 admin to allow channel creation"
    : ws?.channel_status === "failed"
    ? "Channel could not be created; see the error below"
    : "Not created yet";

  return (
    <section className="border border-ink-mid bg-ink p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Microsoft 365 workspace</h2>
          <p className="mt-0.5 text-[11px] text-slate-light">
            {ws?.folders_ready_at
              ? `Site photos and dockets are copied here by day.${ws.diary_published_at ? ` Site Diary updated ${when(ws.diary_published_at)}.` : ""}`
              : "Set up automatically once the project is active."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncing}
          className="inline-flex min-h-[40px] items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync now
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <LinkTile
          href={ws?.folder_web_url}
          icon={<FolderOpen className="h-4 w-4 text-signal" />}
          label="Project folder"
          detail={ws?.folder_name ? `SharePoint · ${ws.folder_name}` : "Not created yet"}
        />
        <LinkTile
          href={ws?.channel_status === "ready" ? ws.channel_web_url : null}
          icon={<MessagesSquare className="h-4 w-4 text-signal" />}
          label="Teams channel"
          detail={channelDetail}
        />
        <LinkTile
          href={ws?.diary_web_url}
          icon={<FileSpreadsheet className="h-4 w-4 text-signal" />}
          label="Site Diary"
          detail={ws?.diary_web_url ? "One row per daily report" : "Published after the first sync"}
        />
      </div>
      {ws?.last_error && ws.channel_status !== "needs_permission" && (
        <p className="mt-2 text-[11px] text-warning">{ws.last_error}</p>
      )}
    </section>
  );
}
