CREATE FUNCTION agent_platform.notify_execution_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='queued' THEN
  PERFORM pg_notify('agent_execution_queue', '');
 END IF;
 RETURN NEW;
END;
$$;

CREATE FUNCTION agent_platform.notify_evaluation_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='queued' THEN
  PERFORM pg_notify('agent_evaluation_queue', '');
 END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER execution_queue_notification AFTER INSERT ON agent_platform.agent_executions
 FOR EACH ROW EXECUTE FUNCTION agent_platform.notify_execution_queue();

CREATE TRIGGER evaluation_queue_notification AFTER INSERT ON agent_platform.execution_evaluations
 FOR EACH ROW EXECUTE FUNCTION agent_platform.notify_evaluation_queue();
