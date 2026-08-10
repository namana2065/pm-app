import { TaskDep } from "../types/database";


//to know what tasks must finish before this task can start
export function getBlockingTasks(
  taskId: string,
  deps: TaskDep[]
): string[] {
  return deps
    .filter((d) => d.blocked_task_id === taskId && d.blocking_task_id)
    .map((d) => d.blocking_task_id as string);
}

// Tasks waiting on this task to finish
export function getBlockedTasks(
  taskId: string,
  deps: TaskDep[]
): string[] {
  return deps
    .filter((d) => d.blocking_task_id === taskId && d.blocked_task_id)
    .map((d) => d.blocked_task_id as string);
}

/* True if adding a dep would create a cycle
 dfs using stack
 */
export function possibleCycle(
  blockingId: string,
  blockedId: string,
  deps: TaskDep[]
): boolean {
  const visited = new Set<string>();
  const stack = [blockingId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockedId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const prereq of getBlockingTasks(current, deps)) {
      stack.push(prereq);
    }
  }

  return false;
}

// All tasks transitively waiting on this task
//bfs using queue
export function getTransitiveDependents(
  taskId: string,
  deps: TaskDep[]
): Set<string> {
  const result = new Set<string>();
  const queue = getBlockedTasks(taskId, deps);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (result.has(current)) continue;
    result.add(current);
    queue.push(...getBlockedTasks(current, deps));
  }

  return result;
}
