drop extension if exists "pg_net";

create type "public"."priority_level" as enum ('low', 'medium', 'high', 'critical');

create type "public"."role_type" as enum ('admin', 'editor', 'viewer');

create type "public"."state_type" as enum ('active', 'waiting', 'done');

create type "public"."status_type" as enum ('to_do', 'in_progress', 'waiting', 'blocked', 'done');


  create table "public"."app_user" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "email" text not null,
    "job_role_id" text
      );


alter table "public"."app_user" enable row level security;


  create table "public"."cryptographic_audit_log" (
    "id" uuid not null default gen_random_uuid(),
    "task_history_id" uuid,
    "prev_hash" text not null,
    "curr_hash" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."cryptographic_audit_log" enable row level security;


  create table "public"."delay_cause" (
    "id" uuid not null default gen_random_uuid(),
    "name" text
      );


alter table "public"."delay_cause" enable row level security;


  create table "public"."project" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "workspace_id" uuid,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "deleted_at" timestamp with time zone,
    "description" text,
    "is_deleted" boolean not null default false
      );


alter table "public"."project" enable row level security;


  create table "public"."project_insights" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid,
    "insight_type" text not null,
    "entity_type" text,
    "entity_id" uuid,
    "score" numeric,
    "metrics" jsonb,
    "narrative" text,
    "computed_at" timestamp with time zone default now()
      );


alter table "public"."project_insights" enable row level security;


  create table "public"."project_members" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid,
    "user_id" uuid,
    "role" public.role_type not null default 'viewer'::public.role_type
      );


alter table "public"."project_members" enable row level security;


  create table "public"."section" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid,
    "name" text not null,
    "position" integer not null,
    "created_at" timestamp with time zone default now(),
    "description" text,
    "deleted_at" timestamp with time zone,
    "is_deleted" boolean not null default false
      );


alter table "public"."section" enable row level security;


  create table "public"."task" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "description" text,
    "project_id" uuid,
    "section_id" uuid,
    "delay_cause_id" uuid,
    "parent_task_id" uuid,
    "priority" public.priority_level not null,
    "risk_score" integer not null default 0,
    "start_date" timestamp with time zone,
    "due_date" timestamp with time zone,
    "position" integer,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "is_deleted" boolean default false,
    "status" public.status_type not null default 'to_do'::public.status_type
      );


alter table "public"."task" enable row level security;


  create table "public"."task_assignees" (
    "id" uuid not null default gen_random_uuid(),
    "task_id" uuid,
    "user_id" uuid
      );


alter table "public"."task_assignees" enable row level security;


  create table "public"."task_comments" (
    "id" uuid not null default gen_random_uuid(),
    "task_id" uuid,
    "user_id" uuid,
    "comment" text not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone
      );


