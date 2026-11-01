CREATE TABLE agent_platform.datasets (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES agent_platform.projects(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 created_by uuid NOT NULL REFERENCES agent_platform.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_platform.dataset_files (
 id uuid PRIMARY KEY,
 dataset_id uuid NOT NULL REFERENCES agent_platform.datasets(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
 size_bytes bigint NOT NULL CHECK(size_bytes>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(dataset_id,name)
);
CREATE INDEX datasets_project_page ON agent_platform.datasets(project_id,created_at DESC,id DESC);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT SELECT,INSERT ON agent_platform.datasets,agent_platform.dataset_files TO agent_platform_api;
 END IF;
END $$;
