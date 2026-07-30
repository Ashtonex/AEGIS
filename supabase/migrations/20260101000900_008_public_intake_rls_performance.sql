ALTER POLICY "Tenant Isolation Policy" ON crm.web_intakes
    USING (organization_id = (SELECT get_jwt_org_id()) OR current_setting('role') = 'service_role');
ALTER POLICY "Tenant Isolation Policy" ON crm.tender_interests
    USING (organization_id = (SELECT get_jwt_org_id()) OR current_setting('role') = 'service_role');
ALTER POLICY "Tenant Isolation Policy" ON hr.applications
    USING (organization_id = (SELECT get_jwt_org_id()) OR current_setting('role') = 'service_role');