alter table "public"."task_comments" enable row level security;


  create table "public"."task_dependencies" (
    "id" uuid not null default gen_random_uuid(),
    "blocking_task_id" uuid,
    "blocked_task_id" uuid,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."task_dependencies" enable row level security;


  create table "public"."task_history" (
    "id" uuid not null default gen_random_uuid(),
    "task_id" uuid,
    "task_snapshot" jsonb,
    "user_id" uuid,
    "event_type" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."task_history" enable row level security;


  create table "public"."workflow_event" (
    "id" uuid not null default gen_random_uuid(),
    "task_id" uuid,
    "project_id" uuid,
    "user_id" uuid,
    "event_type" text not null,
    "from_value" text,
    "to_value" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."workflow_event" enable row level security;


  create table "public"."workspace" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "owner_user_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."workspace" enable row level security;


  create table "public"."workspace_members" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid,
    "user_id" uuid,
    "role" public.role_type not null default 'viewer'::public.role_type,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."workspace_members" enable row level security;

CREATE UNIQUE INDEX app_user_email_key ON public.app_user USING btree (email);

CREATE UNIQUE INDEX app_user_pkey ON public.app_user USING btree (id);

CREATE UNIQUE INDEX cryptographic_audit_log_pkey ON public.cryptographic_audit_log USING btree (id);

CREATE UNIQUE INDEX delay_cause_name_key ON public.delay_cause USING btree (name);

CREATE UNIQUE INDEX delay_cause_pkey ON public.delay_cause USING btree (id);

CREATE INDEX idx_project_members_user ON public.project_members USING btree (user_id);

CREATE INDEX idx_task_parent ON public.task USING btree (parent_task_id);

CREATE INDEX idx_task_project ON public.task USING btree (project_id);

CREATE INDEX idx_workspace_members_user ON public.workspace_members USING btree (user_id);

CREATE UNIQUE INDEX one_workspace_per_user ON public.workspace USING btree (owner_user_id);

CREATE UNIQUE INDEX project_insights_pkey ON public.project_insights USING btree (id);

CREATE UNIQUE INDEX project_members_pkey ON public.project_members USING btree (id);

CREATE UNIQUE INDEX project_members_unique ON public.project_members USING btree (project_id, user_id);

CREATE UNIQUE INDEX project_name_unique_active ON public.project USING btree (workspace_id, name) WHERE (is_deleted = false);

CREATE UNIQUE INDEX project_pkey ON public.project USING btree (id);

CREATE UNIQUE INDEX section_id_project_unique ON public.section USING btree (id, project_id);

CREATE UNIQUE INDEX section_name_unique_active ON public.section USING btree (project_id, name) WHERE (is_deleted = false);

CREATE UNIQUE INDEX section_pkey ON public.section USING btree (id);

CREATE UNIQUE INDEX section_project_position_unique ON public.section USING btree (project_id, "position");

CREATE UNIQUE INDEX task_assignees_pkey ON public.task_assignees USING btree (id);

CREATE UNIQUE INDEX task_assignees_unique ON public.task_assignees USING btree (task_id, user_id);

CREATE UNIQUE INDEX task_comments_pkey ON public.task_comments USING btree (id);

CREATE UNIQUE INDEX task_dependencies_pkey ON public.task_dependencies USING btree (id);

CREATE UNIQUE INDEX task_dependencies_unique ON public.task_dependencies USING btree (blocking_task_id, blocked_task_id);

CREATE UNIQUE INDEX task_history_pkey ON public.task_history USING btree (id);

CREATE UNIQUE INDEX task_pkey ON public.task USING btree (id);

CREATE UNIQUE INDEX task_section_position_unique ON public.task USING btree (section_id, "position");

CREATE UNIQUE INDEX task_title_unique_active ON public.task USING btree (project_id, title) WHERE (is_deleted = false);

CREATE UNIQUE INDEX workflow_event_pkey ON public.workflow_event USING btree (id);

CREATE UNIQUE INDEX workspace_members_pkey ON public.workspace_members USING btree (id);

CREATE UNIQUE INDEX workspace_members_unique ON public.workspace_members USING btree (workspace_id, user_id);

CREATE UNIQUE INDEX workspace_pkey ON public.workspace USING btree (id);

alter table "public"."app_user" add constraint "app_user_pkey" PRIMARY KEY using index "app_user_pkey";

alter table "public"."cryptographic_audit_log" add constraint "cryptographic_audit_log_pkey" PRIMARY KEY using index "cryptographic_audit_log_pkey";

alter table "public"."delay_cause" add constraint "delay_cause_pkey" PRIMARY KEY using index "delay_cause_pkey";

alter table "public"."project" add constraint "project_pkey" PRIMARY KEY using index "project_pkey";

alter table "public"."project_insights" add constraint "project_insights_pkey" PRIMARY KEY using index "project_insights_pkey";

alter table "public"."project_members" add constraint "project_members_pkey" PRIMARY KEY using index "project_members_pkey";

alter table "public"."section" add constraint "section_pkey" PRIMARY KEY using index "section_pkey";

alter table "public"."task" add constraint "task_pkey" PRIMARY KEY using index "task_pkey";

alter table "public"."task_assignees" add constraint "task_assignees_pkey" PRIMARY KEY using index "task_assignees_pkey";

alter table "public"."task_comments" add constraint "task_comments_pkey" PRIMARY KEY using index "task_comments_pkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_pkey" PRIMARY KEY using index "task_dependencies_pkey";

alter table "public"."task_history" add constraint "task_history_pkey" PRIMARY KEY using index "task_history_pkey";

alter table "public"."workflow_event" add constraint "workflow_event_pkey" PRIMARY KEY using index "workflow_event_pkey";

alter table "public"."workspace" add constraint "workspace_pkey" PRIMARY KEY using index "workspace_pkey";

alter table "public"."workspace_members" add constraint "workspace_members_pkey" PRIMARY KEY using index "workspace_members_pkey";

alter table "public"."app_user" add constraint "app_user_email_key" UNIQUE using index "app_user_email_key";

alter table "public"."cryptographic_audit_log" add constraint "cryptographic_audit_log_task_history_id_fkey" FOREIGN KEY (task_history_id) REFERENCES public.task_history(id) not valid;

alter table "public"."cryptographic_audit_log" validate constraint "cryptographic_audit_log_task_history_id_fkey";

alter table "public"."delay_cause" add constraint "delay_cause_name_key" UNIQUE using index "delay_cause_name_key";

alter table "public"."project" add constraint "project_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.app_user(id) not valid;

alter table "public"."project" validate constraint "project_created_by_fkey";

alter table "public"."project" add constraint "project_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) not valid;

alter table "public"."project" validate constraint "project_workspace_id_fkey";

alter table "public"."project_insights" add constraint "project_insights_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.project(id) not valid;

alter table "public"."project_insights" validate constraint "project_insights_project_id_fkey";

alter table "public"."project_members" add constraint "project_members_project_id_fk" FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE not valid;

alter table "public"."project_members" validate constraint "project_members_project_id_fk";

alter table "public"."project_members" add constraint "project_members_unique" UNIQUE using index "project_members_unique";

alter table "public"."project_members" add constraint "project_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."project_members" validate constraint "project_members_user_id_fkey";

alter table "public"."section" add constraint "section_project_id_fk" FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE not valid;

alter table "public"."section" validate constraint "section_project_id_fk";

alter table "public"."section" add constraint "section_project_position_unique" UNIQUE using index "section_project_position_unique" DEFERRABLE INITIALLY DEFERRED;

alter table "public"."task" add constraint "task_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.app_user(id) not valid;

alter table "public"."task" validate constraint "task_created_by_fkey";

alter table "public"."task" add constraint "task_delay_cause_id_fkey" FOREIGN KEY (delay_cause_id) REFERENCES public.delay_cause(id) not valid;

alter table "public"."task" validate constraint "task_delay_cause_id_fkey";

alter table "public"."task" add constraint "task_parent_task_id_fkey" FOREIGN KEY (parent_task_id) REFERENCES public.task(id) ON DELETE SET NULL not valid;

alter table "public"."task" validate constraint "task_parent_task_id_fkey";

alter table "public"."task" add constraint "task_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE not valid;

alter table "public"."task" validate constraint "task_project_id_fkey";

alter table "public"."task" add constraint "task_section_id_fkey" FOREIGN KEY (section_id) REFERENCES public.section(id) not valid;

alter table "public"."task" validate constraint "task_section_id_fkey";

alter table "public"."task" add constraint "task_section_position_unique" UNIQUE using index "task_section_position_unique" DEFERRABLE INITIALLY DEFERRED;

alter table "public"."task" add constraint "task_section_same_project" FOREIGN KEY (section_id, project_id) REFERENCES public.section(id, project_id) ON DELETE RESTRICT not valid;

alter table "public"."task" validate constraint "task_section_same_project";

alter table "public"."task_assignees" add constraint "task_assignees_task_id_fkey" FOREIGN KEY (task_id) REFERENCES public.task(id) ON DELETE CASCADE not valid;

alter table "public"."task_assignees" validate constraint "task_assignees_task_id_fkey";

alter table "public"."task_assignees" add constraint "task_assignees_unique" UNIQUE using index "task_assignees_unique";

alter table "public"."task_assignees" add constraint "task_assignees_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."task_assignees" validate constraint "task_assignees_user_id_fkey";

alter table "public"."task_comments" add constraint "task_comments_task_id_fkey" FOREIGN KEY (task_id) REFERENCES public.task(id) ON DELETE CASCADE not valid;

alter table "public"."task_comments" validate constraint "task_comments_task_id_fkey";

alter table "public"."task_comments" add constraint "task_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."task_comments" validate constraint "task_comments_user_id_fkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_blocked_task_id_fkey" FOREIGN KEY (blocked_task_id) REFERENCES public.task(id) not valid;

alter table "public"."task_dependencies" validate constraint "task_dependencies_blocked_task_id_fkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_blocking_task_id_fkey" FOREIGN KEY (blocking_task_id) REFERENCES public.task(id) not valid;

alter table "public"."task_dependencies" validate constraint "task_dependencies_blocking_task_id_fkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_unique" UNIQUE using index "task_dependencies_unique";

alter table "public"."task_dependencies" add constraint "valid_dependency_pair" CHECK (((blocking_task_id <> blocked_task_id) AND (blocking_task_id IS NOT NULL) AND (blocked_task_id IS NOT NULL))) not valid;

alter table "public"."task_dependencies" validate constraint "valid_dependency_pair";

alter table "public"."task_history" add constraint "task_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."task_history" validate constraint "task_history_user_id_fkey";

alter table "public"."workflow_event" add constraint "workflow_event_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.project(id) not valid;

alter table "public"."workflow_event" validate constraint "workflow_event_project_id_fkey";

alter table "public"."workflow_event" add constraint "workflow_event_task_id_fkey" FOREIGN KEY (task_id) REFERENCES public.task(id) not valid;

alter table "public"."workflow_event" validate constraint "workflow_event_task_id_fkey";

alter table "public"."workflow_event" add constraint "workflow_event_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."workflow_event" validate constraint "workflow_event_user_id_fkey";

alter table "public"."workspace" add constraint "one_workspace_per_user" UNIQUE using index "one_workspace_per_user";

alter table "public"."workspace" add constraint "workspace_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES public.app_user(id) not valid;

alter table "public"."workspace" validate constraint "workspace_owner_user_id_fkey";

alter table "public"."workspace_members" add constraint "workspace_members_unique" UNIQUE using index "workspace_members_unique";

alter table "public"."workspace_members" add constraint "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE not valid;

alter table "public"."workspace_members" validate constraint "workspace_members_user_id_fkey";

alter table "public"."workspace_members" add constraint "workspace_members_workspace_id_fk" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE not valid;

alter table "public"."workspace_members" validate constraint "workspace_members_workspace_id_fk";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_project_member_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if not exists (
    select 1
    from workspace_members wm
    join project p on p.workspace_id = wm.workspace_id
    where wm.user_id = new.user_id
      and p.id = new.project_id
  ) then
    raise exception 'User is not part of this workspace';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_task_assignee_project()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if not exists (
    select 1
    from project_members pm
    join task t on t.project_id = pm.project_id
    where pm.user_id = new.user_id
      and t.id = new.task_id
  ) then
    raise exception 'Assignee is not part of this project';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.compact_section_positions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  with ordered as (
    select id,
           row_number() over (
             partition by project_id
             order by position
           ) as new_pos
    from section
    where project_id = old.project_id
      and is_deleted = false
  )
  update section s
  set position = o.new_pos
  from ordered o
  where s.id = o.id;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.compact_task_positions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update task
  set position = position - 1
  where section_id = old.section_id
    and is_deleted = false
    and position > old.position;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.detach_tasks_on_section_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update task
  set section_id = null
  where section_id = old.id;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_workspace_id uuid;
begin
  -- create app_user
  insert into app_user (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  -- create workspace
  insert into workspace (name, owner_user_id)
  values ('My Workspace', new.id)
  returning id into new_workspace_id;

  -- add as admin member
  insert into workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'admin')
  on conflict do nothing;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_task_assignee_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin

  if (tg_op = 'INSERT') then
    insert into workflow_event (
      task_id,
      project_id,
      user_id,
      event_type,
      from_value,
      to_value
    )
    select
      new.task_id,
      t.project_id,
      new.user_id,
      'assignee_added',
      null,
      new.user_id::text
    from task t
    where t.id = new.task_id;

    return new;
  end if;

  if (tg_op = 'DELETE') then
    insert into workflow_event (
      task_id,
      project_id,
      user_id,
      event_type,
      from_value,
      to_value
    )
    select
      old.task_id,
      t.project_id,
      old.user_id,
      'assignee_removed',
      old.user_id::text,
      null
    from task t
    where t.id = old.task_id;

    return old;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_task_history()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin

  insert into task_history (
    task_id,
    user_id,
    event_type,
    task_snapshot,
    created_at
  )
  values (
    coalesce(new.id, old.id),
    coalesce(new.created_by, old.created_by),

    case
      when tg_op = 'INSERT' then 'created'

      when tg_op = 'DELETE' then 'deleted'

      when tg_op = 'UPDATE'
           and new.is_deleted = true
           and old.is_deleted = false
        then 'deleted'

      when tg_op = 'UPDATE'
        then 'updated'
    end,

    to_jsonb(coalesce(new, old)),
    now()
  );

  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_section_position()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.position is null then
    select coalesce(max(position),0) + 1
    into new.position
    from section
    where project_id = new.project_id
      and is_deleted = false;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_task_position()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.position is null then
    select coalesce(max(position),0) + 1
    into new.position
    from task
    where section_id = new.section_id
      and is_deleted = false;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.soft_delete_project_cascade()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin

  update section
  set is_deleted = true,
      deleted_at = now()
  where project_id = new.id;

  update task
  set is_deleted = true,
      deleted_at = now()
  where project_id = new.id;

  return new;
end;
$function$
;

grant delete on table "public"."app_user" to "anon";

grant insert on table "public"."app_user" to "anon";

grant select on table "public"."app_user" to "anon";

grant update on table "public"."app_user" to "anon";

grant delete on table "public"."app_user" to "authenticated";

grant insert on table "public"."app_user" to "authenticated";

grant select on table "public"."app_user" to "authenticated";

grant update on table "public"."app_user" to "authenticated";

grant delete on table "public"."app_user" to "service_role";

grant insert on table "public"."app_user" to "service_role";

grant references on table "public"."app_user" to "service_role";

grant select on table "public"."app_user" to "service_role";

grant trigger on table "public"."app_user" to "service_role";

grant truncate on table "public"."app_user" to "service_role";

grant update on table "public"."app_user" to "service_role";

grant delete on table "public"."cryptographic_audit_log" to "anon";

grant insert on table "public"."cryptographic_audit_log" to "anon";

grant select on table "public"."cryptographic_audit_log" to "anon";

grant update on table "public"."cryptographic_audit_log" to "anon";

grant delete on table "public"."cryptographic_audit_log" to "authenticated";

grant insert on table "public"."cryptographic_audit_log" to "authenticated";

grant select on table "public"."cryptographic_audit_log" to "authenticated";

grant update on table "public"."cryptographic_audit_log" to "authenticated";

grant delete on table "public"."cryptographic_audit_log" to "service_role";

grant insert on table "public"."cryptographic_audit_log" to "service_role";

grant references on table "public"."cryptographic_audit_log" to "service_role";

grant select on table "public"."cryptographic_audit_log" to "service_role";

grant trigger on table "public"."cryptographic_audit_log" to "service_role";

grant truncate on table "public"."cryptographic_audit_log" to "service_role";

grant update on table "public"."cryptographic_audit_log" to "service_role";

grant delete on table "public"."delay_cause" to "anon";

grant insert on table "public"."delay_cause" to "anon";

grant select on table "public"."delay_cause" to "anon";

grant update on table "public"."delay_cause" to "anon";

grant delete on table "public"."delay_cause" to "authenticated";

grant insert on table "public"."delay_cause" to "authenticated";

grant select on table "public"."delay_cause" to "authenticated";

grant update on table "public"."delay_cause" to "authenticated";

grant delete on table "public"."delay_cause" to "service_role";

grant insert on table "public"."delay_cause" to "service_role";

grant references on table "public"."delay_cause" to "service_role";

grant select on table "public"."delay_cause" to "service_role";

grant trigger on table "public"."delay_cause" to "service_role";

grant truncate on table "public"."delay_cause" to "service_role";

grant update on table "public"."delay_cause" to "service_role";

grant delete on table "public"."project" to "anon";

grant insert on table "public"."project" to "anon";

grant select on table "public"."project" to "anon";

grant update on table "public"."project" to "anon";

grant delete on table "public"."project" to "authenticated";

grant insert on table "public"."project" to "authenticated";

grant select on table "public"."project" to "authenticated";

grant update on table "public"."project" to "authenticated";

grant delete on table "public"."project" to "service_role";

grant insert on table "public"."project" to "service_role";

grant references on table "public"."project" to "service_role";

grant select on table "public"."project" to "service_role";

grant trigger on table "public"."project" to "service_role";

grant truncate on table "public"."project" to "service_role";

grant update on table "public"."project" to "service_role";

grant delete on table "public"."project_insights" to "anon";

grant insert on table "public"."project_insights" to "anon";

grant references on table "public"."project_insights" to "anon";

grant select on table "public"."project_insights" to "anon";

grant trigger on table "public"."project_insights" to "anon";

grant truncate on table "public"."project_insights" to "anon";

grant update on table "public"."project_insights" to "anon";

grant delete on table "public"."project_insights" to "authenticated";

grant insert on table "public"."project_insights" to "authenticated";

grant references on table "public"."project_insights" to "authenticated";

grant select on table "public"."project_insights" to "authenticated";

grant trigger on table "public"."project_insights" to "authenticated";

grant truncate on table "public"."project_insights" to "authenticated";

grant update on table "public"."project_insights" to "authenticated";

grant delete on table "public"."project_insights" to "service_role";

grant insert on table "public"."project_insights" to "service_role";

grant references on table "public"."project_insights" to "service_role";

grant select on table "public"."project_insights" to "service_role";

grant trigger on table "public"."project_insights" to "service_role";

grant truncate on table "public"."project_insights" to "service_role";

grant update on table "public"."project_insights" to "service_role";

grant delete on table "public"."project_members" to "anon";

grant insert on table "public"."project_members" to "anon";

grant select on table "public"."project_members" to "anon";

grant update on table "public"."project_members" to "anon";

grant delete on table "public"."project_members" to "authenticated";

grant insert on table "public"."project_members" to "authenticated";

grant select on table "public"."project_members" to "authenticated";

grant update on table "public"."project_members" to "authenticated";

grant delete on table "public"."project_members" to "service_role";

grant insert on table "public"."project_members" to "service_role";

grant references on table "public"."project_members" to "service_role";

grant select on table "public"."project_members" to "service_role";

grant trigger on table "public"."project_members" to "service_role";

grant truncate on table "public"."project_members" to "service_role";

grant update on table "public"."project_members" to "service_role";

grant delete on table "public"."section" to "anon";

grant insert on table "public"."section" to "anon";

grant select on table "public"."section" to "anon";

grant update on table "public"."section" to "anon";

grant delete on table "public"."section" to "authenticated";

grant insert on table "public"."section" to "authenticated";

grant select on table "public"."section" to "authenticated";

grant update on table "public"."section" to "authenticated";

grant delete on table "public"."section" to "service_role";

grant insert on table "public"."section" to "service_role";

grant references on table "public"."section" to "service_role";

grant select on table "public"."section" to "service_role";

grant trigger on table "public"."section" to "service_role";

grant truncate on table "public"."section" to "service_role";

grant update on table "public"."section" to "service_role";

grant delete on table "public"."task" to "anon";

grant insert on table "public"."task" to "anon";

grant select on table "public"."task" to "anon";

grant update on table "public"."task" to "anon";

grant delete on table "public"."task" to "authenticated";

grant insert on table "public"."task" to "authenticated";

grant select on table "public"."task" to "authenticated";

grant update on table "public"."task" to "authenticated";

grant delete on table "public"."task" to "service_role";

grant insert on table "public"."task" to "service_role";

grant references on table "public"."task" to "service_role";

grant select on table "public"."task" to "service_role";

grant trigger on table "public"."task" to "service_role";

grant truncate on table "public"."task" to "service_role";

grant update on table "public"."task" to "service_role";

grant delete on table "public"."task_assignees" to "anon";

grant insert on table "public"."task_assignees" to "anon";

grant select on table "public"."task_assignees" to "anon";

grant update on table "public"."task_assignees" to "anon";

grant delete on table "public"."task_assignees" to "authenticated";

grant insert on table "public"."task_assignees" to "authenticated";

grant select on table "public"."task_assignees" to "authenticated";

grant update on table "public"."task_assignees" to "authenticated";

grant delete on table "public"."task_assignees" to "service_role";

grant insert on table "public"."task_assignees" to "service_role";

grant references on table "public"."task_assignees" to "service_role";

grant select on table "public"."task_assignees" to "service_role";

grant trigger on table "public"."task_assignees" to "service_role";

grant truncate on table "public"."task_assignees" to "service_role";

grant update on table "public"."task_assignees" to "service_role";

grant delete on table "public"."task_comments" to "anon";

grant insert on table "public"."task_comments" to "anon";

grant select on table "public"."task_comments" to "anon";

grant update on table "public"."task_comments" to "anon";

grant delete on table "public"."task_comments" to "authenticated";

grant insert on table "public"."task_comments" to "authenticated";

grant select on table "public"."task_comments" to "authenticated";

grant update on table "public"."task_comments" to "authenticated";

grant delete on table "public"."task_comments" to "service_role";

grant insert on table "public"."task_comments" to "service_role";

grant references on table "public"."task_comments" to "service_role";

grant select on table "public"."task_comments" to "service_role";

grant trigger on table "public"."task_comments" to "service_role";

grant truncate on table "public"."task_comments" to "service_role";

grant update on table "public"."task_comments" to "service_role";

grant delete on table "public"."task_dependencies" to "anon";

grant insert on table "public"."task_dependencies" to "anon";

grant select on table "public"."task_dependencies" to "anon";

grant update on table "public"."task_dependencies" to "anon";

grant delete on table "public"."task_dependencies" to "authenticated";

grant insert on table "public"."task_dependencies" to "authenticated";

grant select on table "public"."task_dependencies" to "authenticated";

grant update on table "public"."task_dependencies" to "authenticated";

grant delete on table "public"."task_dependencies" to "service_role";

grant insert on table "public"."task_dependencies" to "service_role";

grant references on table "public"."task_dependencies" to "service_role";

grant select on table "public"."task_dependencies" to "service_role";

grant trigger on table "public"."task_dependencies" to "service_role";

grant truncate on table "public"."task_dependencies" to "service_role";

grant update on table "public"."task_dependencies" to "service_role";

grant delete on table "public"."task_history" to "anon";

grant insert on table "public"."task_history" to "anon";

grant select on table "public"."task_history" to "anon";

grant update on table "public"."task_history" to "anon";

grant delete on table "public"."task_history" to "authenticated";

grant insert on table "public"."task_history" to "authenticated";

grant select on table "public"."task_history" to "authenticated";

grant update on table "public"."task_history" to "authenticated";

grant delete on table "public"."task_history" to "service_role";

grant insert on table "public"."task_history" to "service_role";

grant references on table "public"."task_history" to "service_role";

grant select on table "public"."task_history" to "service_role";

grant trigger on table "public"."task_history" to "service_role";

grant truncate on table "public"."task_history" to "service_role";

grant update on table "public"."task_history" to "service_role";

grant delete on table "public"."workflow_event" to "anon";

grant insert on table "public"."workflow_event" to "anon";

grant references on table "public"."workflow_event" to "anon";

grant select on table "public"."workflow_event" to "anon";

grant trigger on table "public"."workflow_event" to "anon";

grant truncate on table "public"."workflow_event" to "anon";

grant update on table "public"."workflow_event" to "anon";

grant delete on table "public"."workflow_event" to "authenticated";

grant insert on table "public"."workflow_event" to "authenticated";

grant references on table "public"."workflow_event" to "authenticated";

grant select on table "public"."workflow_event" to "authenticated";

grant trigger on table "public"."workflow_event" to "authenticated";

grant truncate on table "public"."workflow_event" to "authenticated";

grant update on table "public"."workflow_event" to "authenticated";

grant delete on table "public"."workflow_event" to "service_role";

grant insert on table "public"."workflow_event" to "service_role";

grant references on table "public"."workflow_event" to "service_role";

grant select on table "public"."workflow_event" to "service_role";

grant trigger on table "public"."workflow_event" to "service_role";

grant truncate on table "public"."workflow_event" to "service_role";

grant update on table "public"."workflow_event" to "service_role";

grant delete on table "public"."workspace" to "anon";

grant insert on table "public"."workspace" to "anon";

grant select on table "public"."workspace" to "anon";

grant update on table "public"."workspace" to "anon";

grant delete on table "public"."workspace" to "authenticated";

grant insert on table "public"."workspace" to "authenticated";

grant select on table "public"."workspace" to "authenticated";

grant update on table "public"."workspace" to "authenticated";

grant delete on table "public"."workspace" to "service_role";

grant insert on table "public"."workspace" to "service_role";

grant references on table "public"."workspace" to "service_role";

grant select on table "public"."workspace" to "service_role";

grant trigger on table "public"."workspace" to "service_role";

grant truncate on table "public"."workspace" to "service_role";

grant update on table "public"."workspace" to "service_role";

grant delete on table "public"."workspace_members" to "anon";

grant insert on table "public"."workspace_members" to "anon";

grant select on table "public"."workspace_members" to "anon";

grant update on table "public"."workspace_members" to "anon";

grant delete on table "public"."workspace_members" to "authenticated";

grant insert on table "public"."workspace_members" to "authenticated";

grant select on table "public"."workspace_members" to "authenticated";

grant update on table "public"."workspace_members" to "authenticated";

grant delete on table "public"."workspace_members" to "service_role";

grant insert on table "public"."workspace_members" to "service_role";

grant references on table "public"."workspace_members" to "service_role";

grant select on table "public"."workspace_members" to "service_role";

grant trigger on table "public"."workspace_members" to "service_role";

grant truncate on table "public"."workspace_members" to "service_role";

grant update on table "public"."workspace_members" to "service_role";


  create policy "allow all for demo"
  on "public"."app_user"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."cryptographic_audit_log"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."delay_cause"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."project"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "project members can access project"
  on "public"."project"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.project_id = project.id) AND (pm.user_id = auth.uid())))));



  create policy "allow all for demo"
  on "public"."project_members"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."section"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "project members can access sections"
  on "public"."section"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.project_id = section.project_id) AND (pm.user_id = auth.uid())))));



  create policy "allow all for demo"
  on "public"."task"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "project members can access tasks"
  on "public"."task"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.project_id = task.project_id) AND (pm.user_id = auth.uid())))));



  create policy "allow all for demo"
  on "public"."task_assignees"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "project members can access task assignees"
  on "public"."task_assignees"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM (public.task t
     JOIN public.project_members pm ON ((pm.project_id = t.project_id)))
  WHERE ((t.id = task_assignees.task_id) AND (pm.user_id = auth.uid())))));



  create policy "allow all for demo"
  on "public"."task_comments"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."task_dependencies"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "project members can access dependencies"
  on "public"."task_dependencies"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM (public.task t
     JOIN public.project_members pm ON ((pm.project_id = t.project_id)))
  WHERE ((t.id = task_dependencies.blocking_task_id) AND (pm.user_id = auth.uid())))));



  create policy "allow all for demo"
  on "public"."task_history"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."workspace"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "allow all for demo"
  on "public"."workspace_members"
  as permissive
  for all
  to public
