-- Preserve revisions and execution evidence when an agent is removed.
ALTER TABLE agent_platform.agents ADD COLUMN removed_at timestamptz;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT UPDATE(removed_at) ON agent_platform.agents TO agent_platform_api;
 END IF;
END $$;
