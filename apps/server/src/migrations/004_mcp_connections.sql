CREATE TABLE agent_platform.mcp_servers (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
    endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 2048),
    transport text NOT NULL DEFAULT 'streamable_http' CHECK (transport = 'streamable_http'),
    auth_type text NOT NULL CHECK (auth_type IN ('none', 'bearer')),
    enabled boolean NOT NULL DEFAULT false,
    connection_status text NOT NULL DEFAULT 'untested' CHECK (connection_status IN ('untested', 'connected', 'error')),
    last_checked_at timestamptz,
    last_error_code text,
    config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
    created_by uuid NOT NULL REFERENCES agent_platform.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_servers_project_page_idx ON agent_platform.mcp_servers(project_id, created_at DESC, id DESC);
CREATE TRIGGER mcp_servers_updated_at BEFORE UPDATE ON agent_platform.mcp_servers
    FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at();

CREATE TABLE agent_platform.mcp_server_credentials (
    server_id uuid PRIMARY KEY REFERENCES agent_platform.mcp_servers(id) ON DELETE CASCADE,
    encrypted_value bytea NOT NULL CHECK (octet_length(encrypted_value) >= 30),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER mcp_server_credentials_updated_at BEFORE UPDATE ON agent_platform.mcp_server_credentials
    FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at();

DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_platform_api') THEN
        GRANT SELECT ON agent_platform.mcp_servers TO agent_platform_api;
        GRANT INSERT(id,project_id,name,endpoint,transport,auth_type,created_by) ON agent_platform.mcp_servers TO agent_platform_api;
        GRANT UPDATE(name,endpoint,auth_type,enabled,connection_status,last_checked_at,last_error_code,config_version) ON agent_platform.mcp_servers TO agent_platform_api;
        GRANT SELECT, INSERT, UPDATE, DELETE ON agent_platform.mcp_server_credentials TO agent_platform_api;
    END IF;
END $$;