using (true)
with check (true);


CREATE TRIGGER project_soft_delete_trigger AFTER UPDATE ON public.project FOR EACH ROW WHEN (((old.is_deleted = false) AND (new.is_deleted = true))) EXECUTE FUNCTION public.soft_delete_project_cascade();

CREATE TRIGGER project_member_workspace_check BEFORE INSERT OR UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.check_project_member_workspace();

CREATE TRIGGER compact_section_positions_trigger AFTER UPDATE OF is_deleted ON public.section FOR EACH ROW WHEN (((old.is_deleted = false) AND (new.is_deleted = true))) EXECUTE FUNCTION public.compact_section_positions();

CREATE TRIGGER section_soft_delete_cleanup AFTER UPDATE ON public.section FOR EACH ROW WHEN (((old.is_deleted = false) AND (new.is_deleted = true))) EXECUTE FUNCTION public.detach_tasks_on_section_delete();

CREATE TRIGGER set_section_position_trigger BEFORE INSERT ON public.section FOR EACH ROW EXECUTE FUNCTION public.set_section_position();

CREATE TRIGGER compact_task_positions_trigger AFTER UPDATE OF is_deleted ON public.task FOR EACH ROW WHEN (((old.is_deleted = false) AND (new.is_deleted = true))) EXECUTE FUNCTION public.compact_task_positions();

CREATE TRIGGER set_task_position_trigger BEFORE INSERT ON public.task FOR EACH ROW EXECUTE FUNCTION public.set_task_position();

CREATE TRIGGER task_delete_trigger AFTER DELETE ON public.task FOR EACH ROW EXECUTE FUNCTION public.log_task_history();

CREATE TRIGGER task_history_trigger AFTER INSERT OR UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION public.log_task_history();

CREATE TRIGGER task_assignee_change_trigger AFTER INSERT OR DELETE ON public.task_assignees FOR EACH ROW EXECUTE FUNCTION public.log_task_assignee_change();

CREATE TRIGGER task_assignee_project_check BEFORE INSERT OR UPDATE ON public.task_assignees FOR EACH ROW EXECUTE FUNCTION public.check_task_assignee_project();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();