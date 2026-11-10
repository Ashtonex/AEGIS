"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  BookCopy,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Plus,
  QrCode,
  Search,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { getErrorMessage } from "@/lib/api/core";
import {
  changeStationeryBookStatus,
  downloadStationeryBookPdf,
  downloadStationerySpecimen,
  fetchStationeryBook,
  fetchStationeryBooks,
  fetchStationeryTypes,
  generateStationeryBooks,
  lookupStationeryLeaf,
  voidStationeryLeaf,
  type StationeryBook,
  type StationeryBookAction,
  type StationeryBookType,
  type StationeryLeaf,
  type StationeryLeafLookup,
} from "@/lib/api/stationery";

const PAGE = 100;
const SIZE_LABEL: Record<string, string> = { A4: "A4", A5: "A5", A5L: "A5 landscape" };
const COPY_LABEL: Record<number, string> = { 1: "Original only", 2: "Duplicate", 3: "Triplicate" };
const STATUS_STYLE: Record<string, string> = {
  generated: "border-slate/40 text-slate-light",
  printed: "border-sky-500/40 text-sky-300",
  issued: "border-emerald-500/40 text-emerald-300",
  completed: "border-slate/40 text-slate",
  lost: "border-red-500/50 text-red-300",
  cancelled: "border-red-500/30 text-red-300/70",
  blank: "border-slate/40 text-slate-light",
  captured: "border-amber-500/40 text-amber-300",
  approved: "border-emerald-500/40 text-emerald-300",
  voided: "border-red-500/40 text-red-300",
  spoiled: "border-red-500/40 text-red-300",
};

