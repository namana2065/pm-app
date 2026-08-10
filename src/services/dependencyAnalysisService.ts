import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { CriticalPathResult, Task, TaskImpact } from "../types/database";
import { getBlockedTasks, getBlockingTasks, getTransitiveDependents } from "../utils/graph";
import { getProjectDeps } from "./dependencyService";


function taskDurationDays(task: Task): number {
  if (task.start_date && task.due_date) {
    const ms =
      new Date(task.due_date).getTime() - new Date(task.start_date).getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
  return 1;
}

function buildLongestChain(
  targetTaskId: string,
  deps: ReturnType<typeof getProjectDeps> extends Promise<infer T> ? T : never,
  taskMap: Map<string, Task>
): Task[] {
  const memo = new Map<string, Task[]>();

  function dfs(taskId: string): Task[] {
    if (memo.has(taskId)) return memo.get(taskId)!;

    const task = taskMap.get(taskId);
    if (!task) return [];

    const prereqs = getBlockingTasks(taskId, deps);
    if (prereqs.length === 0) {
      const chain = [task];
      memo.set(taskId, chain);
      return chain;
    }

    let longest: Task[] = [];
    for (const prereqId of prereqs) {
      const chain = dfs(prereqId);
      if (chain.length > longest.length) longest = chain;
    }

    const result = [...longest, task];
    memo.set(taskId, result);
    return result;
  }

  return dfs(targetTaskId);
}

async function loadProjectTasks(projectId: string): Promise<Map<string, Task>> {
  const { data, error } = await supabase
    .from("task")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);

  const map = new Map<string, Task>();
  for (const task of data ?? []) {
    map.set(task.id, task as Task);
  }
  return map;
}

//simplified critical path method
//DFS with memoization to find longest chain ending at target task
export async function getCriticalPathToTask(
  targetTaskId: string
): Promise<CriticalPathResult> {
  const { data: target, error } = await supabase
    .from("task")
    .select("*")
    .eq("id", targetTaskId)
    .eq("is_deleted", false)
    .single();

  if (error || !target) throw new AppError("Task not found", 404);

  const deps = await getProjectDeps(target.project_id!);
  const taskMap = await loadProjectTasks(target.project_id!);

  const chain = buildLongestChain(targetTaskId, deps, taskMap);
  const totalDurationDays = chain.reduce((sum, t) => sum + taskDurationDays(t), 0);

  const estimatedCompletionDate = new Date();
  estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + totalDurationDays);

  return {
    targetTaskId,
    chain,
    totalDurationDays,
    estimatedCompletionDate: estimatedCompletionDate.toISOString(),
  };
}


export async function getTaskImpact(taskId: string): Promise<TaskImpact> {
  const { data: task, error } = await supabase
    .from("task")
    .select("project_id")
    .eq("id", taskId)
    .single();

  if (error || !task?.project_id) throw new AppError("Task not found", 404);

  const deps = await getProjectDeps(task.project_id);
  const direct = getBlockedTasks(taskId, deps);
  const all = getTransitiveDependents(taskId, deps);

  const taskMap = await loadProjectTasks(task.project_id);

  let blockedDependents = 0;

  for (const id of all) {
    const t = taskMap.get(id);
    if (t && (t.status === "blocked" || t.status === "waiting")) {
      blockedDependents++;
    }
  }

  return {
    taskId,
    directDependents: direct.length,
    totalDependents: all.size,
    blockedDependents,
  };
}

