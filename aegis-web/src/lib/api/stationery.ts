import { ApiResponse } from "@/types/api";
import { ApiError, fetchApi, getApiHeaders, resolveApiUrl } from "./core";

// --- AEGIS REGISTERED STATIONERY (/api/v1/finance/stationery) ---
// Printed books (payment vouchers, petty cash books, ...) whose every leaf has
// a serial number and a QR code that opens /q/<token>.

const BASE = "/api/v1/finance/stationery";

export type StationeryBookStatus = "generated" | "printed" | "issued" | "completed" | "lost" | "cancelled";
export type StationeryLeafStatus = "blank" | "captured" | "approved" | "voided" | "spoiled";

export interface StationeryBookType {
  key: string;
  prefix: string;
  title: string;
  book_title: string;
  holder_group: "finance" | "front_desk";
  page_size: string;
  allowed_sizes: string[];
  default_leaves: number;
  default_copies: number;
  leaf_word: string;
  description: string;
}

export interface StationeryBook {
  id: string;
  book_type: string;
  book_title: string;
  book_number: number;
  book_label: string;
  first_label: string;
  last_label: string;
  leaf_count: number;
  copies: number;
  page_size: string;
  holder_group: "finance" | "front_desk";
  status: StationeryBookStatus;
  batch_id: string | null;
  issued_to_name: string | null;
  issued_to_user_name: string | null;
  issued_department: string | null;
  issued_at: string | null;
  printed_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  notes: string | null;
  created_at: string;
  leaves_blank: number;
  leaves_captured: number;
  leaves_approved: number;
  leaves_voided: number;
  leaves_scanned: number;
  leaves?: StationeryLeaf[];
}

export interface StationeryLeaf {
  id: string;
  serial: number;
  serial_label: string;
  leaf_index: number;
  status: StationeryLeafStatus;
  captured_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  scan_count: number;
  first_scanned_at: string | null;
  last_scanned_at: string | null;
}

export interface StationeryLeafLookup {
  id: string;
  serial_label: string;
  status: StationeryLeafStatus;
  leaf_index: number;
  scan_count: number;
  book_id: string;
  book_label: string;
  book_type: string;
  book_status: StationeryBookStatus;
  issued_to_name: string | null;
  issued_department: string | null;
  scan_url: string;
}

export type StationeryBookAction = "printed" | "issue" | "completed" | "lost" | "cancelled";

export async function fetchStationeryTypes(): Promise<ApiResponse<StationeryBookType[]>> {
  return fetchApi<ApiResponse<StationeryBookType[]>>(`${BASE}/types`, { cache: "no-store", allowFallback: false });
}

export async function fetchStationeryBooks(params: { book_type?: string; status?: string } = {}): Promise<ApiResponse<StationeryBook[]>> {
  const search = new URLSearchParams();
  if (params.book_type) search.set("book_type", params.book_type);
  if (params.status) search.set("status", params.status);
  const query = search.toString();
  return fetchApi<ApiResponse<StationeryBook[]>>(`${BASE}/books${query ? `?${query}` : ""}`, { cache: "no-store", allowFallback: false });
}

export async function fetchStationeryBook(bookId: string): Promise<ApiResponse<StationeryBook>> {
  return fetchApi<ApiResponse<StationeryBook>>(`${BASE}/books/${encodeURIComponent(bookId)}`, { cache: "no-store", allowFallback: false });
}

export async function generateStationeryBooks(payload: {
  book_type: string;
  count: number;
  leaves_per_book?: number;
  copies?: number;
  page_size?: string;
  notes?: string;
}): Promise<ApiResponse<{ batch_id: string; book_type: string; books: { id: string; book_label: string; first_label: string; last_label: string }[] }>> {
  return fetchApi(`${BASE}/books`, { method: "POST", body: JSON.stringify(payload), allowFallback: false, timeoutMs: 90000 });
}

export async function changeStationeryBookStatus(
  bookId: string,
  payload: { action: StationeryBookAction; issued_to_name?: string; issued_department?: string; reason?: string },
): Promise<ApiResponse<StationeryBook>> {
  return fetchApi<ApiResponse<StationeryBook>>(`${BASE}/books/${encodeURIComponent(bookId)}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function voidStationeryLeaf(leafId: string, reason: string, spoiled = false): Promise<ApiResponse<{ id: string; serial_label: string; status: string }>> {
  return fetchApi(`${BASE}/leaves/${encodeURIComponent(leafId)}/void`, {
    method: "POST",
    body: JSON.stringify({ reason, spoiled }),
    allowFallback: false,
  });
}

export async function lookupStationeryLeaf(query: string): Promise<ApiResponse<StationeryLeafLookup>> {
  return fetchApi<ApiResponse<StationeryLeafLookup>>(`${BASE}/lookup?q=${encodeURIComponent(query)}`, { cache: "no-store", allowFallback: false });
}

async function downloadPdf(endpoint: string, fallbackMessage: string): Promise<Blob> {
  const headers = await getApiHeaders();
  const response = await fetch(resolveApiUrl(endpoint), { method: "GET", headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body?.detail || body?.error?.message || fallbackMessage);
  }
  return response.blob();
}

/** The print-ready PDF of a registered book: cover, then every leaf and its copies. */
export async function downloadStationeryBookPdf(bookId: string, cover = true): Promise<Blob> {
  return downloadPdf(`${BASE}/books/${encodeURIComponent(bookId)}/pdf?cover=${cover ? "true" : "false"}`, "Could not generate the book PDF.");
}

/** One leaf of a book type stamped SPECIMEN, for checking the design with the printer. */
export async function downloadStationerySpecimen(bookType: string, pageSize?: string): Promise<Blob> {
  const query = pageSize ? `?page_size=${encodeURIComponent(pageSize)}` : "";
  return downloadPdf(`${BASE}/types/${encodeURIComponent(bookType)}/specimen${query}`, "Could not generate the specimen.");
}
