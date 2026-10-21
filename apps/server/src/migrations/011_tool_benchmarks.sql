-- One verified manual call and question per benchmark. Runs reuse the existing queue.
CREATE TABLE agent_platform.tool_benchmarks (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
 capture_id uuid NOT NULL REFERENCES agent_platform.tool_executions(id),
 input text NOT NULL,
 tool_id uuid NOT NULL REFERENCES agent_platform.mcp_tools(id),
 tool_revision integer NOT NULL,
 tool_name text NOT NULL,
 server_name text NOT NULL,
 arguments jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES agent_platform.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_benchmarks_project ON agent_platform.tool_benchmarks(project_id,created_at);
ALTER TABLE agent_platform.agent_executions ADD COLUMN benchmark_id uuid REFERENCES agent_platform.tool_benchmarks(id);
CREATE INDEX benchmark_execution_latest ON agent_platform.agent_executions(benchmark_id,agent_id,agent_revision,created_at DESC) WHERE benchmark_id IS NOT NULL;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT SELECT,INSERT ON agent_platform.tool_benchmarks TO agent_platform_api;
 END IF;
END $$;
