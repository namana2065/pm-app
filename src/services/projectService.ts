import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess, requireWorkspaceAccess } from "./accessService";

interface CreateProjectInput {
  name: string;
  workspaceId: string;
  userId: string;
  description?: string;
}

export async function createProject(input: CreateProjectInput) {
  const { name, workspaceId, userId, description } = input;

  await requireWorkspaceAccess(userId, workspaceId);

  const { data: project, error } = await supabase
    .from("project")
    .insert({
      name,
      description: description ?? null,
      workspace_id: workspaceId,
      created_by: userId,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  const { error: memberError } = await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: userId,
    role: "editor",
  });

  if (memberError) throw new AppError(memberError.message, 500);

  return project;
}

export async function listProjects(workspaceId: string, userId: string) {
  await requireWorkspaceAccess(userId, workspaceId);

  const { data, error } = await supabase
    .from("project")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

export async function getProjectById(projectId: string, userId: string) {
  await requireProjectAccess(userId, projectId, "viewer");

  const { data, error } = await supabase
    .from("project")
    .select("*")
    .eq("id", projectId)
    .eq("is_deleted", false)
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}

interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

export async function updateProject(
  projectId: string,
  userId: string,
  updates: UpdateProjectInput
) {
  await requireProjectAccess(userId, projectId, "editor");

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;

  const { data, error } = await supabase
    .from("project")
    .update(payload)
    .eq("id", projectId)
    .eq("is_deleted", false)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}

export async function deleteProject(projectId: string, userId: string) {
  await requireProjectAccess(userId, projectId, "admin");

  const { error } = await supabase
    .from("project")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);
}
