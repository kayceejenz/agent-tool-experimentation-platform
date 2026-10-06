CREATE TABLE agent_platform.agent_executions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL,
 agent_revision integer NOT NULL,
 user_id uuid NOT NULL REFERENCES agent_platform.users(id),
 request_id uuid NOT NULL,
 input text NOT NULL,
 input_hash text NOT NULL,
 snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled','interrupted')),
 termination_reason text,
 final_answer text,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 heartbeat_at timestamptz,
 cancel_requested boolean NOT NULL DEFAULT false,
 FOREIGN KEY(agent_id,agent_revision) REFERENCES agent_platform.agent_revisions(agent_id,revision),
 UNIQUE(project_id,user_id,request_id)
);

CREATE INDEX agent_executions_page ON agent_platform.agent_executions(project_id,agent_id,created_at DESC);
CREATE INDEX agent_executions_queue ON agent_platform.agent_executions(created_at) WHERE status='queued';

CREATE TABLE agent_platform.execution_spans (
 id uuid PRIMARY KEY,
 execution_id uuid NOT NULL REFERENCES agent_platform.agent_executions(id) ON DELETE CASCADE,
 sequence integer NOT NULL CHECK(sequence>0),
 parent_id uuid,
 kind text NOT NULL CHECK(kind IN ('model','tool')),
 name text NOT NULL,
 call_id text,
 tool_id uuid,
 tool_revision integer,
 tool_execution_id uuid REFERENCES agent_platform.tool_executions(id),
 executor_request_id uuid,
 context_span_ids jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'running',
 inputs jsonb NOT NULL,
 outputs jsonb,
 error_code text,
 duration_ms integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(execution_id,sequence),
 UNIQUE(execution_id,id),
 FOREIGN KEY(execution_id,parent_id) REFERENCES agent_platform.execution_spans(execution_id,id)
);

CREATE INDEX execution_spans_tree ON agent_platform.execution_spans(execution_id,parent_id);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT SELECT,INSERT,UPDATE ON agent_platform.agent_executions,agent_platform.execution_spans TO agent_platform_api;
 END IF;
END $$;
