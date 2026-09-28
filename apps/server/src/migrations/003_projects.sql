CREATE TABLE agent_platform.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
    description text CHECK (length(description) <= 2000),
    created_by uuid NOT NULL REFERENCES agent_platform.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON agent_platform.projects
    FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at();
CREATE INDEX projects_page_idx ON agent_platform.projects(created_at DESC, id DESC);

CREATE TABLE agent_platform.project_members (
    project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES agent_platform.users(id),
    role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(project_id, user_id)
);
CREATE INDEX project_members_user_idx ON agent_platform.project_members(user_id, project_id);
CREATE TRIGGER project_members_updated_at BEFORE UPDATE ON agent_platform.project_members
    FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at();

DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_platform_api') THEN
        GRANT SELECT ON agent_platform.projects, agent_platform.project_members TO agent_platform_api;
        GRANT INSERT(name, description, created_by) ON agent_platform.projects TO agent_platform_api;
        GRANT UPDATE(name, description) ON agent_platform.projects TO agent_platform_api;
        GRANT INSERT(project_id, user_id, role), UPDATE(role) ON agent_platform.project_members TO agent_platform_api;
    END IF;
END $$;
