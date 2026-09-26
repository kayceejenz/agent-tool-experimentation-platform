CREATE TABLE agent_platform.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    display_name text,
    password_hash text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    avatar_url text,
    failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
    locked_until timestamptz,
    token_version integer NOT NULL DEFAULT 0 CHECK (token_version >= 0),
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    deleted_at timestamptz,
    CONSTRAINT users_email_check CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
    CONSTRAINT users_display_name_check CHECK (display_name IS NULL OR length(display_name) <= 160)
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON agent_platform.users
    FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at();
CREATE UNIQUE INDEX users_email_unique_idx ON agent_platform.users(email) WHERE deleted_at IS NULL;

CREATE TABLE agent_platform.refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES agent_platform.users(id) ON DELETE CASCADE,
    family_id uuid NOT NULL,
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    replaced_by_token_id uuid REFERENCES agent_platform.refresh_tokens(id) ON DELETE SET NULL,
    user_agent text,
    ip_address inet,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text,
    CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_user_active_idx ON agent_platform.refresh_tokens(user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family_idx ON agent_platform.refresh_tokens(family_id, created_at);

CREATE TABLE agent_platform.auth_rate_limits (
    action text NOT NULL CHECK (action IN ('register', 'login')),
    client_key text NOT NULL,
    window_started_at timestamptz NOT NULL,
    attempt_count integer NOT NULL CHECK (attempt_count > 0),
    PRIMARY KEY(action, client_key)
);
CREATE INDEX auth_rate_limits_window_idx ON agent_platform.auth_rate_limits(window_started_at);

DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_platform_api') THEN
        GRANT SELECT ON agent_platform.users TO agent_platform_api;
        GRANT INSERT(email, password_hash, display_name) ON agent_platform.users TO agent_platform_api;
        GRANT UPDATE(failed_login_attempts, locked_until, last_login_at) ON agent_platform.users TO agent_platform_api;
        GRANT SELECT, INSERT, UPDATE ON agent_platform.refresh_tokens TO agent_platform_api;
        GRANT SELECT, INSERT, UPDATE ON agent_platform.auth_rate_limits TO agent_platform_api;
    END IF;
END $$;
