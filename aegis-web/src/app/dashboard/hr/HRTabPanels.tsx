"use client";

import { Search } from "lucide-react";
import { dateValue, statusClass } from "./page";

type RecordData = Record<string, any>;

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return dateValue(value);
  return String(value).replace(/_/g, " ");
}

function columnLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function OperationList({ title, rows, columns, empty }: { title: string; rows: RecordData[]; columns: string[]; empty: string }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-ink-mid bg-ink/30 px-4 py-3">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">{title}</span>
        <span className="font-mono text-xs text-paper">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-light">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                {columns.map((column) => <th key={column} className="p-4">{columnLabel(column)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row, index) => (
                <tr key={row.id || index} className="hover:bg-ink-mid/10">
                  {columns.map((column) => (
                    <td key={column} className="p-4 text-slate-light">
                      <span className={/(status|stage|severity|outcome|type)$/.test(column) ? "capitalize" : ""}>{formatCell(row[column])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeaveTable({ rows, onDecide }: { rows: RecordData[]; onDecide: (id: string, decision: "approved" | "rejected") => void }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="border-b border-ink-mid bg-ink/30 px-4 py-3">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">Leave request log</span>
      </div>
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
            <th className="p-4">Employee</th>
            <th className="p-4">Type</th>
            <th className="p-4">Start</th>
            <th className="p-4">End</th>
            <th className="p-4 text-right">Days</th>
            <th className="p-4">Status</th>
            <th className="p-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="p-4 text-center text-slate">No leave requests logged.</td></tr>
          ) : rows.map((l) => (
            <tr key={l.id} className="hover:bg-ink-mid/10">
              <td className="p-4 font-medium text-paper">{l.employee_name}</td>
              <td className="p-4 capitalize text-paper">{l.leave_type}</td>
              <td className="p-4 text-slate-light">{dateValue(l.start_date)}</td>
              <td className="p-4 text-slate-light">{dateValue(l.end_date)}</td>
              <td className="p-4 text-right text-paper font-mono">{l.days_requested}</td>
              <td className="p-4"><span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(l.status)}`}>{l.status}</span></td>
              <td className="p-4 text-right space-x-2">
                {l.status === "pending" && (
                  <>
                    <button onClick={() => onDecide(l.id, "approved")} className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 px-2 py-1 rounded text-xs font-mono">Approve</button>
                    <button onClick={() => onDecide(l.id, "rejected")} className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-2 py-1 rounded text-xs font-mono">Reject</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveCalendar({ rows }: { rows: RecordData[] }) {
  const grouped = rows.reduce<Record<string, RecordData[]>>((acc, row) => {
    const key = typeof row.start_date === "string" ? row.start_date.slice(0, 10) : "Unscheduled";
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
  const days = Object.keys(grouped).sort().slice(0, 21);
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="border-b border-ink-mid bg-ink/30 px-4 py-3">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">Leave calendar</span>
      </div>
      {days.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-light">No leave appears on the calendar.</div>
      ) : (
        <div className="grid gap-px bg-ink-mid md:grid-cols-3">
          {days.map((day) => (
            <div key={day} className="min-h-28 bg-ink p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{dateValue(day)}</p>
              <div className="mt-2 space-y-1.5">
                {grouped[day].map((item) => (
                  <div key={item.id} className={`border px-2 py-1 text-xs ${statusClass(item.status)}`}>
                    <p className="font-medium text-paper">{item.employee_name || item.title}</p>
                    <p className="capitalize text-slate-light">{item.leave_type} · {item.days_requested} day(s)</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmployeesTab({
  filteredEmployees, searchQuery, onSearchChange, deptFilter, onDeptChange, statusFilter, onStatusChange,
  selectedEmployeeId, onSelectEmployee,
}: {
  filteredEmployees: RecordData[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  deptFilter: string;
  onDeptChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  selectedEmployeeId: string;
  onSelectEmployee: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate" />
          <input
            type="text"
            placeholder="Search employees, numbers, trades..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-ink border border-ink-mid rounded pl-9 pr-4 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
          />
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <select
            value={deptFilter}
            onChange={(e) => onDeptChange(e.target.value)}
            className="bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
          >
            <option value="all">All Departments</option>
            <option value="Operations">Operations</option>
            <option value="Engineering">Engineering</option>
            <option value="Administration">Administration</option>
            <option value="Plant Hire">Plant Hire</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            className="bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="on_leave">On Leave</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
              <th className="p-4">Employee #</th>
              <th className="p-4">Name</th>
              <th className="p-4">Role</th>
              <th className="p-4">Department</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {filteredEmployees.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate">No employees found matching the filters.</td>
              </tr>
            ) : (
              filteredEmployees.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => onSelectEmployee(e.id)}
                  className={`cursor-pointer hover:bg-ink-mid/30 transition-colors ${selectedEmployeeId === e.id ? 'bg-ink-mid/20 border-l-2 border-l-signal' : ''}`}
                >
                  <td className="p-4 font-mono text-signal">{e.employee_number || "—"}</td>
                  <td className="p-4 font-medium text-paper">{e.employee_name || e.name || e.full_name}</td>
                  <td className="p-4 text-paper">{e.job_title}</td>
                  <td className="p-4 text-slate-light">{e.department || "—"}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(e.employment_status)}`}>
                      {e.employment_status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AttendanceTab({
  attendance, attendanceDate, onDateChange,
}: {
  attendance: RecordData[];
  attendanceDate: string;
  onDateChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] flex justify-between items-center">
        <span className="font-mono text-xs uppercase text-slate tracking-wider">Attendance date filter</span>
        <input
          type="date"
          value={attendanceDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-sm text-paper focus:outline-none focus:border-signal/50"
        />
      </div>
      <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
              <th className="p-4">Employee</th>
              <th className="p-4">Check In</th>
              <th className="p-4">Check Out</th>
              <th className="p-4 text-right">Regular Hrs</th>
              <th className="p-4 text-right">Overtime</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {attendance.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate">No attendance logged for the selected date.</td>
              </tr>
            ) : (
              attendance.map((a) => (
                <tr key={a.id} className="hover:bg-ink-mid/10">
                  <td className="p-4 font-medium text-paper">{a.employee_name}</td>
                  <td className="p-4 font-mono text-slate-light">{a.check_in ? new Date(a.check_in).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : "—"}</td>
                  <td className="p-4 font-mono text-slate-light">{a.check_out ? new Date(a.check_out).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : "—"}</td>
                  <td className="p-4 text-right text-paper font-mono">{a.regular_hours}</td>
                  <td className="p-4 text-right text-slate-light font-mono">{a.overtime_hours}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(a.status)}`}>
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LeaveTab({
  calendarRows, leaveRequests, onDecide,
}: {
  calendarRows: RecordData[];
  leaveRequests: RecordData[];
  onDecide: (id: string, decision: "approved" | "rejected") => void;
}) {
  return (
    <div className="space-y-4">
      <LeaveCalendar rows={calendarRows} />
      <LeaveTable rows={leaveRequests} onDecide={onDecide} />
    </div>
  );
}
