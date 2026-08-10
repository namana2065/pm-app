import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess, validateTaskAccess } from "./accessService";


export async function listAssignees(taskId: string, userId: string) {
  await validateTaskAccess(userId, taskId);

  const { data, error } = await supabase
    .from("task_assignees")
    .select("id, user_id, app_user(id, name, email, job_role_id)")
    .eq("task_id", taskId);

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

export async function addAssignee(
  taskId: string,
  userId: string,
  assigneeId: string
) {
  const task = await validateTaskAccess(userId, taskId);
  await requireProjectAccess(userId, task.project_id!, "editor");

  const { data, error } = await supabase
    .from("task_assignees")
    .insert({ task_id: taskId, user_id: assigneeId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("User is already assigned to this task", 400);
    }
    throw new AppError(error.message, 500);
  }
  return data;
}

export async function removeAssignee(
  taskId: string,
  userId: string,
  assigneeId: string
) {
  const task = await validateTaskAccess(userId, taskId);
  await requireProjectAccess(userId, task.project_id!, "editor");

  const { error } = await supabase
    .from("task_assignees")
    .delete()
    .eq("task_id", taskId)
    .eq("user_id", assigneeId);

  if (error) throw new AppError(error.message, 500);
}
