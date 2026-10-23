-- Retain execution evidence while excluding removed runs from benchmark reports.
ALTER TABLE agent_platform.agent_executions ADD COLUMN benchmark_removed_at timestamptz;
