-- Enable SHA-256 hashing support
create extension if not exists pgcrypto;


-- Generate a cryptographic audit record whenever
-- a new task_history record is created.
CREATE OR REPLACE FUNCTION public.log_cryptographic_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  previous_hash text;
  current_hash text;
  history_data text;
BEGIN

  -- Get the previous audit hash for this task.
  SELECT cal.curr_hash
  INTO previous_hash
  FROM public.cryptographic_audit_log cal
  JOIN public.task_history previous_history
    ON previous_history.id = cal.task_history_id
  WHERE previous_history.task_id = NEW.task_id
  ORDER BY cal.created_at DESC
  LIMIT 1;

  -- First history entry for this task.
  IF previous_hash IS NULL THEN
    previous_hash := 'GENESIS';
  END IF;

  -- Create a deterministic representation of the history record.
  history_data :=
      NEW.id::text
      || '|'
      || COALESCE(NEW.task_id::text, '')
      || '|'
      || COALESCE(NEW.user_id::text, '')
      || '|'
      || COALESCE(NEW.event_type, '')
      || '|'
      || COALESCE(NEW.task_snapshot::text, '')
      || '|'
      || NEW.created_at::text
      || '|'
      || previous_hash;

  -- SHA-256 hash.
  current_hash :=
  encode(
    extensions.digest(history_data, 'sha256'),
    'hex'
  );

  -- Store the hash-chain record.
  INSERT INTO public.cryptographic_audit_log (
    task_history_id,
    prev_hash,
    curr_hash,
    created_at
  )
  VALUES (
    NEW.id,
    previous_hash,
    current_hash,
    NEW.created_at
  );

  RETURN NEW;
END;
$function$;


-- Remove the trigger if it already exists,
-- so the migration is safe to run again.
DROP TRIGGER IF EXISTS task_history_crypto_audit_trigger
ON public.task_history;


-- Run crypto hashing AFTER the existing task history trigger.
CREATE TRIGGER task_history_crypto_audit_trigger
AFTER INSERT ON public.task_history
FOR EACH ROW
EXECUTE FUNCTION public.log_cryptographic_audit();