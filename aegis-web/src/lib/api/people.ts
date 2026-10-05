import { fetchApi } from "./core";

// The person API always returns data on success, unlike the optional-data ApiResponse.
export type PeopleResponse<T> = { success: boolean; data: T; message?: string };

// --- PERSON CARD (/api/v1/hr/people) ---
// One record per person, opened from the HR and Workforce registers alike.

const PEOPLE = "/api/v1/hr/people";

export type PersonCore = {
  id: string;
  employee_number: string | null;
  employee_name: string;
  job_title: string | null;
  employment_status: "active" | "on_leave" | "suspended" | "terminated";
  employment_type: string | null;
  category_id: string | null;
  category_name: string | null;
  position_id: string | null;
  position_name: string | null;
  position_grade: string | null;
  department_id: string | null;
  department_name: string | null;
  start_date: string | null;
  end_date: string | null;
  work_location: string | null;
  annual_leave_days: number | null;
  version: number;
  login_email: string | null;
  login_active: boolean | null;
  left_reason: string | null;
  left_recorded_at: string | null;
  left_recorded_by_name: string | null;
  self_profile_updated_at: string | null;
};

export type EmergencyContact = { name?: string | null; relationship?: string | null; phone?: string | null; address?: string | null };

export type PersonalDetails = {
  national_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  marital_status: string | null;
  personal_phone: string | null;
  personal_email: string | null;
  home_address: string | null;
  highest_qualification: string | null;
  professional_body: string | null;
  professional_registration_number: string | null;
  emergency_contact: EmergencyContact;
};

export type PayProfile = {
  pay_type: "monthly_salary" | "hourly" | "daily";
  base_rate: number | string;
  overtime_rate: number | string;
  currency: string;
  bank_name: string | null;
  bank_account_number: string | null;
  tax_number: string | null;
  nssa_number: string | null;
  updated_at: string | null;
};

export type Psychometric = {
  id: string;
  test_name: string;
  provider: string | null;
  assessed_on: string | null;
  overall_score: number | string | null;
  max_score: number | string | null;
  dimension_scores: Record<string, number>;
  interpretation: string | null;
};

export type Allocation = {
  id: string;
  project_id: string;
  project_name: string;
  project_code: string | null;
  role_on_project: string | null;
  allocation_percent: number | string;
  starts_on: string;
  ends_on: string;
  status: string;
  compliance_status: string | null;
};

export type PersonCard = {
  person: PersonCore;
  line_manager: { manager_employee_id: string; manager_name: string; manager_job_title: string | null; effective_from: string } | null;
  direct_reports: { id: string; employee_name: string; job_title: string | null; employee_number: string | null }[];
  allocations: Allocation[];
  personal?: PersonalDetails;
  psychometrics?: Psychometric[];
  pay?: PayProfile | null;
  access: { personal: boolean; personal_manage: boolean; pay: boolean; pay_manage: boolean; employment_manage: boolean; allocate: boolean; offboard: boolean; files: boolean; files_manage: boolean };
  completeness: { percent: number; missing: string[] };
  login_disabled?: boolean;
};

export type PeopleCatalogue = {
  categories: { id: string; code: string; name: string; description: string | null; payroll_eligible: boolean }[];
  positions: { id: string; code: string; name: string; category_id: string | null; department_id: string | null; grade: string | null; people: number }[];
  departments: { id: string; code: string; name: string }[];
  managers: { id: string; employee_name: string; job_title: string | null; employee_number: string | null }[];
  projects: { id: string; name: string; project_code: string | null; status: string | null }[];
};

export type RegisterRow = {
  id: string;
  employee_number: string | null;
  employee_name: string;
  job_title: string | null;
  employment_status: string;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  category_id: string | null;
  category_name: string | null;
  position_name: string | null;
  department_name: string | null;
  login_email: string | null;
  login_active: boolean | null;
  line_manager_name: string | null;
  line_manager_id: string | null;
  live_allocations: number;
  has_pay_profile: boolean;
  personal_complete: boolean;
};

export type PeopleSummary = {
  headcount: number;
  active: number;
  on_leave_status: number;
  on_leave_today: number;
  suspended: number;
  former: number;
  login_disabled_but_active: number;
  missing_role: number;
  missing_start_date: number;
  missing_personal: number;
  missing_pay_profile: number;
  unallocated: number;
  by_category: { name: string; people: number }[];
  by_department: { name: string; people: number }[];
  recent_leavers: { id: string; employee_name: string; employee_number: string | null; end_date: string | null; left_reason: string | null }[];
};

function query(params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

const read = { cache: "no-store" as const, allowFallback: false };
const write = (method: string, payload?: unknown) => ({
  method,
  allowFallback: false,
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});

export const getPeopleSummary = () => fetchApi<PeopleResponse<PeopleSummary>>(`${PEOPLE}/summary`, read);
export const getPeopleRegister = (params: { q?: string; status?: string; category_id?: string; department_id?: string } = {}) =>
  fetchApi<PeopleResponse<RegisterRow[]>>(`${PEOPLE}/register${query(params)}`, read);
export const getPeopleCatalogue = () => fetchApi<PeopleResponse<PeopleCatalogue>>(`${PEOPLE}/catalogue`, read);
export const getPersonCard = (id: string) => fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}`, read);
export const getMyPersonCard = () => fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/me`, read);
export const updateMyPersonalDetails = (payload: Partial<PersonalDetails>) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/me/personal`, write("PATCH", payload));
export const updatePersonEmployment = (id: string, payload: Record<string, unknown>) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/employment`, write("PATCH", payload));
export const updatePersonPersonal = (id: string, payload: Partial<PersonalDetails>) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/personal`, write("PATCH", payload));
export const updatePersonPay = (id: string, payload: Record<string, unknown>) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/pay`, write("PUT", payload));
export const addPersonPsychometric = (id: string, payload: Record<string, unknown>) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/psychometrics`, write("POST", payload));
export const removePersonPsychometric = (id: string, resultId: string) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/psychometrics/${resultId}`, write("DELETE"));
export const endPersonAllocation = (id: string, allocationId: string, endsOn: string) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/allocations/${allocationId}/end`, write("POST", { ends_on: endsOn }));
export const recordPersonLeft = (id: string, payload: { left_on: string; reason: string; disable_login: boolean }) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/leave-organisation`, write("POST", payload));
export const reinstatePerson = (id: string, reason: string) =>
  fetchApi<PeopleResponse<PersonCard>>(`${PEOPLE}/${id}/reinstate`, write("POST", { reason }));
