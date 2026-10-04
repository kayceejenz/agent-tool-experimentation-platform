CREATE TABLE agent_platform.mcp_tools (
    id uuid PRIMARY KEY,
    server_id uuid NOT NULL REFERENCES agent_platform.mcp_servers(id) ON DELETE CASCADE,
    name text NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT false,
    available boolean NOT NULL DEFAULT true,
    UNIQUE(server_id, name)
);
CREATE TABLE agent_platform.tool_revisions (
    tool_id uuid NOT NULL REFERENCES agent_platform.mcp_tools(id) ON DELETE CASCADE,
    revision integer NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(tool_id, revision)
);
CREATE TABLE agent_platform.tool_executions (
    id uuid PRIMARY KEY,
    tool_id uuid NOT NULL,
    revision integer NOT NULL,
    user_id uuid NOT NULL REFERENCES agent_platform.users(id),
    request_id uuid NOT NULL,
    arguments_hash text NOT NULL,
    inputs jsonb NOT NULL,
    status text NOT NULL CHECK(status IN ('running','success','tool_error','unknown')),
    result jsonb,
    error_code text,
    duration_ms integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(tool_id,revision) REFERENCES agent_platform.tool_revisions(tool_id,revision),
    UNIQUE(tool_id,user_id,request_id)
);
CREATE INDEX tool_executions_history ON agent_platform.tool_executions(tool_id,created_at DESC);
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_platform_api') THEN
        GRANT SELECT, INSERT, UPDATE ON agent_platform.mcp_tools TO agent_platform_api;
        GRANT SELECT, INSERT ON agent_platform.tool_revisions TO agent_platform_api;
        GRANT SELECT, INSERT, UPDATE ON agent_platform.tool_executions TO agent_platform_api;
    END IF;
END $$;
