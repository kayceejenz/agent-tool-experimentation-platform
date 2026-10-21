-- Hide deleted benchmark questions while retaining execution history.
ALTER TABLE agent_platform.tool_benchmarks ADD COLUMN deleted_at timestamptz;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT UPDATE(deleted_at) ON agent_platform.tool_benchmarks TO agent_platform_api;
 END IF;
END $$;
