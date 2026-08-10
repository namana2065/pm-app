import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess } from "./accessService";
import { getProjectStatusDuration } from "./historyService";
import { detectAnomalies } from "../utils/anomalyDetection";
import {
  ContextSwitchingFeatures,
  ContextSwitchingResult,
  SeverityLevel,
  StatusTimeline,
} from "../types/database";

const INSIGHT_TYPE = "context_switching";

interface ActiveInterval {
  taskId: string;
  startMs: number;
  endMs: number; // Date.now() if still ongoing
  durationHours: number;
}

/** Loads {taskId -> assignee userIds[]} for every non-deleted task in the project. */
async function loadProjectAssignees(
  projectId: string
): Promise<{ taskIds: string[]; taskAssignees: Map<string, string[]> }> {
  const { data: tasks, error: taskError } = await supabase
    .from("task")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (taskError) throw new AppError(taskError.message, 500);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return { taskIds: [], taskAssignees: new Map() };

  const { data: assigneeRows, error: assigneeError } = await supabase
    .from("task_assignees")
    .select("task_id, user_id")
    .in("task_id", taskIds);

  if (assigneeError) throw new AppError(assigneeError.message, 500);

  const taskAssignees = new Map<string, string[]>();
  for (const row of assigneeRows ?? []) {
    if (!row.task_id || !row.user_id) continue;
    const existing = taskAssignees.get(row.task_id) ?? [];
    existing.push(row.user_id);
    taskAssignees.set(row.task_id, existing);
  }

  return { taskIds, taskAssignees };
}

/**
 * Sweep-line over a user's in_progress intervals: returns the peak and
 * time-weighted average number of concurrently active tasks, plus the
 * number of times a new task started while another was still active.
 */
function analyzeConcurrency(intervals: ActiveInterval[]): {
  peak: number;
  timeWeightedAvg: number;
  switchCount: number;
} {
  if (intervals.length === 0) {
    return { peak: 0, timeWeightedAvg: 0, switchCount: 0 };
  }

  type Event = { timeMs: number; delta: 1 | -1 };
  const events: Event[] = [];
  for (const interval of intervals) {
    events.push({ timeMs: interval.startMs, delta: 1 });
    events.push({ timeMs: interval.endMs, delta: -1 });
  }
  // Process starts before ends at the same timestamp so overlapping
  // back-to-back tasks are still counted as concurrent for an instant.
  events.sort((a, b) => a.timeMs - b.timeMs || b.delta - a.delta);

  let concurrency = 0;
  let peak = 0;
  let switchCount = 0;
  let weightedSum = 0;
  let prevTimeMs = events[0].timeMs;

  for (const event of events) {
    const elapsedHours = (event.timeMs - prevTimeMs) / (1000 * 60 * 60);
    weightedSum += concurrency * elapsedHours;

    if (event.delta === 1) {
      if (concurrency >= 1) switchCount++; // picked up a task while another was active
      concurrency++;
      if (concurrency > peak) peak = concurrency;
    } else {
      concurrency = Math.max(0, concurrency - 1);
    }

    prevTimeMs = event.timeMs;
  }

  const totalWindowHours =
    (Math.max(...intervals.map((i) => i.endMs)) - Math.min(...intervals.map((i) => i.startMs))) /
    (1000 * 60 * 60);

  const timeWeightedAvg = totalWindowHours > 0 ? weightedSum / totalWindowHours : concurrency;

  return { peak, timeWeightedAvg, switchCount };
}

function buildFeatures(intervals: ActiveInterval[]): ContextSwitchingFeatures {
  const { peak, timeWeightedAvg, switchCount } = analyzeConcurrency(intervals);

  const activeTaskCount = new Set(intervals.map((i) => i.taskId)).size;
  const avgTaskActiveDurationHours =
    intervals.reduce((sum, i) => sum + i.durationHours, 0) / (intervals.length || 1);

  const earliestMs = Math.min(...intervals.map((i) => i.startMs));
  const latestMs = Math.max(...intervals.map((i) => i.endMs));
  const windowDays = Math.max(1, (latestMs - earliestMs) / (1000 * 60 * 60 * 24));

  return {
    activeTaskCount,
    peakConcurrentActiveTasks: peak,
    avgConcurrentActiveTasks: Math.round(timeWeightedAvg * 100) / 100,
    contextSwitchCount: switchCount,
    contextSwitchesPerDay: Math.round((switchCount / windowDays) * 100) / 100,
    avgTaskActiveDurationHours: Math.round(avgTaskActiveDurationHours * 100) / 100,
    windowDays: Math.round(windowDays * 100) / 100,
  };
}

/**
 * A 0-100 score describing how fragmented this user's work is, computed
 * directly from their own features (does not require comparison to peers,
 * unlike the anomaly score).
 */
function computeContextSwitchingScore(features: ContextSwitchingFeatures): number {
  const concurrencyPenalty = Math.max(0, features.peakConcurrentActiveTasks - 1) * 20;
  const switchPenalty = features.contextSwitchesPerDay * 15;
  const breadthPenalty = features.activeTaskCount > 5 ? 10 : 0;

  return Math.min(100, Math.round(concurrencyPenalty + switchPenalty + breadthPenalty));
}

