-- Verifies a task's cryptographic audit chain entirely inside Postgres.
--
-- The hash chain is written by the log_cryptographic_audit() trigger, which
-- formats timestamps/JSON using Postgres's own ::text casts. Recomputing
-- the hash in Node from data fetched via Supabase's REST layer would use a
-- different serialization (ISO 8601 timestamps, re-encoded jsonb) and could
-- falsely report tampering on records that were never touched. Recomputing
-- inside Postgres, with the same casts the trigger used, avoids that.

create or replace function public.verify_task_audit_chain(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  previous_hash text := 'GENESIS';
  calculated_hash text;
  history_data text;
  checked integer := 0;
begin
  for rec in
    select th.id, th.task_id, th.user_id, th.event_type, th.task_snapshot, th.created_at,
           cal.prev_hash, cal.curr_hash
    from public.task_history th
    left join public.cryptographic_audit_log cal on cal.task_history_id = th.id
    where th.task_id = p_task_id
    order by th.created_at asc
  loop
    if rec.curr_hash is null then
      return jsonb_build_object(
        'valid', false, 'checkedRecords', checked, 'brokenAt', rec.id,
        'reason', 'Missing cryptographic audit record'
      );
    end if;

    if rec.prev_hash is distinct from previous_hash then
      return jsonb_build_object(
        'valid', false, 'checkedRecords', checked, 'brokenAt', rec.id,
        'reason', 'Previous hash mismatch'
      );
    end if;

    history_data :=
      rec.id::text
      || '|' || coalesce(rec.task_id::text, '')
      || '|' || coalesce(rec.user_id::text, '')
      || '|' || coalesce(rec.event_type, '')
      || '|' || coalesce(rec.task_snapshot::text, '')
      || '|' || rec.created_at::text
      || '|' || previous_hash;

calculated_hash := encode(
  extensions.digest(history_data, 'sha256'),
  'hex'
);    checked := checked + 1;

    if calculated_hash <> rec.curr_hash then
      return jsonb_build_object(
        'valid', false, 'checkedRecords', checked, 'brokenAt', rec.id,
        'reason', 'Current hash mismatch - possible tampering'
      );
    end if;

    previous_hash := rec.curr_hash;
  end loop;

  return jsonb_build_object('valid', true, 'checkedRecords', checked, 'brokenAt', null);
end;
$$;

grant execute on function public.verify_task_audit_chain(uuid) to authenticated, service_role;