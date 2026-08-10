import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { TaskDep } from "../types/database";
import { possibleCycle } from "../utils/graph";
import { requireProjectAccess, validateTaskAccess } from "./accessService";

export async function getProjectDeps(
  projectId: string
): Promise<TaskDep[]> {
  const { data: tasks, error: taskError } = await supabase
    .from("task")
    .select("id")
    .eq("project_id", projectId) 
    .eq("is_deleted", false);

  if (taskError) throw new AppError(taskError.message, 500);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from("task_dependencies")
    .select("*")
    .in("blocked_task_id", taskIds);

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

export async function validateDep(
  blockingTaskId: string,
  blockedTaskId: string
) {
  if (blockingTaskId === blockedTaskId) {
    throw new AppError("A task cannot depend on itself", 400);
  }

  const { data: blocking, error: bErr } = await supabase
    .from("task")
    .select("id, project_id")
    .eq("id", blockingTaskId)
    .eq("is_deleted", false)
    .maybeSingle();

  const { data: blocked, error: blErr } = await supabase
    .from("task")
    .select("id, project_id")
    .eq("id", blockedTaskId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (bErr || blErr) throw new AppError("Failed to load tasks", 500);
  if (!blocking || !blocked) throw new AppError("Task not found", 404);
  if (blocking.project_id !== blocked.project_id) {
    throw new AppError("Tasks must belong to the same project", 400);
  }

  const deps = await getProjectDeps(blocking.project_id!);
  if (possibleCycle(blockingTaskId, blockedTaskId, deps)) {
    throw new AppError("This dependency would create a circular loop", 400);
  }
}

export async function createDep(
  blockingTaskId: string,
  blockedTaskId: string,
  userId: string
) {
  await validateDep(blockingTaskId, blockedTaskId);

  const { data: blocked, error: taskError } = await supabase
    .from("task")
    .select("project_id")
    .eq("id", blockedTaskId)
    .single();

  if (taskError) throw new AppError(taskError.message, 500);

  await requireProjectAccess(userId, blocked.project_id!, "editor");

  const { data, error } = await supabase
    .from("task_dependencies")
    .insert({
      blocking_task_id: blockingTaskId,
      blocked_task_id: blockedTaskId,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("Dependency already exists", 400);
    }
    throw new AppError(error.message, 500);
  }

  return data;
}

export async function listDeps(taskId: string, userId: string) {
  await validateTaskAccess(userId, taskId);

  const { data, error } = await supabase
    .from("task_dependencies")
    .select("*")
    .or(`blocking_task_id.eq.${taskId},blocked_task_id.eq.${taskId}`);

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}
export async function deleteDep(depId: string, userId: string) {
  const { data: dep, error: depError } = await supabase
    .from("task_dependencies")
    .select("blocked_task_id")
    .eq("id", depId)
    .maybeSingle();

  if (depError) throw new AppError(depError.message, 500);
  if (!dep?.blocked_task_id) throw new AppError("Dependency not found", 404);

  const { data: task, error: taskError } = await supabase
    .from("task")
    .select("project_id")
    .eq("id", dep.blocked_task_id)
    .single();

  if (taskError) throw new AppError(taskError.message, 500);
  await requireProjectAccess(userId, task.project_id!, "editor");

  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("id", depId);

  if (error) throw new AppError(error.message, 500);
}
