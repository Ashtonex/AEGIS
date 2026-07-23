-- ============================================================================
-- PROJECT IMPERIUM - SOLE SUPERADMIN CRAFTING (ASHTON@ADMIN.COM)
-- Migration: 038_superadmin_ashton_crafting.sql
-- ============================================================================

-- 1. Ensure Default Test Organization & SUPERADMIN Role Exist
INSERT INTO core.organizations (id, name, registration_number)
VALUES ('00000000-0000-0000-0000-000000000001', 'Six Nine Construction', 'SNC-PROD-001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.roles (id, organization_id, name, description)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'SUPERADMIN', 'Unrestricted System Access')
ON CONFLICT (id) DO NOTHING;

-- 2. Synchronize ashton@admin.com in auth.users, core.users, and core.user_roles
DO $$
DECLARE
    v_user_id UUID;
    v_org_id UUID := '00000000-0000-0000-0000-000000000001';
    v_role_id UUID := '00000000-0000-0000-0000-000000000002';
BEGIN
    -- Check if ashton@admin.com exists in Supabase auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = 'ashton@admin.com' LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Inject SUPERADMIN claims directly into raw_app_meta_data for JWT generation
        UPDATE auth.users
        SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
            'org_id', v_org_id,
            'role', 'SUPERADMIN'
        )
        WHERE id = v_user_id;

        -- Ensure user record exists in core.users
        INSERT INTO core.users (id, organization_id, email, full_name, is_active)
        VALUES (v_user_id, v_org_id, 'ashton@admin.com', 'Ashton Admin', TRUE)
        ON CONFLICT (id) DO UPDATE 
        SET organization_id = v_org_id, is_active = TRUE;

        -- Assign SUPERADMIN role in core.user_roles
        INSERT INTO core.user_roles (user_id, role_id, organization_id)
        VALUES (v_user_id, v_role_id, v_org_id)
        ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
    END IF;
END $$;
