import { ApiError, fetchApi, getApiHeaders, recordApiWrite, resolveApiUrl } from "./core";

// --- EMPLOYEE FILES (/api/v1/hr/files): contracts, credentials, assets ---

const FILES = "/api/v1/hr/files";
type Resp<T> = { success: boolean; data: T; message?: string };

export type ContractRow = {
  id: string;
  contract_number: string;
  contract_type: string;
  title: string | null;
  starts_on: string;
  ends_on: string | null;
  signed_on: string | null;
  probation_ends_on: string | null;
  notice_period_days: number | null;
  basic_salary: number | string | null;
  currency: string | null;
  status: string;
  state: "current" | "upcoming" | "expired" | "renewed" | "terminated" | "superseded" | "draft";
  days_left: number | null;
  ended_reason: string | null;
  file_attachment_id: string | null;
  file_name: string | null;
  review_meeting_at: string | null;
  notes: string | null;
  created_by_name: string | null;
};

export type CredentialRow = {
  id: string;
  credential_type: string;
  certification_name: string;
  issuing_authority: string | null;
  certificate_number: string | null;
  licence_class: string | null;
  vehicle_registration: string | null;
  issued_on: string | null;
  expires_on: string | null;
  verification_status: string;
  notes: string | null;
  file_attachment_id: string | null;
  file_name: string | null;
  days_left: number | null;
  state: "valid" | "expiring" | "expired";
};

export type AssetRow = {
  id: string;
  asset_type: string;
  asset_label: string;
  asset_reference: string | null;
  serial_number: string | null;
  quantity: number;
  asset_value: number | string | null;
  issued_on: string;
  due_back_on: string | null;
  returned_on: string | null;
  condition_out: string | null;
  condition_in: string | null;
  status: string;
  notes: string | null;
  acknowledged_at: string | null;
  file_attachment_id: string | null;
  file_name: string | null;
  issued_by_name: string | null;
  returned_to_name: string | null;
  overdue: boolean;
};

export type FilesOverviewRow = {
  id: string;
  employee_number: string | null;
  employee_name: string;
  position_name: string | null;
  job_title: string | null;
  department_name: string | null;
  employment_status: string;
  contract_number: string | null;
  contract_type: string | null;
  starts_on: string | null;
  ends_on: string | null;
  signed_on: string | null;
  contract_file: string | null;
  contract_state: "none" | "current" | "ending" | "expired";
  contract_days_left: number | null;
  review_meeting_at: string | null;
  contracts: number;
  credentials: number;
  credentials_expired: number;
  credentials_expiring: number;
  next_credential_expiry: string | null;
  drivers_licences: number;
  assets_held: number;
  assets_overdue: number;
  assets_value: number | string;
};

export type FilesOverview = {
  people: FilesOverviewRow[];
  totals: {
    people: number; no_contract: number; contracts_ending: number; contracts_expired: number; unsigned: number;
    credentials_expiring: number; credentials_expired: number; drivers: number;
    assets_held: number; assets_overdue: number; assets_value: number;
  };
};

export type ExpiryRun = {
  today: string;
  dry_run: boolean;
  sent: { kind: string; employee: string; title: string; expires_on: string; days_left: number; tier: number; channels?: Record<string, unknown> }[];
};

const read = { cache: "no-store" as const, allowFallback: false };
const json = (method: string, payload: unknown) => ({ method, allowFallback: false, body: JSON.stringify(payload) });

async function multipart<T>(endpoint: string, form: FormData): Promise<Resp<T>> {
  const headers = await getApiHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const response = await fetch(resolveApiUrl(endpoint), { method: "POST", headers, body: form });
  recordApiWrite();
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : body?.detail;
    throw new ApiError(response.status, detail || body?.message || "Upload failed.");
  }
  return body;
}

function toForm(values: Record<string, string | number | File | null | undefined>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    form.append(key, value instanceof File ? value : String(value));
  }
  return form;
}

export const getFilesOverview = (kind: "contracts" | "credentials" | "assets") =>
  fetchApi<Resp<FilesOverview>>(`${FILES}/overview?kind=${kind}`, read);

export const getPersonContracts = (id: string) => fetchApi<Resp<ContractRow[]>>(`${FILES}/people/${id}/contracts`, read);
export const addPersonContract = (id: string, values: Record<string, string | number | File | null | undefined>) =>
  multipart<{ id: string; contract_number: string; contracts: ContractRow[] }>(`${FILES}/people/${id}/contracts`, toForm(values));
export const attachContractFile = (contractId: string, file: File, signedOn?: string) =>
  multipart<ContractRow[]>(`${FILES}/contracts/${contractId}/file`, toForm({ file, mark_signed_on: signedOn }));
export const changeContract = (contractId: string, payload: { action: "terminate" | "mark_signed" | "update"; ends_on?: string; signed_on?: string; reason?: string; notes?: string }) =>
  fetchApi<Resp<ContractRow[]>>(`${FILES}/contracts/${contractId}`, json("PATCH", payload));

export const getPersonCredentials = (id: string) => fetchApi<Resp<CredentialRow[]>>(`${FILES}/people/${id}/credentials`, read);
export const addPersonCredential = (id: string, values: Record<string, string | number | File | null | undefined>) =>
  multipart<CredentialRow[]>(`${FILES}/people/${id}/credentials`, toForm(values));
export const changeCredential = (credentialId: string, payload: { verification_status?: string; expires_on?: string; notes?: string }) =>
  fetchApi<Resp<CredentialRow[]>>(`${FILES}/credentials/${credentialId}`, json("PATCH", payload));
export const removeCredential = (credentialId: string) =>
  fetchApi<Resp<CredentialRow[]>>(`${FILES}/credentials/${credentialId}`, { method: "DELETE", allowFallback: false });

export const getPersonAssets = (id: string) => fetchApi<Resp<AssetRow[]>>(`${FILES}/people/${id}/assets`, read);
export const issuePersonAsset = (id: string, payload: Record<string, unknown>) =>
  fetchApi<Resp<AssetRow[]>>(`${FILES}/people/${id}/assets`, json("POST", payload));
export const returnPersonAsset = (assignmentId: string, payload: { outcome: string; returned_on: string; condition_in?: string; notes?: string }) =>
  fetchApi<Resp<AssetRow[]>>(`${FILES}/assets/${assignmentId}/return`, json("POST", payload));
export const attachAssetAcknowledgement = (assignmentId: string, file: File) =>
  multipart<AssetRow[]>(`${FILES}/assets/${assignmentId}/acknowledgement`, toForm({ file }));

export const openHrAttachment = (attachmentId: string) =>
  fetchApi<Resp<{ download_url?: string; web_url?: string; office_open_url?: string | null; preview_url?: string | null }>>(`${FILES}/attachments/${attachmentId}/open`, read);
export const previewExpiryAlerts = () => fetchApi<Resp<ExpiryRun>>(`${FILES}/alerts/preview`, read);
export const runExpiryAlerts = () => fetchApi<Resp<ExpiryRun>>(`${FILES}/alerts/run`, { method: "POST", allowFallback: false });
export const getExpiryAlertHistory = () =>
  fetchApi<Resp<{ source_type: string; threshold_days: number; expires_on: string; sent_at: string; employee_name: string | null; item: string | null; channels: { email?: string[] } }[]>>(`${FILES}/alerts/history`, read);
