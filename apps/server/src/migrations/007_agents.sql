CREATE TABLE agent_platform.agents (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
    current_revision integer NOT NULL DEFAULT 1 CHECK(current_revision>0),
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agents_project_page ON agent_platform.agents(project_id,created_at DESC,id DESC);

CREATE TABLE agent_platform.agent_revisions (
    agent_id uuid NOT NULL REFERENCES agent_platform.agents(id) ON DELETE CASCADE,
    revision integer NOT NULL CHECK(revision>0),
    name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
    description text NOT NULL CHECK(length(description)<=2000),
    system_prompt_id uuid,
    system_prompt_revision integer,
    agent_prompt_id uuid,
    agent_prompt_revision integer,
    model_settings jsonb NOT NULL,
    limits jsonb NOT NULL,
    created_by uuid NOT NULL REFERENCES agent_platform.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(agent_id,revision),
    FOREIGN KEY(system_prompt_id,system_prompt_revision) REFERENCES agent_platform.prompt_revisions(prompt_id,revision) MATCH FULL,
    FOREIGN KEY(agent_prompt_id,agent_prompt_revision) REFERENCES agent_platform.prompt_revisions(prompt_id,revision) MATCH FULL
);

CREATE TABLE agent_platform.agent_revision_tools (
    agent_id uuid NOT NULL,
    agent_revision integer NOT NULL,
    tool_id uuid NOT NULL,
    tool_revision integer NOT NULL,
    PRIMARY KEY(agent_id,agent_revision,tool_id),
    FOREIGN KEY(agent_id,agent_revision) REFERENCES agent_platform.agent_revisions(agent_id,revision) ON DELETE CASCADE,
    FOREIGN KEY(tool_id,tool_revision) REFERENCES agent_platform.tool_revisions(tool_id,revision)
);

CREATE FUNCTION agent_platform.protect_agent_revision() RETURNS trigger LANGUAGE plpgsql AS $$

BEGIN
    RAISE EXCEPTION 'Agent revisions and tool bindings are immutable';
END;
$$;

CREATE TRIGGER agent_revision_immutable BEFORE UPDATE ON agent_platform.agent_revisions
 FOR EACH ROW EXECUTE FUNCTION agent_platform.protect_agent_revision();

CREATE TRIGGER agent_revision_tools_immutable BEFORE UPDATE ON agent_platform.agent_revision_tools
 FOR EACH ROW EXECUTE FUNCTION agent_platform.protect_agent_revision();

DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT SELECT,INSERT ON agent_platform.agents TO agent_platform_api;

  GRANT UPDATE(current_revision,enabled) ON agent_platform.agents TO agent_platform_api;

  GRANT SELECT,INSERT ON agent_platform.agent_revisions,agent_platform.agent_revision_tools TO agent_platform_api;
  
 END IF;
END $$;
