
import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import {
  AssigneeHandoff,
  StatusTimeline,
  StatusType,
  Task,
  TaskHistory,
  AssigneeEvent,
} from "../types/database";

const IDLE_STATUSES: StatusType[] = ["waiting", "blocked"];

export async function getTaskHistory(taskId: string): Promise<TaskHistory[]> {
  const { data, error } = await supabase
    .from("task_history")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as TaskHistory[];
}

export async function getProjectHistory(projectId: string): Promise<TaskHistory[]> {
  const { data: tasks, error: taskError } = await supabase
    .from("task")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (taskError) throw new AppError(taskError.message, 500);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from("task_history")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as TaskHistory[];
}

function extractStatus(snapshot: Partial<Task> | null): StatusType {
  return (snapshot?.status as StatusType) ?? "to_do";
}

export function buildStatusTimeline(
  taskId: string,
  history: TaskHistory[],
  currentTask?: Task
): StatusTimeline[] {
  const rows = history.filter((h) => h.task_id === taskId);
  if (rows.length === 0 && currentTask) {
    return [
      {
        taskId,
        status: currentTask.status,
        enteredAt: currentTask.created_at,
        exitedAt: null,
        durationHours: hoursBetween(currentTask.created_at, null),
      },
    ];
  }
  const timeline: StatusTimeline[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = extractStatus(row.task_snapshot);
    const enteredAt = row.created_at;
    const nextRow = rows[i + 1];
    const exitedAt = nextRow?.created_at ?? null;

    const prev = timeline[timeline.length - 1];
    if (prev && prev.status === status && prev.exitedAt === null) {
      prev.exitedAt = exitedAt;
      prev.durationHours = hoursBetween(prev.enteredAt, exitedAt);
      continue;
    }

    timeline.push({
      taskId,
      status,
      enteredAt,
      exitedAt,
      durationHours: hoursBetween(enteredAt, exitedAt),
    });
  }


  const last = timeline[timeline.length - 1];

  if (last && last.exitedAt === null) {
    const endTime =
      currentTask?.is_deleted && currentTask.deleted_at
        ? currentTask.deleted_at
        : null;

    last.exitedAt = endTime;
    last.durationHours = hoursBetween(last.enteredAt, endTime);
  }
  return timeline;
}

export async function getTaskStatusDuration(taskId: string): Promise<StatusTimeline[]> {
  const history = await getTaskHistory(taskId);

  const { data: task, error } = await supabase
    .from("task")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);

  return buildStatusTimeline(taskId, history, task as Task | undefined);
}

export async function getProjectStatusDuration(
  projectId: string
): Promise<StatusTimeline[]> {
  const history = await getProjectHistory(projectId);

  const { data: tasks, error } = await supabase
    .from("task")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);

  const all: StatusTimeline[] = [];
  for (const task of tasks ?? []) {
    all.push(
      ...buildStatusTimeline(task.id, history, task as Task)
    );
  }
  return all;
}

export function sumIdleHours(segments: StatusTimeline[]): number {
  return segments
    .filter((s) => IDLE_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (s.durationHours ?? 0), 0);
}

function hoursBetween(start: string, end: string | null): number {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, (endMs - startMs) / (1000 * 60 * 60));
}

export async function getProjectAssigneeEvents(
  projectId: string
): Promise<AssigneeEvent[]> {
  const { data, error } = await supabase
    .from("assignee_event")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as AssigneeEvent[];
}

