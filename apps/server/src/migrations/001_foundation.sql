-- Shared timestamp trigger for future application tables.
-- The runner creates the schema and ledger and owns the transaction.
CREATE FUNCTION agent_platform.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
