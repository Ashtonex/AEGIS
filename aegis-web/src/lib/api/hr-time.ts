import { fetchApi } from "./core";

// --- TIME (/api/v1/hr/time): automatic check-in, weekly hours, attendance board, absence ---

const TIME = "/api/v1/hr/time";
type Resp<T> = { success: boolean; data: T; message?: string };

export type CheckInResult = {
  linked: boolean;
  employee_id?: string;
  checked_in_now?: boolean;
  check_in?: string | null;
  status?: string | null;
  hours_so_far?: number;
  day_ends_at?: string;
  weekly_confirmation_due?: string | null;
};

export type WeekDay = {
  date: string;
  weekday: string;
  workday: boolean;
  kind: "worked" | "absent" | "leave" | "holiday" | "weekend" | "future";
  holiday: string | null;
  leave_type: string | null;
  check_in: string | null;
  check_out: string | null;
  auto_closed: boolean;
  source: string | null;
  recorded_hours: number;
  confirmed_hours?: number;
  note?: string | null;
  corrected?: boolean;
};

export type WeekView = {
  week_start: string;
  week_end: string;
  days: WeekDay[];
  recorded_hours: number;
  leave_days: number;
  absent_days: number;
  standard_hours: number;
  confirmation: { id: string; status: string; confirmed_hours: number | string; decision_note: string | null; days: WeekDay[] } | null;
};

export type BoardRow = {
  employee_id: string;
  employee_number: string | null;
  employee_name: string;
  position_name: string | null;
  state: string;
  leave_type: string | null;
  check_in: string | null;
  check_out: string | null;
  auto_closed: boolean;
  source: string | null;
  hours: number;
};

export type WeeksRow = {
  employee_id: string;
  employee_number: string | null;
  employee_name: string;
  position_name: string | null;
  id: string | null;
  status: "submitted" | "approved" | "queried" | null;
  recorded_hours: number | string | null;
  confirmed_hours: number | string | null;
  leave_days: number | string | null;
  corrections: number | null;
  days: WeekDay[] | null;
  submitted_at: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
};

export type AbsenceRow = {
  employee_id: string;
  employee_number: string | null;
  employee_name: string;
  position_name: string | null;
  workdays: number;
  present: number;
  leave: number;
  leave_by_type: Record<string, number>;
  absent: number;
  absent_dates: string[];
  late: number;
  hours: number;
  attendance_rate: number | null;
};

const read = { cache: "no-store" as const, allowFallback: false };
const post = (payload?: unknown) => ({ method: "POST", allowFallback: false, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

export const checkInToday = () => fetchApi<Resp<CheckInResult>>(`${TIME}/check-in`, post());
export const getMyWeek = (weekEnd?: string) => fetchApi<Resp<WeekView>>(`${TIME}/me/week${weekEnd ? `?week_end=${weekEnd}` : ""}`, read);
export const confirmMyWeek = (weekEnd: string, days: { date: string; hours: number; note?: string }[]) =>
  fetchApi<Resp<{ id: string; confirmed_hours: number; corrections: number; week: WeekView }>>(`${TIME}/me/week/confirm`, post({ week_end: weekEnd, days }));
export const getAttendanceBoard = (day?: string) => fetchApi<Resp<{ date: string; people: BoardRow[] }>>(`${TIME}/board${day ? `?date=${day}` : ""}`, read);
export const getWeeklyHours = (weekEnd?: string) =>
  fetchApi<Resp<{ week_start: string; week_end: string; people: WeeksRow[]; totals: Record<string, number> }>>(`${TIME}/weeks${weekEnd ? `?week_end=${weekEnd}` : ""}`, read);
export const decideWeeklyHours = (id: string, decision: "approved" | "queried", note?: string) =>
  fetchApi<Resp<{ id: string; status: string }>>(`${TIME}/weeks/${id}/decision`, post({ decision, note }));
export const getAbsenceReport = (from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.set("date_from", from);
  if (to) q.set("date_to", to);
  return fetchApi<Resp<{ date_from: string; date_to: string; people: AbsenceRow[] }>>(`${TIME}/absence${q.toString() ? `?${q}` : ""}`, read);
};
