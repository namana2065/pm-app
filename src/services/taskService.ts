import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { PriorityLevel, StatusType, Task } from "../types/database";
import {
  requireProjectAccess,
  validateTaskAccess,
} from "./accessService";
import { checkSectionInProject } from "./sectionService";

interface CreateTaskInput {
  title: string;
  projectId: string;
  sectionId: string;
  userId: string;
  description?: string;
  priority?: PriorityLevel;
  startDate?: string;
  dueDate?: string;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: PriorityLevel;
  startDate?: string | null;
  dueDate?: string | null;
  sectionId?: string;
  delayCauseId?: string | null;
}

export async function createTask(input: CreateTaskInput) {
  const {
    title,
    projectId,
    sectionId,
    userId,
    description,
    priority = "medium",
    startDate,
    dueDate,
  } = input;

  await requireProjectAccess(userId, projectId, "editor");
  await checkSectionInProject(sectionId, projectId);

  const { data: existing, error: posError } = await supabase
    .from("task")
    .select("position")
    .eq("section_id", sectionId)
    .eq("is_deleted", false)
    .order("position", { ascending: false })
    .limit(1);

  if (posError) throw new AppError(posError.message, 500);
  const nextPosition = existing?.length ? (existing[0].position ?? 0) + 1 : 1;

  const { data, error } = await supabase
    .from("task")
    .insert({
      title,
      description: description ?? null,
      project_id: projectId,
      section_id: sectionId,
      priority,
      position: nextPosition,
      created_by: userId,
      start_date: startDate ?? null,
      due_date: dueDate ?? null,
      status: "to_do",
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  return data;
}

export async function listTasks(projectId: string, userId: string) {
  await requireProjectAccess(userId, projectId, "viewer");

  const { data, error } = await supabase
    .from("task")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .order("position", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

export async function getTaskById(taskId: string, userId: string) {
  return validateTaskAccess(userId, taskId);
}

export async function updateTask(
  taskId: string,
  userId: string,
  updates: UpdateTaskInput
) {
  const task = await validateTaskAccess(userId, taskId);
  await requireProjectAccess(userId, task.project_id!, "editor");

  if (updates.sectionId) {
    await checkSectionInProject(updates.sectionId, task.project_id!);
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;
  if (updates.sectionId !== undefined) payload.section_id = updates.sectionId;
  if (updates.delayCauseId !== undefined) payload.delay_cause_id = updates.delayCauseId;

  const { data, error } = await supabase
    .from("task")
    .update(payload)
    .eq("id", taskId)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  return data;
}

export async function updateTaskStatus(
  taskId: string,
  userId: string,
  status: StatusType
) {
  const task = await validateTaskAccess(userId, taskId);
  await requireProjectAccess(userId, task.project_id!, "editor");

  const { data, error } = await supabase
    .from("task")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  return data;
}

//Editor check → soft delete (compacts positions and logs history via DB triggers)
export async function deleteTask(taskId: string, userId: string) {
  const task = await validateTaskAccess(userId, taskId);
  await requireProjectAccess(userId, task.project_id!, "editor");

  const { error } = await supabase
    .from("task")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) throw new AppError(error.message, 500);

}

export async function getDelayDays(task: Task): Promise<number> {
  const { getTaskStatusDuration: getTaskStatusSegments, sumIdleHours } = await import("./historyService");
  const segments = await getTaskStatusSegments(task.id);
  return Math.floor(sumIdleHours(segments) / 24);
}
