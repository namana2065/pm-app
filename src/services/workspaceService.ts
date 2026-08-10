import { supabase } from "../lib/supabaseClient";
import { AppError, assertFound } from "../lib/errors";
import { requireWorkspaceAccess } from "./accessService";

async function requireWorkspaceOwner(userId: string, workspaceId: string) {
  await requireWorkspaceAccess(userId, workspaceId);

  const { data, error } = await supabase
    .from("workspace")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);

  const workspace = assertFound(data, "Workspace");
  if (workspace.owner_user_id !== userId) {
    throw new AppError("Only the workspace owner can perform this action", 403);
  }
}

export async function listWorkspaces(userId: string) {
  const { data: owned, error: ownedError } = await supabase
    .from("workspace")
    .select("*")
    .eq("owner_user_id", userId);

  if (ownedError) throw new AppError(ownedError.message, 500);

  const { data: memberships, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace:workspace_id(*)")
    .eq("user_id", userId);

  if (memberError) throw new AppError(memberError.message, 500);

  const byId = new Map<string, NonNullable<(typeof owned)[number]>>();
  for (const workspace of owned ?? []) {
    byId.set(workspace.id, workspace);
  }
  for (const row of memberships ?? []) {
    const workspace = row.workspace as NonNullable<(typeof owned)[number]> | null;
    if (workspace) byId.set(workspace.id, workspace);
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

export async function getWorkspaceById(workspaceId: string, userId: string) {
  await requireWorkspaceAccess(userId, workspaceId);

  const { data, error } = await supabase
    .from("workspace")
    .select("*")
    .eq("id", workspaceId)
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}

export async function createWorkspace(userId: string, name: string) {
  const { data: workspace, error } = await supabase
    .from("workspace")
    .insert({ name, owner_user_id: userId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("You already own a workspace", 400);
    }
    throw new AppError(error.message, 500);
  }

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: userId,
    role: "admin",
  });

  if (memberError) throw new AppError(memberError.message, 500);

  return workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  name: string
) {
  await requireWorkspaceOwner(userId, workspaceId);

  const { data, error } = await supabase
    .from("workspace")
    .update({ name })
    .eq("id", workspaceId)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}

export async function deleteWorkspace(workspaceId: string, userId: string) {
  await requireWorkspaceOwner(userId, workspaceId);

  const { count, error: countError } = await supabase
    .from("project")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false);

  if (countError) throw new AppError(countError.message, 500);
  if (count && count > 0) {
    throw new AppError("Cannot delete workspace with active projects", 400);
  }

  const { error } = await supabase
    .from("workspace")
    .delete()
    .eq("id", workspaceId);

  if (error) throw new AppError(error.message, 500);
}
