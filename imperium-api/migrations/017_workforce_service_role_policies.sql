-- The backend uses service-role credentials only after application-level RBAC and
-- tenant checks. No anon/authenticated policy grants direct workforce access.
CREATE POLICY "Workforce service role only" ON hr.employee_skills FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Workforce service role only" ON hr.employee_certifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Workforce service role only" ON hr.employee_availability FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Workforce service role only" ON hr.project_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Workforce service role only" ON hr.timesheets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Workforce service role only" ON hr.attendance_events FOR ALL TO service_role USING (true) WITH CHECK (true);