function Pill({ value }: { value: string }) {
  return (
    <span className={`inline-block border px-2 py-0.5 font-mono text-[11px] uppercase ${STATUS_STYLE[value] || "border-slate/40 text-slate-light"}`}>
      {value}
    </span>
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Dialog =
  | { kind: "generate"; type: StationeryBookType }
  | { kind: "issue" | "lost" | "cancelled"; book: StationeryBook }
  | { kind: "void"; book: StationeryBook; leaf: StationeryLeaf };

export function StationeryBooksPanel() {
  const searchParams = useSearchParams();
  const { permissions, isSuperAdmin } = useAuth();
  const canManage = isSuperAdmin || Boolean(permissions?.has("finance.stationery.manage"));

  const [types, setTypes] = useState<StationeryBookType[]>([]);
  const [books, setBooks] = useState<StationeryBook[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<Record<string, StationeryLeaf[]>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState(searchParams?.get("q") || "");
  const [found, setFound] = useState<StationeryLeafLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const typeByKey = useMemo(() => Object.fromEntries(types.map((t) => [t.key, t])), [types]);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetchStationeryBooks({ book_type: typeFilter || undefined, status: statusFilter || undefined, limit: PAGE });
      setBooks(res.data || []);
      setTotal(res.meta?.total ?? (res.data || []).length);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    fetchStationeryTypes()
      .then((res) => !cancelled && setTypes(res.data || []))
      .catch((err) => !cancelled && setError(getErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    loadBooks().finally(() => setLoading(false));
  }, [loadBooks]);

  const runLookup = useCallback(async (value: string) => {
    if (value.trim().length < 3) return;
    setLookupError(null);
    setFound(null);
    try {
      const res = await lookupStationeryLeaf(value.trim());
      setFound(res.data ?? null);
    } catch (err) {
      setLookupError(getErrorMessage(err));
    }
  }, []);

  const initialQuery = searchParams?.get("q") ?? null;
  useEffect(() => {
    if (initialQuery) runLookup(initialQuery);
  }, [initialQuery, runLookup]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetchStationeryBooks({
        book_type: typeFilter || undefined,
        status: statusFilter || undefined,
        limit: PAGE,
        offset: books.length,
      });
      setBooks((prev) => [...prev, ...(res.data || [])]);
      if (typeof res.meta?.total === "number") setTotal(res.meta.total);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleLeaves(book: StationeryBook) {
    if (expanded === book.id) {
      setExpanded(null);
      return;
    }
    setExpanded(book.id);
    try {
      const res = await fetchStationeryBook(book.id);
      setLeaves((prev) => ({ ...prev, [book.id]: res.data?.leaves || [] }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function downloadBook(book: StationeryBook) {
    setBusy(`pdf:${book.id}`);
    setError(null);
    try {
      const blob = await downloadStationeryBookPdf(book.id);
      saveBlob(blob, `${book.book_label.replace(/\s+/g, "-")}_${book.first_label}-${book.last_label}.pdf`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadSpecimen(type: StationeryBookType, size?: string) {
    setBusy(`spec:${type.key}:${size || ""}`);
    setError(null);
    try {
      const blob = await downloadStationerySpecimen(type.key, size);
      saveBlob(blob, `SPECIMEN_${type.prefix}_${size || type.page_size}.pdf`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(book: StationeryBook, action: StationeryBookAction, extra: Record<string, string> = {}) {
    setBusy(`status:${book.id}`);
    setError(null);
    try {
      const res = await changeStationeryBookStatus(book.id, { action, ...extra });
      if (res.data) setNotice(`${res.data.book_label} is now ${res.data.status}.`);
      setDialog(null);
      await loadBooks();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const finance = types.filter((t) => t.holder_group === "finance");
  const frontDesk = types.filter((t) => t.holder_group === "front_desk");

  return (
    <div className="space-y-6">
      <div className="border border-ink-mid bg-ink p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal font-bold">
            AEGIS registered stationery
          </span>
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-paper">Stationery Books</h1>
        <p className="text-sm text-slate-light max-w-3xl">
          Print-ready books for Finance and the Front Desk. Every leaf has its own serial number and QR code: anyone who
          scans it learns whether it is a genuine SNC form and whether it has been recorded and approved in AEGIS. Generate
          books here, send the PDF to the printer, then issue each printed book to the person who will keep it.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Find a leaf */}
      <div className="border border-ink-mid bg-ink p-4 space-y-3">
        <div className="flex items-center gap-2 text-paper font-semibold"><QrCode className="h-4 w-4 text-signal" /> Find a form</div>
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runLookup(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Serial number (PV-000123), QR code or scanned link"
            className="flex-1 bg-void border border-ink-mid px-3 py-2 text-sm text-paper font-mono"
          />
          <button type="submit" className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-signal text-void text-sm font-bold">
            <Search className="h-4 w-4" /> Look up
          </button>
        </form>
        {lookupError && <p className="text-sm text-red-300">{lookupError}</p>}
        {found && (
          <div className="grid gap-2 sm:grid-cols-4 text-sm border border-ink-mid p-3">
            <div><div className="text-xs text-slate uppercase">Serial</div><div className="font-mono text-signal">{found.serial_label}</div></div>
            <div><div className="text-xs text-slate uppercase">Leaf</div><Pill value={found.status} /></div>
            <div><div className="text-xs text-slate uppercase">Book</div><div className="text-paper">{found.book_label} · leaf {found.leaf_index}</div><Pill value={found.book_status} /></div>
            <div><div className="text-xs text-slate uppercase">Kept by</div><div className="text-paper">{[found.issued_to_name, found.issued_department].filter(Boolean).join(" · ") || "Not issued"}</div><div className="text-xs text-slate">Scanned {found.scan_count}×</div></div>
            <p className="sm:col-span-4 text-xs text-slate-light">
              Capturing the details on this form (amount, payee, project and cost code) and the Finance / Commercial / MD
              approvals come in the next release; for now the register shows where every leaf is.
            </p>
          </div>
        )}
      </div>

      {/* Book types */}
      {[{ title: "Finance books", list: finance }, { title: "Front Desk books", list: frontDesk }].map(({ title, list }) => (
        <div key={title} className="space-y-3">
          <h2 className="text-paper text-lg font-semibold">{title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {list.map((t) => (
              <div key={t.key} className="border border-ink-mid bg-ink p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-paper">{t.book_title}</div>
                  <span className="font-mono text-xs text-signal">{t.prefix}-</span>
                </div>
                <p className="text-xs text-slate-light flex-1">{t.description}</p>
                <div className="text-xs text-slate">
                  {SIZE_LABEL[t.page_size]} · {t.default_leaves} {t.leaf_word === "page" ? "pages" : "leaves"} · {COPY_LABEL[t.default_copies]}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {t.allowed_sizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => downloadSpecimen(t, size)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 text-xs text-slate-light hover:text-paper disabled:opacity-50"
                    >
                      {busy === `spec:${t.key}:${size}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      Specimen {SIZE_LABEL[size]}
                    </button>
                  ))}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "generate", type: t })}
                      className="inline-flex items-center gap-1 bg-signal/15 border border-signal/40 px-2 py-1 text-xs font-bold text-signal"
                    >
                      <Plus className="h-3.5 w-3.5" /> Generate books
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Register */}
      <div className="border border-ink-mid bg-ink">
        <div className="px-4 py-3 border-b border-ink-mid flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-paper font-semibold"><BookCopy className="h-4 w-4 text-signal" /> Book register</div>
          <div className="flex flex-wrap gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-void border border-ink-mid px-2 py-1 text-sm text-paper">
              <option value="">All books</option>
              {types.map((t) => <option key={t.key} value={t.key}>{t.book_title}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-void border border-ink-mid px-2 py-1 text-sm text-paper">
              <option value="">Any status</option>
              {["generated", "printed", "issued", "completed", "lost", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate border-b border-ink-mid">
                <th className="p-3"></th>
                <th className="p-3">Book</th>
                <th className="p-3">Serials</th>
                <th className="p-3">Format</th>
                <th className="p-3">Status</th>
                <th className="p-3">Kept by</th>
                <th className="p-3">Leaves</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="p-6 text-center text-slate"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
              )}
              {!loading && books.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-slate">No books yet. Generate a batch from a book type above.</td></tr>
              )}
              {!loading && books.map((b) => (
                <BookRow
                  key={b.id}
                  book={b}
                  type={typeByKey[b.book_type]}
                  open={expanded === b.id}
                  leaves={leaves[b.id]}
                  busy={busy}
                  canManage={canManage}
                  onToggle={() => toggleLeaves(b)}
                  onDownload={() => downloadBook(b)}
                  onAction={(action) => {
                    if (action === "printed" || action === "completed") changeStatus(b, action);
                    else setDialog({ kind: action, book: b });
                  }}
                  onVoid={(leaf) => setDialog({ kind: "void", book: b, leaf })}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && books.length > 0 && (
          <div className="px-4 py-3 border-t border-ink-mid flex items-center justify-between text-xs text-slate">
            <span>Showing {books.length} of {total} books</span>
            {books.length < total && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1 border border-ink-mid px-3 py-1 text-slate-light hover:text-paper disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show more
              </button>
            )}
          </div>
        )}
      </div>

      {dialog && (
        <DialogBox
          dialog={dialog}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onGenerate={async (payload) => {
            setBusy("generate");
            setError(null);
            try {
              const res = await generateStationeryBooks(payload);
              const made = res.data?.books ?? [];
              if (made.length) setNotice(`${made.length} book${made.length === 1 ? "" : "s"} registered: ${made[0].first_label} to ${made[made.length - 1].last_label}. Download each PDF from the register for printing.`);
              setDialog(null);
              await loadBooks();
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setBusy(null);
            }
          }}
          onStatus={(book, action, extra) => changeStatus(book, action, extra)}
          onVoid={async (book, leaf, reason, spoiled) => {
            setBusy("void");
            setError(null);
            try {
              await voidStationeryLeaf(leaf.id, reason, spoiled);
              setNotice(`${leaf.serial_label} voided.`);
              setDialog(null);
              const res = await fetchStationeryBook(book.id);
              setLeaves((prev) => ({ ...prev, [book.id]: res.data?.leaves || [] }));
              await loadBooks();
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </div>
  );
}

function BookRow(props: {
  book: StationeryBook;
  type?: StationeryBookType;
  open: boolean;
  leaves?: StationeryLeaf[];
  busy: string | null;
  canManage: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onAction: (action: StationeryBookAction) => void;
  onVoid: (leaf: StationeryLeaf) => void;
}) {
  const { book: b, open, leaves, busy, canManage } = props;
  const actions: { action: StationeryBookAction; label: string; when: string[] }[] = [
    { action: "printed", label: "Mark printed", when: ["generated"] },
    { action: "issue", label: b.status === "issued" ? "Reassign" : "Issue", when: ["generated", "printed", "issued"] },
    { action: "completed", label: "Book finished", when: ["issued"] },
    { action: "lost", label: "Report lost", when: ["printed", "issued"] },
    { action: "cancelled", label: "Cancel", when: ["generated", "printed"] },
  ];
  return (
    <>
      <tr className="border-b border-ink-mid/60 hover:bg-ink-mid/10 align-top">
        <td className="p-3">
          <button type="button" onClick={props.onToggle} aria-label="Show leaves" className="text-slate hover:text-paper">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="p-3">
          <div className="font-mono text-signal">{b.book_label}</div>
          <div className="text-xs text-slate">{b.book_title}</div>
        </td>
        <td className="p-3 font-mono text-xs text-paper whitespace-nowrap">{b.first_label}<br />{b.last_label}</td>
        <td className="p-3 text-xs text-slate-light whitespace-nowrap">{SIZE_LABEL[b.page_size] || b.page_size}<br />{COPY_LABEL[b.copies]}</td>
        <td className="p-3"><Pill value={b.status} />{b.closed_reason && <div className="text-xs text-slate mt-1">{b.closed_reason}</div>}</td>
        <td className="p-3 text-xs text-paper">
          {b.issued_to_name || "—"}
          {b.issued_department && <div className="text-slate">{b.issued_department}</div>}
          {b.issued_at && <div className="text-slate">{formatDate(b.issued_at)}</div>}
        </td>
        <td className="p-3 text-xs text-slate-light whitespace-nowrap">
          {b.leaves_blank} blank · {b.leaves_captured + b.leaves_approved} used
          <br />{b.leaves_voided} void · {b.leaves_scanned} scanned
        </td>
        <td className="p-3">
          <div className="flex flex-wrap justify-end gap-1">
            {canManage && (
              <button
                type="button"
                onClick={props.onDownload}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 text-xs text-signal disabled:opacity-50"
              >
                {busy === `pdf:${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Print PDF
              </button>
            )}
            {canManage && actions.filter((a) => a.when.includes(b.status)).map((a) => (
              <button
                key={a.action}
                type="button"
                onClick={() => props.onAction(a.action)}
                disabled={busy !== null}
                className={`border px-2 py-1 text-xs disabled:opacity-50 ${a.action === "lost" || a.action === "cancelled" ? "border-red-500/40 text-red-300" : "border-ink-mid text-slate-light hover:text-paper"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ink-mid/60 bg-void/40">
          <td colSpan={8} className="p-3">
            {!leaves ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate" />
            ) : (
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {leaves.map((leaf) => (
                  <div key={leaf.id} className="flex items-center justify-between gap-2 border border-ink-mid px-2 py-1 text-xs">
                    <span className="font-mono text-paper">{leaf.serial_label}</span>
                    <span className="flex items-center gap-1">
                      <Pill value={leaf.status} />
                      {leaf.scan_count > 0 && <span className="text-slate" title="Times scanned">{leaf.scan_count}×</span>}
                      {canManage && (leaf.status === "blank" || leaf.status === "captured") && (
                        <button type="button" onClick={() => props.onVoid(leaf)} className="text-slate hover:text-red-300" title="Void this leaf">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DialogBox(props: {
  dialog: Dialog;
  busy: boolean;
  onClose: () => void;
  onGenerate: (payload: { book_type: string; count: number; leaves_per_book: number; copies: number; page_size: string; notes?: string }) => void;
  onStatus: (book: StationeryBook, action: StationeryBookAction, extra: Record<string, string>) => void;
  onVoid: (book: StationeryBook, leaf: StationeryLeaf, reason: string, spoiled: boolean) => void;
}) {
  const { dialog, busy } = props;
  const type = dialog.kind === "generate" ? dialog.type : null;
  const [count, setCount] = useState(1);
  const [leavesPer, setLeavesPer] = useState(type?.default_leaves ?? 50);
  const [copies, setCopies] = useState(type?.default_copies ?? 2);
  const [size, setSize] = useState(type?.page_size ?? "A4");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState(dialog.kind === "issue" ? (dialog.book.holder_group === "front_desk" ? "Front Desk" : "Finance") : "");
  const [reason, setReason] = useState("");
  const [spoiled, setSpoiled] = useState(true);

  const input = "w-full bg-void border border-ink-mid px-3 py-2 text-sm text-paper";
  const label = "block text-xs uppercase text-slate mb-1";
  let title = "";
  let body: ReactNode = null;
  let submit: (() => void) | null = null;
  let submitLabel = "Save";

  if (dialog.kind === "generate" && type) {
    title = `Generate ${type.book_title}s`;
    const pages = count * leavesPer * copies + count;
    body = (
      <div className="grid grid-cols-2 gap-3">
        <div><label className={label}>Books</label><input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} className={input} /></div>
        <div><label className={label}>{type.leaf_word === "page" ? "Pages" : "Leaves"} per book</label><input type="number" min={10} max={200} value={leavesPer} onChange={(e) => setLeavesPer(Number(e.target.value))} className={input} /></div>
        <div>
          <label className={label}>Copies</label>
          <select value={copies} onChange={(e) => setCopies(Number(e.target.value))} className={input}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{COPY_LABEL[n]}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Page size</label>
          <select value={size} onChange={(e) => setSize(e.target.value)} className={input}>
            {type.allowed_sizes.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="col-span-2"><label className={label}>Note (optional)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Printer: order of 10 books, Nov 2026" className={input} /></div>
        <p className="col-span-2 text-xs text-slate-light">
          Reserves {count * leavesPer} serial numbers ({type.prefix}-…) for good: they are never reused, even if a book is
          later cancelled. About {pages} printed pages in all, one PDF per book.
        </p>
      </div>
    );
    submitLabel = "Register books";
    submit = () => props.onGenerate({ book_type: type.key, count, leaves_per_book: leavesPer, copies, page_size: size, notes: notes.trim() || undefined });
  } else if (dialog.kind === "issue") {
    title = `Issue ${dialog.book.book_label}`;
    body = (
      <div className="space-y-3">
        <div><label className={label}>Issued to (name)</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
        <div><label className={label}>Department</label><input value={department} onChange={(e) => setDepartment(e.target.value)} className={input} /></div>
        <p className="text-xs text-slate-light">Only issued books show as valid when a leaf is scanned. The department appears on the public check page; the name does not.</p>
      </div>
    );
    submitLabel = "Issue book";
    submit = name.trim() ? () => props.onStatus(dialog.book, "issue", { issued_to_name: name.trim(), issued_department: department.trim() }) : null;
  } else if (dialog.kind === "lost" || dialog.kind === "cancelled") {
    title = dialog.kind === "lost" ? `Report ${dialog.book.book_label} lost` : `Cancel ${dialog.book.book_label}`;
    body = (
      <div className="space-y-3">
        <div><label className={label}>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={input} /></div>
        <p className="text-xs text-slate-light">
          {dialog.kind === "lost"
            ? "Every leaf in this book will show as \"do not accept\" when scanned. This cannot be undone."
            : "For a book that was never handed out (misprint, damaged). Its serial numbers are not reused."}
        </p>
      </div>
    );
    submitLabel = dialog.kind === "lost" ? "Report lost" : "Cancel book";
    submit = reason.trim() ? () => props.onStatus(dialog.book, dialog.kind as StationeryBookAction, { reason: reason.trim() }) : null;
  } else if (dialog.kind === "void") {
    title = `Void ${dialog.leaf.serial_label}`;
    body = (
      <div className="space-y-3">
        <div><label className={label}>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoilt while writing" className={input} /></div>
        <label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" checked={spoiled} onChange={(e) => setSpoiled(e.target.checked)} /> Spoilt (written on by mistake)</label>
        <p className="text-xs text-slate-light">Write VOID across every copy of the paper leaf and keep it in the book.</p>
      </div>
    );
    submitLabel = "Void leaf";
    submit = reason.trim().length >= 3 ? () => props.onVoid(dialog.book, dialog.leaf, reason.trim(), spoiled) : null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-paper text-lg font-semibold">{title}</h3>
          <button type="button" onClick={props.onClose} aria-label="Close" className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        {body}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="px-3 py-2 text-sm text-slate-light hover:text-paper">Close</button>
          <button
            type="button"
            onClick={() => submit?.()}
            disabled={!submit || busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-signal text-void text-sm font-bold disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
