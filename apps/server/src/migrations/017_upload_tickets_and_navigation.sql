ALTER TABLE agent_platform.projects ADD COLUMN hidden_sections text[] NOT NULL DEFAULT '{}'
 CHECK (hidden_sections <@ ARRAY['datasets','servers','tools','prompts','agents','benchmarks']::text[]);

CREATE TABLE agent_platform.dataset_upload_tickets (
 token_hash text PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES agent_platform.users(id) ON DELETE CASCADE,
 token_version integer NOT NULL,
 origin text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

CREATE INDEX dataset_upload_tickets_expiry ON agent_platform.dataset_upload_tickets(expires_at);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT UPDATE(hidden_sections) ON agent_platform.projects TO agent_platform_api;
  GRANT SELECT, INSERT, DELETE ON agent_platform.dataset_upload_tickets TO agent_platform_api;
 END IF;
END $$;
