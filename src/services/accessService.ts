import { supabase } from "../lib/supabaseClient";
import { AppError, assertFound } from "../lib/errors";
import { RoleType } from "../types/database";


// Higher number = higher permission
const ROLE_RANK: Record<RoleType, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};


export async function getProject(projectId: string) {
  const { data, error } = await supabase
    .from("project")
    .select("*")
    .eq("id", projectId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  return data;
}

export async function getTask(taskId: string) {
  const { data, error } = await supabase
    .from("task")
    .select("*")
    .eq("id", taskId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  return data;
}

/**
 * a user has workspace access if they:
 * 1. Own the workspace, OR
 * 2. Are listed in workspace_members
 */
export async function hasWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const { data: workspace, error: wsError } = await supabase
    .from("workspace")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsError) throw new AppError(wsError.message, 500);
  if (!workspace) return false;

  // Workspace owner always has access
  if (workspace.owner_user_id === userId) {
    return true;
  }

  const { data: membership, error: memberError } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) throw new AppError(memberError.message, 500);

  return Boolean(membership);
}

export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: string
) {
  const allowed = await hasWorkspaceAccess(userId, workspaceId);
  if (!allowed) {
    throw new AppError("You do not have access to this workspace", 403);
  }
}


export async function getProjectRole(
  userId: string,
  projectId: string
): Promise<RoleType | null> {
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  return (data?.role as RoleType) ?? null;
}

export async function hasProjectAccess(
  userId: string,
  projectId: string
): Promise<boolean> {
  const project = await getProject(projectId);
  if (!project) return false;

  const role = await getProjectRole(userId, projectId);
  if (role) return true;

  if (project.workspace_id) {
    return hasWorkspaceAccess(userId, project.workspace_id);
  }

  return false;
}

export async function requireProjectAccess(
  userId: string,
  projectId: string,
  minRole: RoleType = "viewer"
) {
  const project = assertFound(await getProject(projectId), "Project");

  let role = await getProjectRole(userId, projectId);

  if (!role && project.workspace_id) {
    const inWorkspace = await hasWorkspaceAccess(userId, project.workspace_id);
    if (inWorkspace) role = "viewer"; 
  }

  if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new AppError("You do not have access to this project", 403);
  }
}

export async function validateTaskAccess(userId: string, taskId: string) {
  const task = assertFound(await getTask(taskId), "Task");
  if (!task.project_id) {
    throw new AppError("Task has no project", 400);
  }
  await requireProjectAccess(userId, task.project_id, "viewer");
  return task;
}
