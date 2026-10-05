CREATE TABLE agent_platform.prompts (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('system','agent','evaluation')),
    current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prompts_project_page ON agent_platform.prompts(project_id,created_at DESC,id DESC);

CREATE TABLE agent_platform.prompt_revisions (
    prompt_id uuid NOT NULL REFERENCES agent_platform.prompts(id) ON DELETE CASCADE,
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 32000),
    created_by uuid NOT NULL REFERENCES agent_platform.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(prompt_id,revision)
);

CREATE FUNCTION agent_platform.protect_prompt_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Prompt revisions are immutable';
END;
$$;

CREATE TRIGGER prompt_revision_immutable BEFORE UPDATE ON agent_platform.prompt_revisions
    FOR EACH ROW EXECUTE FUNCTION agent_platform.protect_prompt_revision();
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
        GRANT SELECT, INSERT ON agent_platform.prompts TO agent_platform_api;
        GRANT UPDATE(current_revision) ON agent_platform.prompts TO agent_platform_api;
        GRANT SELECT, INSERT ON agent_platform.prompt_revisions TO agent_platform_api;
    END IF;
END $$;
