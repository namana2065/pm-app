import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess } from "./accessService";


export async function listSections(projectId: string, userId: string) {
  await requireProjectAccess(userId, projectId, "viewer");

  const { data, error } = await supabase
    .from("section")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .order("position", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

export async function createSection(
  projectId: string,
  userId: string,
  name: string
) {
  await requireProjectAccess(userId, projectId, "editor");

  const { data: existing, error: posError } = await supabase
    .from("section")
    .select("position")
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .order("position", { ascending: false })
    .limit(1);

  if (posError) throw new AppError(posError.message, 500);

  const nextPosition = existing?.length ? (existing[0].position ?? 0) + 1 : 1;

  const { data, error } = await supabase
    .from("section")
    .insert({
      project_id: projectId, name,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}


export async function checkSectionInProject(
  sectionId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("section")
    .select("id, project_id")
    .eq("id", sectionId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data || data.project_id !== projectId) {
    throw new AppError("Section does not belong to this project", 400);
  }
}

interface UpdateSectionInput {
  name?: string;
  description?: string | null;
  position?: number;
}

export async function updateSection(
  sectionId: string,
  projectId: string,
  userId: string,
  updates: UpdateSectionInput
) {
  await requireProjectAccess(userId, projectId, "editor");
  await checkSectionInProject(sectionId, projectId);

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.position !== undefined) payload.position = updates.position;

  const { data, error } = await supabase
    .from("section")
    .update(payload)
    .eq("id", sectionId)
    .eq("is_deleted", false)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
}

export async function deleteSection(
  sectionId: string,
  projectId: string,
  userId: string
) {
  await requireProjectAccess(userId, projectId, "editor");
  await checkSectionInProject(sectionId, projectId);

  const { error } = await supabase
    .from("section")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", sectionId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);
}
