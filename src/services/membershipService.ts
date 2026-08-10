import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess } from "./accessService";

export async function removeUserFromProject(userId: string, projectId: string) {
  const { error: memberError } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (memberError) throw new AppError(memberError.message, 500);

  const { data: tasks, error: taskError } = await supabase
    .from("task")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (taskError) throw new AppError(taskError.message, 500);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return;

  const { error: assigneeError } = await supabase
    .from("task_assignees")
    .delete()
    .eq("user_id", userId)
    .in("task_id", taskIds);

  if (assigneeError) throw new AppError(assigneeError.message, 500);
}

export async function addProjectMember(
  projectId: string,
  actorId: string,
  newUserId: string,
  role: "admin" | "editor" | "viewer"
) {
  await requireProjectAccess(actorId, projectId, "admin");

  const { data, error } = await supabase
    .from("project_members")
    .upsert(
      {
        project_id: projectId,
        user_id: newUserId,
        role,
      },
      { onConflict: "project_id,user_id" }
    )
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}
