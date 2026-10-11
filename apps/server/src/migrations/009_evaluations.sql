ALTER TABLE agent_platform.agent_revisions ADD COLUMN evaluation_profile jsonb NOT NULL DEFAULT '{"enabled":true,"prompt":null,"model":null}';

ALTER TABLE agent_platform.execution_spans ADD COLUMN model_visible_output text;

CREATE TABLE agent_platform.execution_evaluations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES agent_platform.agent_executions(id) ON DELETE CASCADE,
 attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0),
 request_id uuid,
 requested_by uuid NOT NULL REFERENCES agent_platform.users(id),
 profile jsonb NOT NULL,
 expectations jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 evidence_hash text,
 evidence_version integer NOT NULL DEFAULT 1,
 metrics jsonb,
 report jsonb,
 usage jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 UNIQUE(execution_id,attempt),
 UNIQUE(execution_id,request_id)
);

CREATE INDEX evaluation_queue ON agent_platform.execution_evaluations(created_at) WHERE status='queued';

CREATE FUNCTION agent_platform.queue_execution_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('completed','failed','cancelled','interrupted') AND OLD.status IN ('queued','running')
 AND COALESCE((NEW.snapshot->'evaluation_profile'->>'enabled')::boolean,false) THEN
  INSERT INTO agent_platform.execution_evaluations(execution_id,profile,expectations,requested_by)
  VALUES(NEW.id,NEW.snapshot->'evaluation_profile',NEW.snapshot->'expectations',NEW.user_id) ON CONFLICT(execution_id,attempt) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER execution_evaluation_queue AFTER UPDATE OF status ON agent_platform.agent_executions
 FOR EACH ROW EXECUTE FUNCTION agent_platform.queue_execution_evaluation();
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT SELECT,INSERT,UPDATE ON agent_platform.execution_evaluations TO agent_platform_api;
 END IF;
END $$;