function computeSeverity(contextSwitchingScore: number, anomalyScore: number): SeverityLevel {
  const signal = Math.max(contextSwitchingScore, anomalyScore);
  if (signal >= 80) return "critical";
  if (signal >= 60) return "high";
  if (signal >= 35) return "medium";
  return "low";
}

function buildExplanation(userName: string, features: ContextSwitchingFeatures): string {
  return (
    `${userName} had up to ${features.peakConcurrentActiveTasks} tasks in progress at once ` +
    `across ${features.activeTaskCount} task(s), switching between active tasks roughly ` +
    `${features.contextSwitchesPerDay}x/day over the last ${Math.round(features.windowDays)} day(s), ` +
    `averaging ${features.avgTaskActiveDurationHours}h of active time per task before moving on.`
  );
}

function buildRecommendation(severity: SeverityLevel, features: ContextSwitchingFeatures): string {
  if (severity === "critical") {
    return `Reduce this user's concurrent in-progress tasks (currently peaking at ${features.peakConcurrentActiveTasks}) to at most 2, and pause new assignments until existing work is closed out.`;
  }
  if (severity === "high") {
    return "Review this user's active task list with them and help them sequence work instead of running it in parallel.";
  }
  if (severity === "medium") {
    return "Keep an eye on this user's workload; consider spacing out new task assignments.";
  }
  return "No action needed — this user's work pattern looks focused.";
}

/**
 * Computes Context Switching Detection insights for every user with
 * assigned, worked-on tasks in a project, and persists the results into the
 * existing project_insights table (insight_type = "context_switching").
 */
export async function getContextSwitchingInsights(
  projectId: string,
  userId: string
): Promise<ContextSwitchingResult[]> {
  await requireProjectAccess(userId, projectId, "viewer");

  const { taskIds, taskAssignees } = await loadProjectAssignees(projectId);
  if (taskIds.length === 0) return [];

  const timeline: StatusTimeline[] = await getProjectStatusDuration(projectId);

  // Group in_progress intervals per user, across every task they're assigned to.
  const userIntervals = new Map<string, ActiveInterval[]>();

  for (const segment of timeline) {
    if (segment.status !== "in_progress") continue;

    const assignees = taskAssignees.get(segment.taskId);
    if (!assignees || assignees.length === 0) continue;

    const startMs = new Date(segment.enteredAt).getTime();
    const endMs = segment.exitedAt ? new Date(segment.exitedAt).getTime() : Date.now();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;

    const interval: ActiveInterval = {
      taskId: segment.taskId,
      startMs,
      endMs,
      durationHours: segment.durationHours ?? (endMs - startMs) / (1000 * 60 * 60),
    };

    for (const assigneeId of assignees) {
      const existing = userIntervals.get(assigneeId) ?? [];
      existing.push(interval);
      userIntervals.set(assigneeId, existing);
    }
  }

  const userIds = Array.from(userIntervals.keys());
  if (userIds.length === 0) return [];

  const { data: users, error: usersError } = await supabase
    .from("app_user")
    .select("id, name, email")
    .in("id", userIds);

  if (usersError) throw new AppError(usersError.message, 500);

  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  const perUserFeatures = userIds.map((id) => buildFeatures(userIntervals.get(id)!));
  const featureVectors = perUserFeatures.map((f) => [
    f.peakConcurrentActiveTasks,
    f.avgConcurrentActiveTasks,
    f.contextSwitchesPerDay,
    f.activeTaskCount,
  ]);

  const anomalyResults = detectAnomalies(featureVectors);

  const results: ContextSwitchingResult[] = userIds.map((id, index) => {
    const features = perUserFeatures[index];
    const anomaly = anomalyResults[index];
    const user = userMap.get(id);
    const userName = user?.name ?? "Unknown user";

    const contextSwitchingScore = computeContextSwitchingScore(features);
    const severity = computeSeverity(contextSwitchingScore, anomaly.anomalyScore);

    return {
      userId: id,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      contextSwitchingScore,
      anomalyScore: anomaly.anomalyScore,
      isAnomaly: anomaly.isAnomaly,
      severity,
      method: anomaly.method,
      features,
      explanation: buildExplanation(userName, features),
      recommendation: buildRecommendation(severity, features),
    };
  });

  await persistInsights(projectId, results);

  return results.sort((a, b) => b.anomalyScore - a.anomalyScore);
}

/** Overwrites this project's stored context-switching insights with the freshly computed ones. */
async function persistInsights(
  projectId: string,
  results: ContextSwitchingResult[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("project_insights")
    .delete()
    .eq("project_id", projectId)
    .eq("insight_type", INSIGHT_TYPE);

  if (deleteError) throw new AppError(deleteError.message, 500);

  if (results.length === 0) return;

  const rows = results.map((r) => ({
    project_id: projectId,
    insight_type: INSIGHT_TYPE,
    entity_type: "user",
    entity_id: r.userId,
    score: r.contextSwitchingScore,
    metrics: {
      anomalyScore: r.anomalyScore,
      isAnomaly: r.isAnomaly,
      severity: r.severity,
      method: r.method,
      features: r.features,
    },
    narrative: r.explanation,
    computed_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase.from("project_insights").insert(rows);
  if (insertError) throw new AppError(insertError.message, 500);
}
