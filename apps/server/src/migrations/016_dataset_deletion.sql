-- File metadata is removed by the dataset foreign key cascade.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='agent_platform_api') THEN
  GRANT DELETE ON agent_platform.datasets TO agent_platform_api;
 END IF;
END $$;
