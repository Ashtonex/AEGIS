-- Browser push subscriptions and offline delivery state.

CREATE TABLE IF NOT EXISTS core.pwa_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    expiration_time TIMESTAMPTZ,
    user_agent TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT pwa_push_subscription_unique UNIQUE (organization_id, user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS pwa_push_subscription_user_idx
    ON core.pwa_push_subscriptions (organization_id, user_id, is_active)
    WHERE is_deleted = false;

